import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { triageCommand } from '../src/commands/triage.js';
import { proposeCommand } from '../src/commands/propose.js';
import { tasksCommand } from '../src/commands/tasks.js';
import { approveCommand } from '../src/commands/approve.js';
import { validateCommand } from '../src/commands/validate.js';
import { initCommand } from '../src/commands/init.js';
import { changeDir, requirementsPath, taskCardsDir } from '../src/spec/paths.js';
import { scratch, sink } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.SDD_CLAUDE_BIN = path.join(here, 'fixtures', 'fake-claude.js');

async function ticketAt(root, name, body) {
  const file = path.join(root, name);
  await writeFile(file, body, 'utf8');
  return file;
}

const io = (root) => ({ root, stdout: sink(), stderr: sink() });

test('a small ticket exits at triage with acceptance criteria and writes nothing', async () => {
  const root = await scratch('sdd-pipe-');
  await initCommand([], io(root));
  const ticket = await ticketAt(root, 't.md', 'TYPO: README says recieve');
  const ctx = io(root);

  assert.equal(await triageCommand([], { ...ctx, flags: { ticket, id: 'DOCS-1' } }), 0);
  assert.match(ctx.stdout.text, /class: small/);
  assert.match(ctx.stdout.text, /receive/);
  await assert.rejects(readdir(changeDir('DOCS-1', root)), { code: 'ENOENT' });
});

test('a feature ticket scaffolds a change directory', async () => {
  const root = await scratch('sdd-pipe-');
  await initCommand([], io(root));
  const ticket = await ticketAt(root, 't.md', 'Lock out repeated failed logins');
  const ctx = io(root);

  await triageCommand([], { ...ctx, flags: { ticket, id: 'AUTH-9' } });
  assert.match(ctx.stdout.text, /class: feature/);
  assert.equal((await readFile(path.join(changeDir('AUTH-9', root), 'area'), 'utf8')).trim(), 'AUTH');
});

test('the full pipeline produces a change that validates', async () => {
  const root = await scratch('sdd-pipe-');
  await initCommand([], io(root));
  const ticket = await ticketAt(root, 't.md', 'Lock out repeated failed logins');

  await triageCommand([], { ...io(root), flags: { ticket, id: 'AUTH-9' } });
  await proposeCommand([], { ...io(root), flags: { id: 'AUTH-9' } });
  // The fake model leaves an open question, so the gate is bypassed rather
  // than approved — which is itself the realistic path this test wants.
  await tasksCommand([], { ...io(root), flags: { id: 'AUTH-9', 'bypass-gate': 'test' } });

  const cards = (await readdir(taskCardsDir('AUTH-9', root))).sort();
  assert.deepEqual(cards, ['T01.md', 'T02.md']);

  const ctx = io(root);
  // Evidence is a skeleton, so validate must fail here — that is the point.
  assert.equal(await validateCommand([], ctx), 1);
  assert.match(ctx.stdout.text, /req-without-evidence/);

  // Fill the evidence the way an agent would, and it passes.
  await writeFile(
    path.join(changeDir('AUTH-9', root), 'evidence.md'),
    `# Evidence: AUTH-9

## REQ-AUTH-001
- test: npm test -- attempts
  exit: 0

## REQ-AUTH-002
- test: npm test -- login
  exit: 0
`,
    'utf8',
  );
  const after = io(root);
  assert.equal(await validateCommand([], after), 0);
  assert.match(after.stdout.text, /validate: ok/);
});

test('task cards inline their requirement text so they stand alone', async () => {
  const root = await scratch('sdd-pipe-');
  await initCommand([], io(root));
  const ticket = await ticketAt(root, 't.md', 'Lock out repeated failed logins');
  await triageCommand([], { ...io(root), flags: { ticket, id: 'AUTH-9' } });
  await proposeCommand([], { ...io(root), flags: { id: 'AUTH-9' } });
  await tasksCommand([], { ...io(root), flags: { id: 'AUTH-9', 'bypass-gate': 'test' } });

  const card = await readFile(path.join(taskCardsDir('AUTH-9', root), 'T01.md'), 'utf8');
  assert.match(card, /REQ: REQ-AUTH-001/);
  assert.match(card, /five times within ten minutes/);
  assert.match(card, /npm test -- attempts/);
});

test('tasks refuses to decompose around unanswered open questions', async () => {
  const root = await scratch('sdd-pipe-');
  await initCommand([], io(root));
  const ticket = await ticketAt(root, 't.md', 'Lock out repeated failed logins');
  await triageCommand([], { ...io(root), flags: { ticket, id: 'AUTH-9' } });
  await proposeCommand([], { ...io(root), flags: { id: 'AUTH-9' } });

  // The gate stops it first; once the gate is cleared, the open questions do.
  await assert.rejects(
    tasksCommand([], { ...io(root), flags: { id: 'AUTH-9' } }),
    /have not been reviewed/,
  );
  await approveCommand(['--id', 'AUTH-9', '--force', '--by', 'tester'], io(root));
  await assert.rejects(
    tasksCommand([], { ...io(root), flags: { id: 'AUTH-9' } }),
    /open question/,
  );
});

test('propose refuses to overwrite requirements a human may have reviewed', async () => {
  const root = await scratch('sdd-pipe-');
  await initCommand([], io(root));
  const ticket = await ticketAt(root, 't.md', 'Lock out repeated failed logins');
  await triageCommand([], { ...io(root), flags: { ticket, id: 'AUTH-9' } });
  await proposeCommand([], { ...io(root), flags: { id: 'AUTH-9' } });

  await assert.rejects(
    proposeCommand([], { ...io(root), flags: { id: 'AUTH-9' } }),
    /already exists/,
  );
});

test('propose reports the open questions the human gate exists to catch', async () => {
  const root = await scratch('sdd-pipe-');
  await initCommand([], io(root));
  const ticket = await ticketAt(root, 't.md', 'Lock out repeated failed logins');
  await triageCommand([], { ...io(root), flags: { ticket, id: 'AUTH-9' } });
  const ctx = io(root);
  await proposeCommand([], { ...ctx, flags: { id: 'AUTH-9' } });

  assert.match(ctx.stdout.text, /1 open question/);
  assert.match(ctx.stdout.text, /across IP addresses/);
  assert.match(ctx.stdout.text, /human gate/);
});

test('each phase routes to its configured model', async () => {
  const root = await scratch('sdd-pipe-');
  await initCommand([], io(root));
  const ticket = await ticketAt(root, 't.md', 'Lock out repeated failed logins');

  const triage = io(root);
  await triageCommand([], { ...triage, flags: { ticket, id: 'AUTH-9' } });
  assert.match(triage.stderr.text, /claude-haiku-4-5/);

  const propose = io(root);
  await proposeCommand([], { ...propose, flags: { id: 'AUTH-9' } });
  assert.match(propose.stderr.text, /claude-opus-5/);

  const tasks = io(root);
  await tasksCommand([], { ...tasks, flags: { id: 'AUTH-9', 'bypass-gate': 'test' } });
  assert.match(tasks.stderr.text, /claude-sonnet-5/);
});

test('requirements.md comes back in EARS form and parses', async () => {
  const root = await scratch('sdd-pipe-');
  await initCommand([], io(root));
  const ticket = await ticketAt(root, 't.md', 'Lock out repeated failed logins');
  await triageCommand([], { ...io(root), flags: { ticket, id: 'AUTH-9' } });
  await proposeCommand([], { ...io(root), flags: { id: 'AUTH-9' } });

  const md = await readFile(requirementsPath('AUTH-9', root), 'utf8');
  assert.match(md, /## REQ-AUTH-001/);
  assert.match(md, /shall/);
});

test('tasks refuses to write cards whose anchors are not usable', async () => {
  const root = await scratch('sdd-anchor-');
  await initCommand([], io(root));
  const ticket = await ticketAt(root, 't.md', 'Lock out repeated failed logins');
  await triageCommand([], { ...io(root), flags: { ticket, id: 'AUTH-9' } });
  await proposeCommand([], { ...io(root), flags: { id: 'AUTH-9' } });

  // A model that writes `(new)` and loose prose where anchors belong.
  const previous = process.env.SDD_CLAUDE_BIN;
  process.env.SDD_CLAUDE_BIN = path.join(here, 'fixtures', 'fake-claude-bad-anchors.js');
  try {
    await assert.rejects(
      tasksCommand([], { ...io(root), flags: { id: 'AUTH-9', 'bypass-gate': 'test' } }),
      /anchor\(s\) are not usable/,
    );
    // Nothing was written: the failure lands at decomposition, not later at
    // `sdd index check` a long way from the cause.
    await assert.rejects(readdir(taskCardsDir('AUTH-9', root)), { code: 'ENOENT' });
  } finally {
    process.env.SDD_CLAUDE_BIN = previous;
  }
});
