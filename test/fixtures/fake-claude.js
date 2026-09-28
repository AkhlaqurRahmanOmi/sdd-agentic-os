#!/usr/bin/env node
// Stands in for the `claude` CLI so the triage -> propose -> tasks -> validate
// pipeline can be exercised without auth. Replies based on which prompt it sees.
const args = process.argv.slice(2);
const prompt = args[args.indexOf('-p') + 1] ?? '';

let result;
if (prompt.includes('Classify this ticket')) {
  result = JSON.stringify(
    prompt.includes('TYPO')
      ? {
          class: 'small',
          area: 'DOCS',
          reason: 'One word in one file.',
          acceptance_criteria: ['The README says "receive", not "recieve".'],
        }
      : {
          class: 'feature',
          area: 'AUTH',
          reason: 'Behaviour has to be stated before it is built.',
          acceptance_criteria: [],
        },
  );
} else if (prompt.includes('Write the requirements')) {
  result = `# Requirements: Lock out repeated failed logins

## REQ-AUTH-001
When a user submits invalid credentials five times within ten minutes, the
system shall reject further attempts for that account for fifteen minutes.

## REQ-AUTH-002
While an account is locked out, the system shall return 401 without revealing
that the account is locked.

## Open Questions
- Does the lockout window count attempts across IP addresses or per IP?`;
} else if (prompt.includes('Decompose these requirements')) {
  result = JSON.stringify({
    tasks: [
      {
        id: 'T01',
        goal: 'Count failed attempts per account in a rolling window',
        reqs: ['REQ-AUTH-001'],
        requirement_text:
          'When a user submits invalid credentials five times within ten minutes, the system shall reject further attempts for that account for fifteen minutes.',
        files: ['src/auth/attempts.js (recordFailure)'],
        test: 'npm test -- attempts',
        done_when: ['A sixth attempt within the window is rejected.'],
      },
      {
        id: 'T02',
        goal: 'Return an indistinguishable 401 while locked out',
        reqs: ['REQ-AUTH-002'],
        requirement_text:
          'While an account is locked out, the system shall return 401 without revealing that the account is locked.',
        files: ['src/auth/login.js (handleLogin)'],
        test: 'npm test -- login',
        done_when: ['A locked account and a wrong password return identical responses.'],
      },
    ],
  });
} else {
  result = 'unrecognised prompt';
}

const usage = {
  input_tokens: 1200,
  cache_read_input_tokens: 400,
  cache_creation_input_tokens: 0,
  output_tokens: 600,
  output_tokens_details: { thinking_tokens: 0 },
};
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'unknown';

for (const event of [
  { type: 'system', subtype: 'init', session_id: 'fake', model },
  { type: 'result', subtype: 'success', is_error: false, result, usage, total_cost_usd: 0.01, num_turns: 1, duration_ms: 10 },
]) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
