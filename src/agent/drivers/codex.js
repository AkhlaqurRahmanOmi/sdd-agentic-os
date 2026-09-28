// Driver for the OpenAI Codex CLI (`codex exec --json`).
//
// VERIFIED against codex-cli 0.158.0 by probing the installed binary:
//   flags   `exec`, `--json`, `-m/--model`, `--output-schema <FILE>`,
//           `-s/--sandbox read-only`, `--skip-git-repo-check`
//   events  thread.started, turn.started, turn.completed, turn.failed,
//           item.completed (with item.type), error
//   usage   the fields input_tokens, cached_input_tokens and output_tokens
//           exist in the binary
//
// NOT VERIFIED: the exact nesting of those usage fields inside turn.completed,
// and the exact shape of an agent_message item. A successful run was not
// possible here — this environment's proxy blocks api.openai.com.
//
// So this driver does not hardcode a path it cannot confirm. It searches the
// event for the token fields wherever they sit, and accepts an agent message
// from any of the plausible shapes. `unverified: true` makes `sdd doctor` say
// so rather than letting a driver that silently reports nothing look healthy.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Depth-limited search for a field. Nesting is the part that was not
// confirmed, so finding the value is deliberately not path-dependent.
function findNumber(node, key, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (typeof node[key] === 'number') return node[key];
  for (const value of Object.values(node)) {
    const found = findNumber(value, key, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function findText(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (typeof node.text === 'string' && node.text) return node.text;
  if (typeof node.message === 'string' && node.message) return node.message;
  if (typeof node.content === 'string' && node.content) return node.content;
  for (const value of Object.values(node)) {
    const found = findText(value, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

export const codex = {
  name: 'codex',
  defaultBin: 'codex',
  unverified: true,
  capabilities: { usage: true, schema: true, allowedTools: false, schemaIsFile: true },

  buildArgs({ prompt, model, schema, sandbox = 'read-only' }) {
    const args = ['exec', '--json', '--skip-git-repo-check', '--sandbox', sandbox];
    if (model) args.push('-m', model);
    if (schema) {
      // --output-schema takes a path, not inline JSON. The file outlives this
      // call only until the process exits, which is the whole run.
      const dir = mkdtempSync(path.join(tmpdir(), 'sdd-codex-'));
      const file = path.join(dir, 'schema.json');
      writeFileSync(file, JSON.stringify(schema), 'utf8');
      args.push('--output-schema', file);
    }
    args.push(prompt);
    return args;
  },

  createParser() {
    let text = '';
    let usage = null;
    let failed = false;
    let failureReason = null;
    let turns = 0;

    return {
      handleLine(line) {
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (!event || typeof event !== 'object') return;

        if (event.type === 'turn.started') turns += 1;

        if (event.type === 'item.completed' && event.item) {
          if (event.item.type === 'agent_message') {
            const found = findText(event.item);
            if (found) text = found;
          }
          if (event.item.type === 'error') {
            failed = true;
            failureReason = event.item.message ?? 'error item';
          }
        }

        if (event.type === 'turn.failed') {
          failed = true;
          failureReason = findText(event) ?? 'turn.failed';
        }

        if (event.type === 'turn.completed') {
          const input = findNumber(event, 'input_tokens');
          const cached = findNumber(event, 'cached_input_tokens');
          const output = findNumber(event, 'output_tokens');
          if (input !== null || output !== null) {
            usage = {
              model: null,
              sessionId: null,
              tokens: {
                // Codex reports cached reads inside input_tokens; splitting
                // them keeps the ledger comparable with the Claude driver.
                input: Math.max((input ?? 0) - (cached ?? 0), 0),
                cache_read: cached ?? 0,
                cache_write: 0,
                output: output ?? 0,
                thinking: 0,
              },
              costUsd: null,
              wallMs: null,
              apiMs: null,
              turns,
              readCalls: 0,
              filesRead: [],
              ok: !failed,
              terminalReason: failed ? failureReason : 'completed',
              modelUsage: {},
            };
          }
        }
      },

      result() {
        // No turn.completed at all means the run did not finish; that is the
        // same "produced nothing measurable" case the caller refuses to record.
        if (!usage && !failed) return null;
        return {
          text,
          usage,
          measured: usage !== null,
          ok: !failed,
          terminalReason: failureReason,
        };
      },
    };
  },
};
