// Append-only record store. One JSONL file per ticket, per the Phase 0 layout:
//   .sdd/cost/<id>.jsonl

import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const SCHEMA = 1;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Ticket ids become filenames, so reject anything that could escape the
// directory before it is joined to a path.
export function assertValidId(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new Error(
      `invalid ticket id ${JSON.stringify(id)}: use letters, digits, dot, dash, underscore`,
    );
  }
  return id;
}

export function costDir(root = process.cwd()) {
  return path.join(root, '.sdd', 'cost');
}

export function recordPath(id, root = process.cwd()) {
  return path.join(costDir(root), `${assertValidId(id)}.jsonl`);
}

export async function append(record, root = process.cwd()) {
  const file = recordPath(record.id, root);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  return file;
}

export async function readRecords(id, root = process.cwd()) {
  let text;
  try {
    text = await readFile(recordPath(id, root), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

export async function listIds(root = process.cwd()) {
  let entries;
  try {
    entries = await readdir(costDir(root));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((name) => name.endsWith('.jsonl') && !name.endsWith('.stream.jsonl'))
    .map((name) => name.slice(0, -'.jsonl'.length))
    .sort();
}

export async function readAll(root = process.cwd()) {
  const ids = await listIds(root);
  const all = [];
  for (const id of ids) all.push(...(await readRecords(id, root)));
  return all;
}
