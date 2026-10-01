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

export const STEPS = ['triage', 'propose', 'tasks', 'implement'];

// Records one model call made by a pipeline phase.
//
// `phase` is the matched-split arm (baseline | sdd); `step` is where in the
// pipeline the call happened. They were conflated before: the spec commands
// printed usage to stderr and recorded nothing, so the sdd arm of the split
// was unmeasurable — its total is triage + propose + tasks + implement, and
// only the last was ever wrapped.
export async function recordAgentRun(
  { id, step, ticketClass = null, phase = 'sdd', usage, model, driver, measured = true },
  root = process.cwd(),
) {
  if (!STEPS.includes(step)) throw new Error(`unknown step "${step}"`);
  const record = {
    schema: SCHEMA,
    kind: 'run',
    id,
    class: ticketClass,
    phase,
    step,
    started_at: new Date().toISOString(),
    driver,
    measured: measured && Boolean(usage),
    model: usage?.model ?? model ?? null,
    tokens: usage?.tokens ?? null,
    cost_usd: usage?.costUsd ?? null,
    wall_ms: usage?.wallMs ?? null,
    turns: usage?.turns ?? null,
    files_read: usage?.filesRead?.length ?? null,
    ok: true,
  };
  await append(record, root);
  return record;
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
