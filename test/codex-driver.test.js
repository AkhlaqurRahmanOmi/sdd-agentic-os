import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { codex } from '../src/agent/drivers/codex.js';

const parse = (lines) => {
  const p = codex.createParser();
  for (const l of lines) p.handleLine(JSON.stringify(l));
  return p.result();
};

test('the schema goes to a file, because --output-schema takes a path', () => {
  const args = codex.buildArgs({ prompt: 'p', schema: { type: 'object' } });
  const file = args[args.indexOf('--output-schema') + 1];
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { type: 'object' });
});

test('the prompt is the last positional and the model uses -m', () => {
  const args = codex.buildArgs({ prompt: 'the prompt', model: 'gpt-x' });
  assert.equal(args[args.length - 1], 'the prompt');
  assert.equal(args[args.indexOf('-m') + 1], 'gpt-x');
  assert.ok(args.includes('exec') && args.includes('--json'));
});

test('usage is found wherever it is nested, since the nesting is unconfirmed', () => {
  const flat = parse([
    { type: 'turn.started' },
    { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 7 } },
  ]);
  const nested = parse([
    { type: 'turn.started' },
    { type: 'turn.completed', turn: { stats: { usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 7 } } } },
  ]);
  assert.deepEqual(flat.usage.tokens, nested.usage.tokens);
  // cached reads are reported inside input_tokens; splitting keeps the ledger
  // comparable with the claude-code driver.
  assert.equal(flat.usage.tokens.input, 60);
  assert.equal(flat.usage.tokens.cache_read, 40);
  assert.equal(flat.usage.tokens.output, 7);
});

test('an agent_message item becomes the result text', () => {
  const r = parse([
    { type: 'item.completed', item: { type: 'agent_message', text: 'the answer' } },
    { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
  ]);
  assert.equal(r.text, 'the answer');
  assert.equal(r.measured, true);
  assert.equal(r.ok, true);
});

test('turn.failed marks the run not ok', () => {
  const r = parse([
    { type: 'turn.failed', error: { message: 'rate limited' } },
    { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 0 } },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.terminalReason, /rate limited/);
});

test('an error item marks the run not ok', () => {
  const r = parse([{ type: 'item.completed', item: { type: 'error', message: 'proxy 403' } }]);
  assert.equal(r.ok, false);
  assert.match(r.terminalReason, /proxy 403/);
});

test('a run with no turn.completed produces no record at all', () => {
  assert.equal(parse([{ type: 'thread.started' }, { type: 'turn.started' }]), null);
});

test('turns are counted from turn.started', () => {
  const r = parse([
    { type: 'turn.started' },
    { type: 'turn.started' },
    { type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 5 } },
  ]);
  assert.equal(r.usage.turns, 2);
});

test('non-JSON lines are ignored rather than failing the run', () => {
  const p = codex.createParser();
  p.handleLine('warning: something on stdout');
  p.handleLine(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }));
  assert.equal(p.result().measured, true);
});

test('the driver declares itself unverified until a real run confirms it', () => {
  assert.equal(codex.unverified, true);
  assert.equal(codex.capabilities.usage, true);
  assert.equal(codex.capabilities.schemaIsFile, true);
});
