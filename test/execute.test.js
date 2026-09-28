import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { collectCommands, executeEvidence, runCommand } from '../src/spec/execute.js';
import { parseEvidence } from '../src/spec/parse.js';
import { validateChange } from '../src/spec/validate.js';
import { validateCommand } from '../src/commands/validate.js';
import { changeDir } from '../src/spec/paths.js';
import { scratch, sink, writeValidChange } from './helpers.js';

const evidence = (md) => parseEvidence(md);

test('a command shared by two requirements is only run once', () => {
  const commands = collectCommands(
    evidence(`# E

## REQ-A-001
- test: echo same
  exit: 0

## REQ-A-002
- test: echo same
  exit: 0
`),
  );
  assert.equal(commands.size, 1);
  assert.equal(commands.get('echo same').length, 2);
});

test('non-test evidence entries are not executed', () => {
  const commands = collectCommands(
    evidence('# E\n\n## REQ-A-001\n- review: approved by a human\n'),
  );
  assert.equal(commands.size, 0);
});

test('a command that exits non-zero is reported with its status', async () => {
  const result = await runCommand('exit 3');
  assert.equal(result.exit, 3);
});

test('a command that hangs is killed and reported as a timeout', async () => {
  const result = await runCommand('sleep 5', { timeoutMs: 200 });
  assert.equal(result.timedOut, true);
  assert.equal(result.exit, null);
});

test('evidence claiming exit 0 for a command that fails is a mismatch', async () => {
  const { problems } = await executeEvidence(
    evidence('# E\n\n## REQ-A-001\n- test: exit 1\n  exit: 0\n'),
  );
  assert.equal(problems[0].code, 'evidence-mismatch');
  assert.match(problems[0].message, /claims exit 0 but actually exited 1/);
});

test('evidence that matches reality produces no problem', async () => {
  const { problems, ran } = await executeEvidence(
    evidence('# E\n\n## REQ-A-001\n- test: exit 0\n  exit: 0\n'),
  );
  assert.deepEqual(problems, []);
  assert.equal(ran, 1);
});

test('a command that cannot run at all is reported, not silently passed', async () => {
  const { problems } = await executeEvidence(
    evidence('# E\n\n## REQ-A-001\n- test: this-binary-does-not-exist-xyz\n  exit: 0\n'),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0].code, /evidence-mismatch|evidence-unrunnable/);
});

test('without --execute a fabricated exit status still passes', async () => {
  const root = await scratch('sdd-exec-');
  const id = await writeValidChange(root);
  await writeFile(
    path.join(changeDir(id, root), 'evidence.md'),
    '# E\n\n## REQ-AUTH-001\n- test: exit 1\n  exit: 0\n\n## REQ-AUTH-002\n- test: exit 0\n  exit: 0\n',
    'utf8',
  );
  const result = await validateChange(id, root);
  assert.equal(result.ok, true, 'text-only validation cannot catch a fabricated status');
});

test('with --execute the same fabricated status fails', async () => {
  const root = await scratch('sdd-exec-');
  const id = await writeValidChange(root);
  await writeFile(
    path.join(changeDir(id, root), 'evidence.md'),
    '# E\n\n## REQ-AUTH-001\n- test: exit 1\n  exit: 0\n\n## REQ-AUTH-002\n- test: exit 0\n  exit: 0\n',
    'utf8',
  );
  const result = await validateChange(id, root, { execute: true });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.code === 'evidence-mismatch'));
  assert.equal(result.executed.ran, 2);
});

test('execution is skipped when the shape checks already failed', async () => {
  const root = await scratch('sdd-exec-');
  const id = await writeValidChange(root);
  // Break the shape: a task pointing at a requirement that does not exist.
  const card = path.join(changeDir(id, root), 'tasks', 'T01.md');
  const text = await readFile(card, 'utf8');
  await writeFile(card, text.replace('REQ-AUTH-001', 'REQ-GHOST-001'), 'utf8');

  const result = await validateChange(id, root, { execute: true });
  assert.equal(result.executed, null, 'no point running a suite to learn an id is wrong');
});

test('--execute together with --staged is refused', async () => {
  const root = await scratch('sdd-exec-');
  await assert.rejects(
    validateCommand(['--execute', '--staged'], { root, stdout: sink() }),
    /would run repository-supplied commands/,
  );
});

test('a passing change reports how many commands were executed', async () => {
  const root = await scratch('sdd-exec-');
  const id = await writeValidChange(root);
  await writeFile(
    path.join(changeDir(id, root), 'evidence.md'),
    '# E\n\n## REQ-AUTH-001\n- test: exit 0\n  exit: 0\n\n## REQ-AUTH-002\n- test: exit 0\n  exit: 0\n',
    'utf8',
  );
  const ctx = { root, stdout: sink() };
  assert.equal(await validateCommand(['--execute'], ctx), 0);
  assert.match(ctx.stdout.text, /1 evidence command executed/);
});
