import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assign, balance, formatPlan, readAssignment, writeAssignment } from '../src/cost/assignment.js';
import { runWrapped } from '../src/cost/run.js';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const agent = path.join(here, 'fixtures', 'fake-agent.js');
const scratch = () => mkdtemp(path.join(tmpdir(), 'sdd-assign-'));
const sink = () => ({ chunks: [], write(c) { this.chunks.push(c); }, get text() { return this.chunks.join(''); } });

const tickets = [
  { id: 'B1', class: 'bug' }, { id: 'B2', class: 'bug' },
  { id: 'B3', class: 'bug' }, { id: 'B4', class: 'bug' },
  { id: 'F1', class: 'feature' }, { id: 'F2', class: 'feature' }, { id: 'F3', class: 'feature' },
];

test('each class is split across both arms, not bundled into one', () => {
  const rows = balance(assign(tickets));
  assert.deepEqual(rows.find((r) => r.class === 'bug'), { class: 'bug', baseline: 2, sdd: 2, min: 2 });
  const feature = rows.find((r) => r.class === 'feature');
  assert.equal(feature.baseline + feature.sdd, 3);
  assert.equal(feature.min, 1);
});

test('the same seed produces the same split', () => {
  assert.deepEqual(assign(tickets, 'x').assignments, assign(tickets, 'x').assignments);
});

test('a different seed can produce a different split', () => {
  const seeds = ['a', 'b', 'c', 'd', 'e'].map((s) => JSON.stringify(assign(tickets, s).assignments));
  assert.ok(new Set(seeds).size > 1);
});

test('a class too thin to support a gate decision is called out', () => {
  assert.match(formatPlan(assign(tickets)), /Thin arms: feature \(min 1\)/);
});

test('an unknown ticket class is rejected', () => {
  assert.throws(() => assign([{ id: 'X', class: 'enormous' }]), /class must be one of/);
});

test('running a ticket in the wrong arm is refused', async () => {
  const root = await scratch();
  await writeAssignment(assign([{ id: 'F1', class: 'feature' }], 'fixed'), root);
  const arm = (await readAssignment(root)).assignments.F1.arm;
  const wrong = arm === 'baseline' ? 'sdd' : 'baseline';

  await assert.rejects(
    runWrapped({
      id: 'F1', ticketClass: 'feature', phase: wrong,
      command: [process.execPath, agent], root, stdout: sink(), stderr: sink(),
    }),
    /invalidates the matched split/,
  );
});

test('--force runs the wrong arm but says the comparison no longer holds', async () => {
  const root = await scratch();
  await writeAssignment(assign([{ id: 'F1', class: 'feature' }], 'fixed'), root);
  const arm = (await readAssignment(root)).assignments.F1.arm;
  const stderr = sink();
  await runWrapped({
    id: 'F1', ticketClass: 'feature', phase: arm === 'baseline' ? 'sdd' : 'baseline',
    command: [process.execPath, agent], root, stdout: sink(), stderr, force: true,
  });
  assert.match(stderr.text, /comparison no longer holds/);
});

test('a ticket outside the split is recorded but flagged as outside it', async () => {
  const root = await scratch();
  await writeAssignment(assign([{ id: 'F1', class: 'feature' }], 'fixed'), root);
  const stderr = sink();
  await runWrapped({
    id: 'OTHER', ticketClass: 'bug', phase: 'baseline',
    command: [process.execPath, agent], root, stdout: sink(), stderr,
  });
  assert.match(stderr.text, /not in the matched split/);
});

test('a class mismatch against the plan stops the run', async () => {
  const root = await scratch();
  await writeAssignment(assign([{ id: 'F1', class: 'feature' }], 'fixed'), root);
  const arm = (await readAssignment(root)).assignments.F1.arm;
  await assert.rejects(
    runWrapped({
      id: 'F1', ticketClass: 'bug', phase: arm,
      command: [process.execPath, agent], root, stdout: sink(), stderr: sink(),
    }),
    /assigned class "feature"/,
  );
});
