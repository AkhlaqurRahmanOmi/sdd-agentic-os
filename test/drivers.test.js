import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildArgsFromTemplate, makeGenericDriver } from '../src/agent/drivers/generic.js';
import { claudeCode } from '../src/agent/drivers/claude-code.js';
import { resolveBin, resolveDriver } from '../src/agent/drivers/index.js';
import { invokeAgent, invokeAgentJson } from '../src/agent/invoke.js';
import { runWrapped } from '../src/cost/run.js';
import { aggregate, formatReport } from '../src/cost/report.js';
import { readRecords } from '../src/cost/store.js';
import { scratch, sink } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const plain = path.join(here, 'fixtures', 'fake-plain-agent.js');
const env = {};

test('claude-code is the default driver and reports usage', () => {
  const d = resolveDriver({ env });
  assert.equal(d.name, 'claude-code');
  assert.equal(d.capabilities.usage, true);
});

test('the generic driver declares that it cannot report usage', () => {
  assert.equal(resolveDriver({ name: 'generic', env }).capabilities.usage, false);
});

test('config selects the driver, and an explicit name beats config', () => {
  const config = { agent: { driver: 'generic' } };
  assert.equal(resolveDriver({ config, env }).name, 'generic');
  assert.equal(resolveDriver({ name: 'claude-code', config, env }).name, 'claude-code');
});

test('an unknown driver names the known ones instead of failing obscurely', () => {
  assert.throws(() => resolveDriver({ name: 'nope', env }), /known: claude-code, generic/);
});

test('the generic driver has no default binary, so one must be configured', () => {
  assert.throws(
    () => resolveBin({ driver: resolveDriver({ name: 'generic', env }), env }),
    /no default binary/,
  );
  assert.equal(
    resolveBin({ driver: resolveDriver({ name: 'generic', env }), config: { agent: { bin: 'codex' } }, env }),
    'codex',
  );
});

test('claude-code builds the flags it needs, and only those', () => {
  const args = claudeCode.buildArgs({ prompt: 'p', model: 'm', schema: { a: 1 }, allowedTools: ['Read'] });
  assert.ok(args.includes('--output-format') && args.includes('stream-json'));
  assert.equal(args[args.indexOf('--model') + 1], 'm');
  assert.equal(args[args.indexOf('--json-schema') + 1], '{"a":1}');
});

test('an arg template substitutes prompt and model without splitting the prompt', () => {
  assert.deepEqual(
    buildArgsFromTemplate('exec --model {model} {prompt}', { prompt: 'two words', model: 'm' }),
    ['exec', '--model', 'm', 'two words'],
  );
});

test('a template that forgets the prompt still sends it', () => {
  assert.deepEqual(buildArgsFromTemplate('exec', { prompt: 'p' }), ['exec', 'p']);
});

test('the generic driver runs a plain CLI and marks the run unmeasured', async () => {
  const stderr = sink();
  const result = await invokeAgent({
    prompt: 'hello',
    driver: 'generic',
    bin: plain,
    stderr,
  });
  assert.equal(result.measured, false);
  assert.equal(result.usage, null);
  assert.equal(result.text, 'done');
  assert.match(stderr.text, /UNMEASURED/);
});

test('JSON is recovered from prose when the driver cannot constrain output', async () => {
  const { data, measured } = await invokeAgentJson({
    prompt: 'Classify this ticket',
    driver: 'generic',
    bin: plain,
    stderr: sink(),
  });
  assert.equal(data.class, 'feature');
  assert.equal(data.area, 'AUTH');
  assert.equal(measured, false);
});

test('sdd cost records an unmeasured run rather than refusing or zeroing it', async () => {
  const root = await scratch('sdd-driver-');
  const stderr = sink();
  const { record } = await runWrapped({
    id: 'GEN-1',
    ticketClass: 'feature',
    phase: 'baseline',
    command: [process.execPath, plain, 'hello'],
    root,
    stdout: sink(),
    stderr,
    driver: 'generic',
  });

  assert.equal(record.measured, false);
  assert.equal(record.tokens, null);
  assert.equal(record.driver, 'generic');
  assert.match(stderr.text, /UNMEASURED/);
  assert.equal((await readRecords('GEN-1', root)).length, 1, 'the run is recorded, not dropped');
});

test('unmeasured runs are excluded from aggregates and named in the report', () => {
  const measured = {
    kind: 'run', id: 'A', class: 'feature', phase: 'baseline', ok: true, measured: true,
    tokens: { input: 100, cache_read: 0, cache_write: 0, output: 0, thinking: 0 },
    cost_usd: 1, turns: 2, files_read: 1,
  };
  const un = { kind: 'run', id: 'B', class: 'feature', phase: 'baseline', ok: true, measured: false, driver: 'generic', tokens: null };

  const agg = aggregate([measured, un]);
  assert.equal(agg.rows[0].n, 1, 'only the measured run counts');
  assert.equal(agg.unmeasured.length, 1);

  const out = formatReport(agg);
  assert.match(out, /1 run\(s\) excluded as unmeasured — driver\(s\) reporting no token usage: generic/);
  assert.match(out, /cannot enter a baseline/);
});

test('records written before drivers existed still count as measured', () => {
  const legacy = {
    kind: 'run', id: 'OLD', class: 'bug', phase: 'baseline', ok: true,
    tokens: { input: 50, cache_read: 0, cache_write: 0, output: 0, thinking: 0 },
  };
  assert.equal(aggregate([legacy]).rows[0].n, 1);
});
