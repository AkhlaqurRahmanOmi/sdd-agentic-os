#!/usr/bin/env node
// Stands in for `claude -p --output-format stream-json` in tests.
const fail = process.argv.includes('--fail');
const silent = process.argv.includes('--silent');
if (!silent) {
  const lines = [
    { type: 'system', subtype: 'init', session_id: 's1', model: 'claude-opus-5' },
    {
      type: 'assistant',
      message: {
        model: 'claude-opus-5',
        content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/repo/x.js' } }],
      },
    },
    {
      type: 'result',
      subtype: 'success',
      is_error: fail,
      terminal_reason: fail ? 'api_error' : 'end_turn',
      total_cost_usd: 0.25,
      num_turns: 3,
      duration_ms: 4000,
      duration_api_ms: 3000,
      usage: {
        input_tokens: 100,
        cache_read_input_tokens: 900,
        cache_creation_input_tokens: 50,
        output_tokens: 200,
        output_tokens_details: { thinking_tokens: 75 },
      },
    },
  ];
  for (const line of lines) process.stdout.write(`${JSON.stringify(line)}\n`);
}
process.exit(fail ? 1 : 0);
