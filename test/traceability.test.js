import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  buildIndex,
  checkDrift,
  countAnchors,
  formatDrift,
  parseAnchor,
} from '../src/spec/traceability.js';
import { taskCardsDir } from '../src/spec/paths.js';
import { scratch, writeValidChange } from './helpers.js';

test('anchors parse as file plus symbol', () => {
  assert.deepEqual(parseAnchor('src/auth/login.js (handleLogin)'), {
    file: 'src/auth/login.js',
    symbol: 'handleLogin',
  });
  assert.deepEqual(parseAnchor('src/auth/login.js'), {
    file: 'src/auth/login.js',
    symbol: null,
  });
});

test('a line-range anchor keeps the file and drops the range', () => {
  const anchor = parseAnchor('src/auth/login.js:L40-L72');
  assert.equal(anchor.file, 'src/auth/login.js');
  assert.equal(anchor.symbol, null);
  assert.equal(anchor.droppedLineRange, true);
});

async function indexedChange(cardFiles = ['src/auth/login.js (handleLogin)']) {
  const root = await scratch('sdd-index-');
  const id = await writeValidChange(root);
  const card = path.join(taskCardsDir(id, root), 'T01.md');
  const text = await readFile(card, 'utf8');
  await writeFile(card, text.replace('- src/auth/login.js', cardFiles.map((f) => `- ${f}`).join('\n')), 'utf8');
  await mkdir(path.join(root, 'src', 'auth'), { recursive: true });
  await writeFile(
    path.join(root, 'src', 'auth', 'login.js'),
    'export function handleLogin() { return 401; }\n',
    'utf8',
  );
  await writeFile(path.join(root, 'src', 'auth', 'session.js'), 'export const x = 1;\n', 'utf8');
  return { root, id, index: await buildIndex([id], root) };
}

test('the index maps each requirement to its tasks and anchors', async () => {
  const { index, id } = await indexedChange();
  const req = index.changes[id]['REQ-AUTH-001'];
  assert.deepEqual(req.tasks, ['T01']);
  assert.equal(req.anchors[0].file, 'src/auth/login.js');
  assert.equal(req.anchors[0].symbol, 'handleLogin');
  assert.equal(req.anchors[0].task, 'T01');
});

test('evidence is not in the index, so recording it does not stale the index', async () => {
  const { index, id, root } = await indexedChange();
  assert.equal(index.changes[id]['REQ-AUTH-001'].evidence, undefined);

  const { writeFile: wf } = await import('node:fs/promises');
  const { evidencePath } = await import('../src/spec/paths.js');
  await wf(evidencePath(id, root), '# Evidence\n\n## REQ-AUTH-001\n- test: x\n  exit: 0\n', 'utf8');
  const rebuilt = await buildIndex([id], root);
  assert.deepEqual(rebuilt.changes, index.changes);
});

test('an index whose anchors all resolve reports no drift', async () => {
  const { index, root } = await indexedChange();
  assert.deepEqual(await checkDrift(index, root), []);
});

test('a deleted file is drift', async () => {
  const { index, root } = await indexedChange();
  await rm(path.join(root, 'src', 'auth', 'login.js'));
  const drifted = await checkDrift(index, root);
  assert.equal(drifted.length, 1);
  assert.match(drifted[0].reason, /file no longer exists/);
});

test('a renamed symbol is drift even though the file still exists', async () => {
  const { index, root } = await indexedChange();
  await writeFile(
    path.join(root, 'src', 'auth', 'login.js'),
    'export function authenticate() { return 401; }\n',
    'utf8',
  );
  const drifted = await checkDrift(index, root);
  assert.equal(drifted.length, 1);
  assert.match(drifted[0].reason, /symbol "handleLogin" not found/);
});

test('code moving within a file is not drift', async () => {
  const { index, root } = await indexedChange();
  await writeFile(
    path.join(root, 'src', 'auth', 'login.js'),
    `// a hundred new lines above it\n${'\n'.repeat(100)}export function handleLogin() { return 401; }\n`,
    'utf8',
  );
  assert.deepEqual(await checkDrift(index, root), []);
});

test('a symbol that is a substring of another name is not a match', async () => {
  const { index, root } = await indexedChange();
  await writeFile(
    path.join(root, 'src', 'auth', 'login.js'),
    'export function handleLoginAttempt() { return 401; }\n',
    'utf8',
  );
  const drifted = await checkDrift(index, root);
  assert.equal(drifted.length, 1);
});

test('an anchor with no symbol only requires the file to exist', async () => {
  const { index, root } = await indexedChange(['src/auth/login.js']);
  assert.deepEqual(await checkDrift(index, root), []);
});

test('the drift message says not to regenerate around it', async () => {
  const { index, root } = await indexedChange();
  await rm(path.join(root, 'src', 'auth', 'login.js'));
  const out = formatDrift(await checkDrift(index, root), countAnchors(index));
  assert.match(out, /A stale index is worse than none/);
  assert.match(out, /do not regenerate around it/);
});
