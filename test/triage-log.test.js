import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkMiss, formatMiss, formatMissRate, latestFor,
  readTriageLog, recordTriage, summarizeNumstat,
} from '../src/spec/triage-log.js';
import { DEFAULT_CONFIG } from '../src/spec/config.js';
import { scratch } from './helpers.js';

const cfg = DEFAULT_CONFIG;                       // 2 files, 50 lines
const d = (id, cls) => ({ kind: 'decision', id, class: cls });

test('numstat totals added and deleted lines, and counts binary files once', () => {
  assert.deepEqual(summarizeNumstat('10\t5\tsrc/a.js\n0\t200\tsrc/b.js'), { files: 2, lines: 215 });
  assert.deepEqual(summarizeNumstat('-\t-\timg.png'), { files: 1, lines: 0 });
  assert.deepEqual(summarizeNumstat(''), { files: 0, lines: 0 });
});

test('a small ticket within its thresholds is not a miss', () => {
  assert.equal(checkMiss(d('A', 'small'), { files: 2, lines: 40 }, cfg), null);
});

test('a small ticket over the file threshold is a miss', () => {
  const miss = checkMiss(d('A', 'small'), { files: 7, lines: 20 }, cfg);
  assert.deepEqual(miss.exceeded, ['files']);
});

test('a small ticket over the line threshold is a miss even at one file', () => {
  const miss = checkMiss(d('A', 'small'), { files: 1, lines: 400 }, cfg);
  assert.deepEqual(miss.exceeded, ['lines']);
});

test('a large diff on a feature ticket is not a miss — it was classed correctly', () => {
  assert.equal(checkMiss(d('A', 'feature'), { files: 40, lines: 3000 }, cfg), null);
  assert.equal(checkMiss(d('A', 'arch'), { files: 40, lines: 3000 }, cfg), null);
});

test('the miss message says it is recorded rather than blocking', () => {
  const out = formatMiss(checkMiss(d('A', 'small'), { files: 9, lines: 900 }, cfg));
  assert.match(out, /Recorded, not blocked/);
  assert.match(out, /small_max_files/);
});

test('re-triaging a ticket means the latest decision wins', () => {
  const log = [d('A', 'small'), d('B', 'tiny'), d('A', 'feature')];
  assert.equal(latestFor(log, 'A').class, 'feature');
});

test('decisions and audits append to one log', async () => {
  const root = await scratch('sdd-triage-');
  await recordTriage({ kind: 'decision', id: 'A', class: 'small' }, root);
  await recordTriage({ kind: 'audit', id: 'A', miss: null }, root);
  const log = await readTriageLog(root);
  assert.equal(log.length, 2);
  assert.ok(log.every((e) => e.at));
});

test('an unaudited log says how to start building the dataset', () => {
  assert.match(formatMissRate([d('A', 'small')]), /none audited yet/);
});

test('the rate report names the largest miss, since that is what bounds a threshold', () => {
  const out = formatMissRate([
    { kind: 'audit', id: 'A', miss: { class: 'small', diff: { files: 9, lines: 300 } } },
    { kind: 'audit', id: 'B', miss: null },
  ]);
  assert.match(out, /2 audited, 1 miss\(es\) \(50%\)/);
  assert.match(out, /9 file\(s\) and 300 line\(s\)/);
});
