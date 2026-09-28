// Shells out to an agent CLI. No MCP server, no SDK -- a subprocess, per the
// plan's token rules, so any harness that can run a shell can run this.
//
// Which CLI, and how to read what it prints, is the driver's business. The
// claude-code driver reports token usage; the generic one does not, and says
// so through `capabilities.usage` rather than reporting zero.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolveBin, resolveDriver } from './drivers/index.js';

export class AgentError extends Error {}

// A CLI that cannot reach its API may retry forever rather than exit. Without
// a ceiling every caller inherits that hang -- including `sdd doctor`, whose
// entire job is to report such a failure rather than reproduce it.
export const DEFAULT_AGENT_TIMEOUT_MS = 900_000;

export async function invokeAgent({
  prompt,
  model,
  schema = null,
  cwd = process.cwd(),
  allowedTools = null,
  config = {},
  driver: driverName = null,
  bin: binOverride = null,
  timeoutMs = DEFAULT_AGENT_TIMEOUT_MS,
  stderr = process.stderr,
}) {
  const driver = resolveDriver({ name: driverName, config });
  const bin = binOverride ?? resolveBin({ driver, config });

  // A driver that cannot constrain output to a schema still gets asked for
  // JSON, in the prompt, and the caller validates what comes back.
  const effectiveSchema = driver.capabilities.schema ? schema : null;
  const effectiveTools = driver.capabilities.allowedTools ? allowedTools : null;

  const parser = driver.createParser();
  // `detached` puts the agent in its own process group. Several CLIs are a
  // thin wrapper that spawns a native binary, and signalling only the wrapper
  // leaves the grandchild alive still holding stdout open — the run then
  // never ends even though it was killed.
  const child = spawn(bin, driver.buildArgs({ prompt, model, schema: effectiveSchema, allowedTools: effectiveTools }), {
    cwd,
    stdio: ['ignore', 'pipe', 'inherit'],
    detached: true,
  });

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => parser.handleLine(line));

  let timedOut = false;
  const killTree = () => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // The group is already gone, or this platform has no process groups.
      try {
        child.kill('SIGKILL');
      } catch {
        /* already dead */
      }
    }
    // readline holds the loop open while any descendant keeps the pipe alive,
    // so close the stream rather than waiting for an EOF that may not come.
    child.stdout?.destroy();
  };

  const timer = setTimeout(() => {
    timedOut = true;
    killTree();
  }, timeoutMs);

  const exitCode = await new Promise((resolve, reject) => {
    // With the stream destroyed on timeout, 'close' may not arrive; settle on
    // whichever of the two comes first.
    if (timedOut) resolve(null);
    child.stdout.on('close', () => {
      if (timedOut) resolve(null);
    });
    child.on('error', (err) => {
      reject(
        err.code === 'ENOENT'
          ? new AgentError(
              `\`${bin}\` not found on PATH — set agent.bin in .sdd/config.yaml or SDD_AGENT_BIN`,
            )
          : err,
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      lines.close();
      resolve(code ?? 0);
    });
  }).catch((err) => {
    clearTimeout(timer);
    throw err;
  });

  if (timedOut) {
    throw new AgentError(
      `\`${bin}\` did not finish within ${Math.round(timeoutMs / 1000)}s and was killed. ` +
        'A CLI that cannot reach its API often retries indefinitely rather than exiting.',
    );
  }

  const result = parser.result();
  if (!result) throw new AgentError('agent produced no result event');
  if (!result.ok || exitCode !== 0) {
    throw new AgentError(
      `agent run failed (${result.terminalReason ?? `exit ${exitCode}`}): ${result.text.slice(0, 200)}`,
    );
  }

  stderr.write(
    result.measured
      ? `[sdd] ${model ?? 'default model'}: ` +
        `${result.usage.tokens.input + result.usage.tokens.cache_read} in, ` +
        `${result.usage.tokens.output} out` +
        `${result.usage.costUsd == null ? '' : `, $${result.usage.costUsd.toFixed(4)}`}\n`
      : `[sdd] ${driver.name} driver: run complete, token usage UNMEASURED ` +
        '(this harness does not report it)\n',
  );

  return { text: result.text, usage: result.usage, measured: result.measured, driver: driver.name };
}

// With a schema-capable driver the CLI constrains the output; without one the
// prompt asks and this validates. Either way a non-JSON answer is a failure
// worth naming rather than silently regexing around.
export async function invokeAgentJson(options) {
  const { text, usage, measured, driver } = await invokeAgent(options);
  try {
    return { data: JSON.parse(text), usage, measured, driver };
  } catch {
    // A driver without schema support often wraps JSON in prose; recover the
    // outermost object before giving up, then fail loudly if that is not it.
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return { data: JSON.parse(match[0]), usage, measured, driver };
      } catch {
        /* fall through to the error below */
      }
    }
    throw new AgentError(
      `agent did not return JSON matching the schema. Got:\n${text.slice(0, 400)}`,
    );
  }
}
