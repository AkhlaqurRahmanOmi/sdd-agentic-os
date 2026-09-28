// `sdd doctor` — probes a driver against the real CLI and reports which of the
// capabilities it declares actually work.
//
// This exists because a driver written from flags alone can look healthy while
// silently reporting nothing: the run succeeds, usage comes back empty, and
// `sdd cost` quietly records less than it should. Rather than trusting a
// driver's own declaration, this runs a trivial prompt and checks.
//
// It costs one small model call. That is the price of knowing.

import { describeDetection, detectDriver } from '../agent/drivers/detect.js';
import { resolveBin, resolveDriver } from '../agent/drivers/index.js';
import { invokeAgent } from '../agent/invoke.js';
import { loadConfig } from '../spec/config.js';
import { parseArgs } from './cost.js';

// Short, because a probe that waits as long as a real run is not a probe.
const PROBE_TIMEOUT_MS = 60_000;
const PROBE_PROMPT = 'Reply with exactly the word: ok';
const PROBE_SCHEMA = {
  type: 'object',
  properties: { word: { type: 'string' } },
  required: ['word'],
  additionalProperties: false,
};

const mark = (ok) => (ok ? '  ok  ' : ' FAIL ');

export async function doctorCommand(
  argv,
  { root = process.cwd(), stdout = process.stdout } = {},
) {
  const { flags } = parseArgs(argv);
  const config = await loadConfig(root);
  const driver = resolveDriver({ name: typeof flags.driver === 'string' ? flags.driver : null, config });

  const detected = detectDriver();
  const configured = config.agent?.driver;
  const lines = [
    `detected: ${describeDetection(detected)}`,
    `configured: ${!configured || configured === 'auto' ? 'auto' : configured}`,
    `driver: ${driver.name}`,
  ];
  if (detected?.driver && detected.driver !== driver.name) {
    lines.push(
      '',
      `Note: ${detected.driver} is running sdd, but ${driver.name} is what will be`,
      'spawned. That is fine if deliberate — configuration outranks detection.',
    );
  }
  let bin;
  try {
    bin = resolveBin({ driver, config });
  } catch (err) {
    stdout.write(`${lines.join('\n')}\n FAIL  ${err.message}\ndoctor: failed\n`);
    return 1;
  }
  lines.push(`binary: ${bin}`, '');

  if (driver.unverified) {
    lines.push(
      'This driver was written from the CLI\'s flags and event names without a',
      'successful run to confirm them. That is exactly what this command checks.',
      '',
    );
  }

  const findings = [];

  // 1. Does it run at all, and return text?
  let ran = null;
  try {
    ran = await invokeAgent({
      prompt: PROBE_PROMPT,
      driver: driver.name,
      config,
      cwd: root,
      timeoutMs: PROBE_TIMEOUT_MS,
      stderr: { write() {} },
    });
    findings.push({ name: 'runs and returns text', ok: Boolean(ran.text), detail: ran.text?.slice(0, 60) });
  } catch (err) {
    lines.push(`${mark(false)} runs at all`, `        ${err.message.split('\n')[0]}`, '', 'doctor: failed');
    stdout.write(`${lines.join('\n')}\n`);
    return 1;
  }

  // 2. Does it report usage, if it says it does?
  if (driver.capabilities.usage) {
    const tokens = ran.usage?.tokens;
    const reported = Boolean(tokens && (tokens.input || tokens.output || tokens.cache_read));
    findings.push({
      name: 'reports token usage',
      ok: reported,
      detail: reported
        ? `in ${tokens.input + tokens.cache_read}, out ${tokens.output}`
        : 'declared usage:true but reported none — sdd cost would under-record',
    });
  } else {
    findings.push({ name: 'reports token usage', ok: null, detail: 'not claimed by this driver' });
  }

  // 3. Does schema-constrained output work, if it says it does?
  if (driver.capabilities.schema) {
    try {
      const { text } = await invokeAgent({
        prompt: 'Return JSON with a single key \"word\" whose value is \"ok\".',
        schema: PROBE_SCHEMA,
        driver: driver.name,
        config,
        cwd: root,
        stderr: { write() {} },
      });
      JSON.parse(text);
      findings.push({ name: 'schema-constrained output', ok: true });
    } catch {
      findings.push({
        name: 'schema-constrained output',
        ok: false,
        detail: 'declared schema:true but did not return parseable JSON',
      });
    }
  } else {
    findings.push({ name: 'schema-constrained output', ok: null, detail: 'falls back to prompt-and-parse' });
  }

  for (const f of findings) {
    lines.push(`${f.ok === null ? '  --  ' : mark(f.ok)} ${f.name}`);
    if (f.detail) lines.push(`        ${f.detail}`);
  }

  const broken = findings.filter((f) => f.ok === false);
  lines.push(
    '',
    broken.length
      ? `doctor: failed — ${broken.length} declared capability(ies) do not work.\n` +
        'A driver that declares more than it delivers under-records silently,\n' +
        'which is worse than one that declares less.'
      : 'doctor: ok' + (driver.unverified ? ' — this run is the verification; the driver can drop its unverified flag' : ''),
  );

  stdout.write(`${lines.join('\n')}\n`);
  return broken.length ? 1 : 0;
}
