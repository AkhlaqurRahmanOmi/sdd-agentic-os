import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { validateChange, validateConstitution, formatProblems } from '../src/spec/validate.js';
import { changeDir, constitutionPath, sddDir, taskCardsDir } from '../src/spec/paths.js';
import { scratch, writeValidChange } from './helpers.js';

const codes = (result) => result.problems.map((p) => p.code).sort();
const errors = (result) => result.problems.filter((p) => p.severity === 'error').map((p) => p.code);

async function broken(mutate) {
  const root = await scratch('sdd-validate-');
  const id = await writeValidChange(root);
  await mutate(root, id);
  return validateChange(id, root);
}

test('a well-formed change passes with no problems', async () => {
  const root = await scratch('sdd-validate-');
  const id = await writeValidChange(root);
  const result = await validateChange(id, root);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
});

test('a requirement with no evidence fails', async () => {
  const result = await broken(async (root, id) => {
    const file = path.join(changeDir(id, root), 'evidence.md');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.split('## REQ-AUTH-002')[0], 'utf8');
  });
  assert.ok(errors(result).includes('req-without-evidence'));
  assert.equal(result.ok, false);
});

test('evidence recording a non-zero exit fails rather than counting as evidence', async () => {
  const result = await broken(async (root, id) => {
    const file = path.join(changeDir(id, root), 'evidence.md');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace('exit: 0', 'exit: 1'), 'utf8');
  });
  assert.ok(errors(result).includes('evidence-failing'));
});

test('a task mapping to no requirement fails', async () => {
  const result = await broken(async (root, id) => {
    const file = path.join(taskCardsDir(id, root), 'T01.md');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace('REQ: REQ-AUTH-001', ''), 'utf8');
  });
  assert.ok(errors(result).includes('task-without-req'));
});

test('a task referencing a requirement that does not exist fails', async () => {
  const result = await broken(async (root, id) => {
    const file = path.join(taskCardsDir(id, root), 'T01.md');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace('REQ-AUTH-001', 'REQ-GHOST-999'), 'utf8');
  });
  assert.ok(errors(result).includes('unknown-req'));
});

test('a requirement no task covers fails', async () => {
  const result = await broken(async (root, id) => {
    await rm(path.join(taskCardsDir(id, root), 'T02.md'));
    const file = path.join(changeDir(id, root), 'tasks.md');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace(/^.*T02.*$/m, ''), 'utf8');
  });
  assert.ok(errors(result).includes('uncovered-req'));
});

test('an index entry with no card, and a card with no index entry, both fail', async () => {
  const missingCard = await broken(async (root, id) => {
    await rm(path.join(taskCardsDir(id, root), 'T02.md'));
  });
  assert.ok(errors(missingCard).includes('missing-card'));

  const unlisted = await broken(async (root, id) => {
    const file = path.join(changeDir(id, root), 'tasks.md');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace(/^.*T02.*$/m, ''), 'utf8');
  });
  assert.ok(errors(unlisted).includes('unlisted-card'));
});

test('a malformed REQ id fails', async () => {
  const result = await broken(async (root, id) => {
    const file = path.join(changeDir(id, root), 'requirements.md');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace('## REQ-AUTH-001', '## AUTH-1'), 'utf8');
  });
  assert.ok(errors(result).includes('bad-req-id'));
});

test('a duplicate REQ id fails', async () => {
  const result = await broken(async (root, id) => {
    const file = path.join(changeDir(id, root), 'requirements.md');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace('## REQ-AUTH-002', '## REQ-AUTH-001'), 'utf8');
  });
  assert.ok(errors(result).includes('duplicate-req'));
});

test('a card without a test command or done-when fails', async () => {
  const result = await broken(async (root, id) => {
    await writeFile(
      path.join(taskCardsDir(id, root), 'T01.md'),
      '# T01 — Reject invalid credentials\n\nREQ: REQ-AUTH-001\n',
      'utf8',
    );
  });
  assert.ok(errors(result).includes('task-without-test'));
  assert.ok(errors(result).includes('task-without-done'));
});

test('a missing requirements.md fails immediately', async () => {
  const root = await scratch('sdd-validate-');
  await mkdir(changeDir('EMPTY', root), { recursive: true });
  const result = await validateChange('EMPTY', root);
  assert.deepEqual(errors(result), ['no-requirements']);
});

test('unanswered open questions warn but do not fail', async () => {
  const result = await broken(async (root, id) => {
    const file = path.join(changeDir(id, root), 'requirements.md');
    const text = await readFile(file, 'utf8');
    await writeFile(file, `${text}\n## Open Questions\n- Which tenant owns the session?\n`, 'utf8');
  });
  assert.ok(codes(result).includes('open-questions'));
  assert.equal(result.ok, true);
});

test('a requirement not in EARS form warns but does not fail', async () => {
  const result = await broken(async (root, id) => {
    const file = path.join(changeDir(id, root), 'requirements.md');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace('the system shall return 401', 'return a 401'), 'utf8');
  });
  assert.ok(codes(result).includes('not-ears'));
  assert.equal(result.ok, true);
});

test('a constitution over budget fails', async () => {
  const root = await scratch('sdd-validate-');
  await mkdir(sddDir(root), { recursive: true });
  await writeFile(constitutionPath(root), 'x'.repeat(4 * 1501 + 4), 'utf8');
  const problems = await validateConstitution(root);
  assert.equal(problems[0].code, 'constitution-too-long');
});

test('the failure output says evidence is self-reported', async () => {
  const result = await broken(async (root, id) => {
    await rm(path.join(changeDir(id, root), 'evidence.md'));
  });
  assert.match(formatProblems([result]), /self-reported/);
});

test('a prose section in requirements.md is not mistaken for a requirement', async () => {
  const result = await broken(async (root, id) => {
    const file = path.join(changeDir(id, root), 'requirements.md');
    const text = await readFile(file, 'utf8');
    await writeFile(
      file,
      `${text}\n## Decisions\n\nAnswered at the review gate.\n\n## Glossary\n\nA term.\n`,
      'utf8',
    );
  });
  assert.deepEqual(result.problems, [], 'prose headings must not become requirements');
});

test('a heading that starts REQ but is malformed is still reported', async () => {
  const result = await broken(async (root, id) => {
    const file = path.join(changeDir(id, root), 'requirements.md');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace('## REQ-AUTH-001', '## REQ-auth-1'), 'utf8');
  });
  assert.ok(result.problems.some((p) => p.code === 'bad-req-id'));
});
