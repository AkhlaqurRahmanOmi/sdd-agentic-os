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

export async function invokeAgent({
  prompt,
  model,
  schema = null,
  cwd = process.cwd(),
  allowedTools = null,
  config = {},
  driver: driverName = null,
  bin: binOverride = null,
  stderr = process.stderr,
}) {
  const driver = resolveDriver({ name: driverName, config });
  const bin = binOverride ?? resolveBin({ driver, config });

  // A driver that cannot constrain output to a schema still gets asked for
  // JSON, in the prompt, and the caller validates what comes back.
  const effectiveSchema = driver.capabilities.schema ? schema : null;
  const effectiveTools = driver.capabilities.allowedTools ? allowedTools : null;

  const parser = driver.createParser();
  const child = spawn(bin, driver.buildArgs({ prompt, model, schema: effectiveSchema, allowedTools: effectiveTools }), {
    cwd,
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => parser.handleLine(line));

  const exitCode = await new Promise((resolve, reject) => {
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
      lines.close();
      resolve(code ?? 0);
    });
  });

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
