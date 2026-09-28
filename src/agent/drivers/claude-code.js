// Driver for the Claude Code CLI.
//
// This is the behaviour sdd had before drivers existed, moved behind the
// interface unchanged. It is the only driver that reports token usage in a
// machine-readable form, which is why it is the one Phase 0 can measure.

import { createStreamParser } from '../../cost/stream.js';

export const claudeCode = {
  name: 'claude-code',
  defaultBin: 'claude',
  capabilities: { usage: true, schema: true, allowedTools: true },

  buildArgs({ prompt, model, schema, allowedTools }) {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
    if (model) args.push('--model', model);
    if (schema) args.push('--json-schema', JSON.stringify(schema));
    if (allowedTools?.length) args.push('--allowed-tools', ...allowedTools);
    return args;
  },

  createParser() {
    const stream = createStreamParser();
    let text = '';
    return {
      handleLine(line) {
        stream.handleLine(line);
        try {
          const event = JSON.parse(line);
          if (event.type === 'result' && typeof event.result === 'string') text = event.result;
        } catch {
          /* non-JSON diagnostics on stdout are not an error */
        }
      },
      result() {
        const usage = stream.summarize();
        // No result event means the run produced nothing measurable. Callers
        // treat null as "refuse to record", not as a free run.
        if (!usage) return null;
        return { text, usage, measured: true, ok: usage.ok, terminalReason: usage.terminalReason };
      },
    };
  },
};
