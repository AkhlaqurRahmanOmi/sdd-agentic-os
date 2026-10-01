import assert from 'node:assert/strict';
import test from 'node:test';
import { recordAgentRun, readRecords } from '../src/cost/store.js';
import { aggregate, formatReport } from '../src/cost/report.js';
import { setCeiling, latestRun } from '../src/cost/budget.js';
import { scratch } from './helpers.js';

const usage = (input, output = 0) => ({
  tokens: { input, cache_read: 0, cache_write: 0, output, thinking: 0 },
  costUsd: input / 100000,
  model: 'm',
  turns: 1,
  filesRead: [],
});

test('a phase call lands in the ledger instead of only on stderr', async () => {
  const root = await scratch('sdd-ledger-');
  await recordAgentRun({ id: 'A-1', step: 'triage', usage: usage(1000), driver: 'claude-code' }, root);
  const [rec] = await readRecords('A-1', root);
  assert.equal(rec.step, 'triage');
  assert.equal(rec.phase, 'sdd', 'spec-pipeline calls default to the sdd arm');
  assert.equal(rec.tokens.input, 1000);
  assert.equal(rec.measured, true);
});

test('an unknown step is rejected rather than silently recorded', async () => {
  await assert.rejects(
    recordAgentRun({ id: 'A-1', step: 'guessing', usage: usage(1) }, await scratch('sdd-ledger-')),
    /unknown step/,
  );
});

test("a ticket's cost is the sum of its steps, not the median of them", () => {
  const r = (step, input) => ({
    kind: 'run', id: 'A-1', class: 'feature', phase: 'sdd', step, ok: true, measured: true,
    tokens: { input, cache_read: 0, cache_write: 0, output: 0, thinking: 0 },
    cost_usd: input / 1000, turns: 1, files_read: 0, model: 'm',
  });
  const { rows } = aggregate([r('triage', 30), r('propose', 200), r('tasks', 1100)]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].n, 1, 'three steps are one ticket, not three');
  assert.equal(rows[0].total, 1330, 'steps sum');
});

test('the report shows where inside the pipeline the tokens went', () => {
  const r = (step, input, model) => ({
    kind: 'run', id: 'A-1', class: 'feature', phase: 'sdd', step, ok: true, measured: true,
    tokens: { input, cache_read: 0, cache_write: 0, output: 0, thinking: 0 },
    cost_usd: input / 1000, turns: 1, files_read: 0, model,
  });
  const out = formatReport(
    aggregate([r('triage', 30, 'haiku'), r('propose', 70, 'opus'), r('tasks', 900, 'sonnet')]),
  );
  assert.match(out, /Where the pipeline spent it/);
  assert.match(out, /tasks/);
  assert.match(out, /90%/, 'the step that dominates is visible as a share');
});

test('a re-run replaces that step rather than adding to it', async () => {
  const root = await scratch('sdd-ledger-');
  await recordAgentRun({ id: 'A-1', step: 'triage', usage: usage(100) }, root);
  await recordAgentRun({ id: 'A-1', step: 'tasks', usage: usage(900) }, root);
  assert.equal((await latestRun('A-1', root)).tokens.input, 1000);

  // Running `sdd tasks` again must not make the ticket look twice as expensive.
  await recordAgentRun({ id: 'A-1', step: 'tasks', usage: usage(400) }, root);
  assert.equal((await latestRun('A-1', root)).tokens.input, 500);
});

test('a ceiling covers the whole pipeline, not just the implementation run', async () => {
  const root = await scratch('sdd-ledger-');
  await recordAgentRun({ id: 'A-1', step: 'triage', usage: usage(100) }, root);
  await recordAgentRun({ id: 'A-1', step: 'propose', usage: usage(200) }, root);
  await recordAgentRun({ id: 'A-1', step: 'tasks', usage: usage(700) }, root);
  const { tokens } = await setCeiling('A-1', { root });
  assert.equal(tokens, 1000);
});

test('records predating the step field count as the implementation run', () => {
  const legacy = {
    kind: 'run', id: 'OLD', class: 'bug', phase: 'baseline', ok: true,
    tokens: { input: 50, cache_read: 0, cache_write: 0, output: 0, thinking: 0 },
  };
  const { steps } = aggregate([legacy]);
  assert.equal(steps[0].step, 'implement');
});
