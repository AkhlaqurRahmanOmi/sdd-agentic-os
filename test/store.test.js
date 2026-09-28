import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { append, assertValidId, listIds, readRecords } from '../src/cost/store.js';

const scratch = () => mkdtemp(path.join(tmpdir(), 'sdd-store-'));

test('ticket ids that could escape the cost directory are rejected', () => {
  for (const bad of ['../etc/passwd', 'a/b', '', '.hidden', 'x\u0000y']) {
    assert.throws(() => assertValidId(bad), /invalid ticket id/);
  }
  for (const good of ['ABC-123', 'rev_42', 'a.b-c']) {
    assert.equal(assertValidId(good), good);
  }
});

test('records append to one JSONL file per ticket', async () => {
  const root = await scratch();
  await append({ id: 'ABC-1', kind: 'run', n: 1 }, root);
  await append({ id: 'ABC-1', kind: 'annotation', n: 2 }, root);
  const file = path.join(root, '.sdd', 'cost', 'ABC-1.jsonl');
  assert.equal((await readFile(file, 'utf8')).trim().split('\n').length, 2);
  assert.deepEqual((await readRecords('ABC-1', root)).map((r) => r.n), [1, 2]);
});

test('reading a ticket with no records yields an empty list', async () => {
  assert.deepEqual(await readRecords('nothing-here', await scratch()), []);
});

test('raw stream sidecars are not listed as tickets', async () => {
  const root = await scratch();
  await append({ id: 'ABC-1', kind: 'run' }, root);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(root, '.sdd', 'cost', 'ABC-1.baseline.stream.jsonl'), '{}\n');
  assert.deepEqual(await listIds(root), ['ABC-1']);
});
