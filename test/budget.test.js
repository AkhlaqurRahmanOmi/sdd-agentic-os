import assert from 'node:assert/strict';
import test from 'node:test';
import { checkBudgets, formatBudgets, readBudgets, setCeiling } from '../src/cost/budget.js';
import { append } from '../src/cost/store.js';
import { scratch } from './helpers.js';

const runRecord = (id, input, ok = true) => ({
  kind: 'run',
  id,
  class: 'feature',
  phase: 'baseline',
  ok,
  tokens: { input, cache_read: 0, cache_write: 0, output: 0, thinking: 0 },
});

test('with no ceilings the check passes and says why it is empty', async () => {
  const root = await scratch('sdd-budget-');
  assert.deepEqual(await checkBudgets(root), []);
  assert.match(formatBudgets([]), /until tickets\nhave actually been measured/);
});

test('a ceiling is set from the latest successful run', async () => {
  const root = await scratch('sdd-budget-');
  await append(runRecord('A', 1000), root);
  const { tokens, previous } = await setCeiling('A', { root });
  assert.equal(tokens, 1000);
  assert.equal(previous, null);
  assert.equal((await readBudgets(root)).ceilings.A.tokens, 1000);
});

test('a change with no successful run cannot get a ceiling', async () => {
  const root = await scratch('sdd-budget-');
  await append(runRecord('A', 1000, false), root);
  await assert.rejects(setCeiling('A', { root }), /no successful recorded run/);
});

test('the ratchet lowers freely', async () => {
  const root = await scratch('sdd-budget-');
  await append(runRecord('A', 1000), root);
  await setCeiling('A', { root });
  await append(runRecord('A', 600), root);
  const { tokens, previous } = await setCeiling('A', { root });
  assert.equal(previous, 1000);
  assert.equal(tokens, 600);
});

test('the ratchet refuses to rise without being told to', async () => {
  const root = await scratch('sdd-budget-');
  await append(runRecord('A', 1000), root);
  await setCeiling('A', { root });
  await append(runRecord('A', 1500), root);
  await assert.rejects(setCeiling('A', { root }), /A ratchet only moves down/);
});

test('--raise lifts the ceiling deliberately', async () => {
  const root = await scratch('sdd-budget-');
  await append(runRecord('A', 1000), root);
  await setCeiling('A', { root });
  await append(runRecord('A', 1500), root);
  const { tokens } = await setCeiling('A', { root, raise: true });
  assert.equal(tokens, 1500);
});

test('a run over its ceiling fails the check', async () => {
  const root = await scratch('sdd-budget-');
  await append(runRecord('A', 1000), root);
  await setCeiling('A', { root });
  await append(runRecord('A', 1400), root);

  const results = await checkBudgets(root);
  assert.equal(results[0].status, 'over');
  assert.equal(results[0].overBy, 400);
  assert.match(formatBudgets(results), /budget: failed/);
});

test('a run under its ceiling passes', async () => {
  const root = await scratch('sdd-budget-');
  await append(runRecord('A', 1000), root);
  await setCeiling('A', { root });
  await append(runRecord('A', 900), root);
  assert.match(formatBudgets(await checkBudgets(root)), /budget: ok/);
});

test('failed runs are ignored when checking against a ceiling', async () => {
  const root = await scratch('sdd-budget-');
  await append(runRecord('A', 1000), root);
  await setCeiling('A', { root });
  await append(runRecord('A', 99999, false), root);
  assert.equal((await checkBudgets(root))[0].status, 'under');
});
