// Shells out to the `claude` CLI. No MCP server, no SDK — a subprocess, per
// the plan's token rules, so every harness that can run a shell can run this.
//
// The same stream parser Phase 0 uses reads the response, which means every
// model call sdd makes reports its own token usage. That is deliberate: the
// spec layer has to be measurable by the tool that decides whether it earns
// its cost.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createStreamParser } from '../cost/stream.js';

export class AgentError extends Error {}

export async function invokeAgent({
  prompt,
  model,
  schema = null,
  cwd = process.cwd(),
  allowedTools = null,
  bin = process.env.SDD_CLAUDE_BIN ?? 'claude',
  stderr = process.stderr,
}) {
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
  if (model) args.push('--model', model);
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  if (allowedTools) args.push('--allowed-tools', ...allowedTools);

  const parser = createStreamParser();
  const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] });

  let resultText = '';
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => {
    parser.handleLine(line);
    try {
      const event = JSON.parse(line);
      if (event.type === 'result' && typeof event.result === 'string') resultText = event.result;
    } catch {
      /* non-JSON diagnostics on stdout are not an error */
    }
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', (err) => {
      reject(
        err.code === 'ENOENT'
          ? new AgentError(`\`${bin}\` not found on PATH — set SDD_CLAUDE_BIN if it lives elsewhere`)
          : err,
      );
    });
    child.on('close', (code) => {
      lines.close();
      resolve(code ?? 0);
    });
  });

  const usage = parser.summarize();
  if (!usage) throw new AgentError('agent produced no result event');
  if (!usage.ok || exitCode !== 0) {
    throw new AgentError(
      `agent run failed (${usage.terminalReason ?? `exit ${exitCode}`}): ${resultText.slice(0, 200)}`,
    );
  }

  stderr.write(
    `[sdd] ${model ?? 'default model'}: ` +
      `${usage.tokens.input + usage.tokens.cache_read} in, ${usage.tokens.output} out` +
      `${usage.costUsd == null ? '' : `, $${usage.costUsd.toFixed(4)}`}\n`,
  );

  return { text: resultText, usage };
}

// With --json-schema the CLI still returns the payload as the result string,
// so parsing is ours to do. A model that answered in prose around the JSON is
// a failure worth naming rather than silently regexing around.
export async function invokeAgentJson(options) {
  const { text, usage } = await invokeAgent(options);
  try {
    return { data: JSON.parse(text), usage };
  } catch {
    throw new AgentError(
      `agent did not return JSON matching the schema. Got:\n${text.slice(0, 400)}`,
    );
  }
}
