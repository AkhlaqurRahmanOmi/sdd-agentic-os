import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { approveCommand } from '../src/commands/approve.js';
import { initCommand } from '../src/commands/init.js';
import { proposeCommand } from '../src/commands/propose.js';
import { tasksCommand } from '../src/commands/tasks.js';
import { triageCommand } from '../src/commands/triage.js';
import { validateCommand } from '../src/commands/validate.js';
import { readGate } from '../src/spec/gate.js';
import { scratch, sink } from './helpers.js';

process.env.SDD_CLAUDE_BIN = path.join(
  path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.js',
);

const io = (root) => ({ root, stdout: sink(), stderr: sink() });

async function proposed() {
  const root = await scratch('sdd-gate-');
  await initCommand([], io(root));
  await writeFile(path.join(root, 't.md'), 'Lock out repeated failed logins', 'utf8');
  await triageCommand([], { ...io(root), flags: { ticket: path.join(root, 't.md'), id: 'A-1' } });
  await proposeCommand([], { ...io(root), flags: { id: 'A-1' } });
  return root;
}

test('propose opens the gate as pending', async () => {
  const gate = await readGate('A-1', await proposed());
  assert.equal(gate.state, 'pending');
  assert.equal(gate.open_questions.length, 1);
});

test('tasks refuses while the gate is pending, and names both ways forward', async () => {
  const root = await proposed();
  await assert.rejects(
    tasksCommand([], { ...io(root), flags: { id: 'A-1' } }),
    /sdd approve --id A-1[\s\S]*--bypass-gate/,
  );
});

test('approve records who reviewed it and unblocks tasks', async () => {
  const root = await proposed();
  await approveCommand(['--id', 'A-1', '--by', 'omi', '--force'], io(root));

  const gate = await readGate('A-1', root);
  assert.equal(gate.state, 'approved');
  assert.equal(gate.by, 'omi');

  await tasksCommand([], { ...io(root), flags: { id: 'A-1', force: true } });
});

test('approve refuses while open questions are unanswered', async () => {
  const root = await proposed();
  await assert.rejects(
    approveCommand(['--id', 'A-1'], io(root)),
    /unanswered open question/,
  );
});

test('a bypass proceeds, takes a reason, and does not look like approval', async () => {
  const root = await proposed();
  const ctx = io(root);
  await tasksCommand([], { ...ctx, flags: { id: 'A-1', 'bypass-gate': 'shipping alone at 2am' } });

  const gate = await readGate('A-1', root);
  assert.equal(gate.state, 'bypassed');
  assert.equal(gate.reason, 'shipping alone at 2am');
  assert.equal(gate.open_questions_at_bypass.length, 1);
  assert.match(ctx.stderr.text, /gate bypassed/);
});

test('validate reports a bypassed gate as a warning, not a failure', async () => {
  const root = await proposed();
  await tasksCommand([], { ...io(root), flags: { id: 'A-1', 'bypass-gate': 'nobody around' } });

  const ctx = io(root);
  const code = await validateCommand([], ctx);
  assert.match(ctx.stdout.text, /gate-bypassed/);
  assert.match(ctx.stdout.text, /nobody around/);
  assert.notEqual(code, 0, 'evidence is still a skeleton, so it fails on that');
  assert.doesNotMatch(ctx.stdout.text, /ERROR.*gate-bypassed/);
});

test('--strict turns a bypassed gate into an error', async () => {
  const root = await proposed();
  await tasksCommand([], { ...io(root), flags: { id: 'A-1', 'bypass-gate': 'nobody around' } });

  const ctx = io(root);
  await validateCommand(['--strict'], ctx);
  assert.match(ctx.stdout.text, /ERROR.*gate was bypassed/);
});

test('approving after a bypass clears it', async () => {
  const root = await proposed();
  await tasksCommand([], { ...io(root), flags: { id: 'A-1', 'bypass-gate': 'later' } });
  const ctx = io(root);
  await approveCommand(['--id', 'A-1', '--force', '--by', 'omi'], ctx);

  assert.equal((await readGate('A-1', root)).state, 'approved');
  assert.match(ctx.stdout.text, /was bypassed; now reviewed/);
});

test('a change with no gate file is not penalised', async () => {
  const root = await scratch('sdd-gate-');
  await initCommand([], io(root));
  const { writeValidChange } = await import('./helpers.js');
  const id = await writeValidChange(root);
  const ctx = io(root);
  assert.equal(await validateCommand(['--change', id], ctx), 0);
});
