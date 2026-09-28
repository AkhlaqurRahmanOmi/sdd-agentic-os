import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseStream } from '../src/cost/stream.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const load = (name) => readFile(path.join(fixtures, name), 'utf8');

test('a failed run is reported as not ok even though subtype says success', async () => {
  const summary = parseStream(await load('failed-auth.jsonl'));
  assert.equal(summary.ok, false);
  assert.equal(summary.terminalReason, 'api_error');
});

test('the synthetic error model does not overwrite the model from init', async () => {
  const summary = parseStream(await load('failed-auth.jsonl'));
  assert.equal(summary.model, 'claude-haiku-4-5');
});

test('usage, cost, turns and timings come off the result event', async () => {
  const summary = parseStream(await load('successful-run.jsonl'));
  assert.equal(summary.ok, true);
  assert.equal(summary.model, 'claude-opus-5');
  assert.deepEqual(summary.tokens, {
    input: 2000,
    cache_read: 40000,
    cache_write: 3000,
    output: 5000,
    thinking: 1500,
  });
  assert.equal(summary.costUsd, 0.4213);
  assert.equal(summary.turns, 7);
  assert.equal(summary.wallMs, 12000);
  assert.equal(summary.apiMs, 8000);
});

test('files read are counted distinctly, read calls are not', async () => {
  const summary = parseStream(await load('successful-run.jsonl'));
  assert.equal(summary.readCalls, 3);
  assert.deepEqual(summary.filesRead, ['/repo/src/a.js', '/repo/src/b.js']);
});

test('non-JSON lines in the stream are skipped rather than failing the run', async () => {
  const summary = parseStream(await load('successful-run.jsonl'));
  assert.ok(summary);
});

test('a stream with no result event summarizes to null', () => {
  assert.equal(parseStream('{"type":"system","subtype":"init","model":"x"}'), null);
});
