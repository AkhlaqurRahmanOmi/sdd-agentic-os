import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runWrapped } from '../src/cost/run.js';
import { readRecords } from '../src/cost/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const agent = path.join(here, 'fixtures', 'fake-agent.js');
const scratch = () => mkdtemp(path.join(tmpdir(), 'sdd-run-'));

function sink() {
  const chunks = [];
  return { write: (c) => chunks.push(c), get text() { return chunks.join(''); } };
}

test('a wrapped run records usage and forwards the stream unchanged', async () => {
  const root = await scratch();
  const stdout = sink();
  const { record } = await runWrapped({
    id: 'ABC-1',
    ticketClass: 'feature',
    phase: 'baseline',
    command: [process.execPath, agent],
    root,
    stdout,
    stderr: sink(),
  });

  assert.equal(record.ok, true);
  assert.equal(record.model, 'claude-opus-5');
  assert.equal(record.tokens.cache_read, 900);
  assert.equal(record.tokens.thinking, 75);
  assert.equal(record.cost_usd, 0.25);
  assert.equal(record.turns, 3);
  assert.equal(record.files_read, 1);
  assert.equal(record.class, 'feature');

  // Every line the child printed is still on our stdout.
  assert.equal(stdout.text.trim().split('\n').length, 3);
  assert.deepEqual(await readRecords('ABC-1', root), [record]);
});

test('the raw stream is kept beside the record', async () => {
  const root = await scratch();
  await runWrapped({
    id: 'ABC-2',
    ticketClass: 'bug',
    phase: 'baseline',
    command: [process.execPath, agent],
    root,
    stdout: sink(),
    stderr: sink(),
  });
  const raw = await readFile(path.join(root, '.sdd', 'cost', 'ABC-2.baseline.stream.jsonl'), 'utf8');
  assert.equal(raw.trim().split('\n').length, 3);
});

test('a failed run is recorded as not ok and says so on stderr', async () => {
  const root = await scratch();
  const stderr = sink();
  const { record, exitCode } = await runWrapped({
    id: 'ABC-3',
    ticketClass: 'bug',
    phase: 'baseline',
    command: [process.execPath, agent, '--fail'],
    root,
    stdout: sink(),
    stderr,
  });
  assert.equal(record.ok, false);
  assert.equal(exitCode, 1);
  assert.match(stderr.text, /run failed/);
});

test('a command that emits no result event is refused rather than recorded as free', async () => {
  const root = await scratch();
  await assert.rejects(
    runWrapped({
      id: 'ABC-4',
      ticketClass: 'bug',
      phase: 'baseline',
      command: [process.execPath, agent, '--silent'],
      root,
      stdout: sink(),
      stderr: sink(),
    }),
    /no result event/,
  );
  assert.deepEqual(await readRecords('ABC-4', root), []);
});

test('an unknown ticket class is rejected before anything runs', async () => {
  await assert.rejects(
    runWrapped({
      id: 'ABC-5',
      ticketClass: 'enormous',
      phase: 'baseline',
      command: [process.execPath, agent],
      root: await scratch(),
      stdout: sink(),
      stderr: sink(),
    }),
    /--class must be one of/,
  );
});
