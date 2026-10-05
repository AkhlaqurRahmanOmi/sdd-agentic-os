#!/usr/bin/env node
// Reproduces what a real model did: prose where an anchor should be.
const args = process.argv.slice(2);
const prompt = args[args.indexOf('-p') + 1] ?? '';
let result = 'unrecognised';
if (prompt.includes('Decompose these requirements')) {
  result = JSON.stringify({
    tasks: [
      {
        id: 'T01', goal: 'Do the thing', reqs: ['REQ-AUTH-001'],
        requirement_text: 'When a user fails five times, the system shall lock the account.',
        files: ['src/audit/audit.module.ts (new)', 'existing code in the auth providers'],
        test: 'npm test', done_when: ['It works.'],
      },
    ],
  });
}
for (const e of [
  { type: 'system', subtype: 'init', session_id: 'f', model: 'm' },
  { type: 'result', subtype: 'success', is_error: false, result, total_cost_usd: 0.01, num_turns: 1,
    duration_ms: 5, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0, output_tokens_details: { thinking_tokens: 0 } } },
]) process.stdout.write(`${JSON.stringify(e)}\n`);
