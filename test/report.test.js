import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregate, formatReport, median } from '../src/cost/report.js';

const run = (id, cls, phase, total, extra = {}) => ({
  kind: 'run',
  id,
  class: cls,
  phase,
  ok: true,
  tokens: { input: total, cache_read: 0, cache_write: 0, output: 0, thinking: 0 },
  cost_usd: 1,
  turns: 5,
  files_read: 3,
  ...extra,
});

test('median handles even and odd counts', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test('failed runs are excluded from aggregates but still reported', () => {
  const { rows, failed } = aggregate([
    run('A', 'bug', 'baseline', 100),
    run('B', 'bug', 'baseline', 300),
    { ...run('C', 'bug', 'baseline', 999999), ok: false },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].n, 2);
  assert.equal(rows[0].total, 200);
  assert.deepEqual(rows[0].range, [100, 300]);
  assert.equal(failed.length, 1);
});

test('annotations attach to the run with the same id and phase', () => {
  const { rows } = aggregate([
    run('A', 'feature', 'baseline', 100),
    { kind: 'annotation', id: 'A', phase: 'baseline', corrections: 4, followup_fix: true },
    { kind: 'annotation', id: 'A', phase: 'sdd', corrections: 1, followup_fix: false },
  ]);
  assert.equal(rows[0].correctionsN, 1);
  assert.equal(rows[0].corrections, 4);
  assert.equal(rows[0].followupFixes, 1);
});

test('the report warns when no rework has been recorded', () => {
  const out = formatReport(aggregate([run('A', 'bug', 'baseline', 100)]));
  assert.match(out, /No rework annotations recorded/);
});

test('comparing phases flags that the runs were not matched', () => {
  const out = formatReport(
    aggregate([run('A', 'feature', 'baseline', 1000), run('B', 'feature', 'sdd', 500)]),
  );
  assert.match(out, /Phase comparison by class/);
  assert.match(out, /-50%/);
  assert.match(out, /directional/);
});

test('an empty store reports nothing rather than an empty table', () => {
  assert.match(formatReport(aggregate([])), /No measured runs recorded yet/);
});
