// The traceability index: REQ -> tasks -> code anchors -> evidence.
//
// Written as a byproduct of `sdd tasks`, checked in CI. The plan's own kill
// criterion applies: a stale index is worse than none, so the check has to be
// reliable enough that nobody reaches for --no-verify.
//
// Anchors are file + symbol, never line ranges. A line range breaks on any
// edit above it, including a reformat, which would make the check cry wolf on
// every unrelated commit and be switched off within a week.
//
// Evidence is deliberately NOT in here. It changes every time a task
// completes, so including it made "index is out of date" fire on almost every
// commit — the same cry-wolf failure, reached by a different route. Evidence
// lives in evidence.md and `sdd validate` checks it. The index answers only
// "which code does this requirement point at", which changes when requirements
// or task cards change and at no other time.
//
// Symbol presence is a word-boundary search, not a parse. That is honest about
// what it catches: a deleted or renamed symbol fails, a moved one does not,
// and a symbol that survives only inside a comment or a string passes when it
// should not. Shipping a parser per language is the alternative, and a check
// that is occasionally too lenient beats one that is occasionally wrong and
// gets disabled.

import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { REQ_ID, parseRequirements, parseTaskCard } from './parse.js';
import { requirementsPath, sddDir, taskCardsDir } from './paths.js';

export const INDEX_SCHEMA = 1;
export const indexPath = (root = process.cwd()) => path.join(sddDir(root), 'index.json');

// "src/auth/attempts.js (recordFailure)" -> {file, symbol}
// "src/auth/attempts.js"                 -> {file, symbol: null}
export function parseAnchor(entry) {
  const m = entry.trim().match(/^(\S+?)\s*\(([^)]+)\)\s*$/);
  if (m) return { file: m[1], symbol: m[2].trim() };
  // A line-range anchor is accepted but recorded without the range: keeping it
  // would reintroduce exactly the drift the symbol form exists to avoid.
  const withLines = entry.trim().match(/^(\S+?):L?\d+(?:-L?\d+)?$/);
  if (withLines) return { file: withLines[1], symbol: null, droppedLineRange: true };
  return { file: entry.trim(), symbol: null };
}

async function readOptional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function buildChangeIndex(id, root = process.cwd()) {
  const requirementsMd = await readOptional(requirementsPath(id, root));
  if (requirementsMd === null) return null;

  const { requirements } = parseRequirements(requirementsMd);

  const entries = {};
  for (const req of requirements) {
    if (!REQ_ID.test(req.id)) continue;
    entries[req.id] = { tasks: [], anchors: [] };
  }

  let cards = [];
  try {
    cards = (await readdir(taskCardsDir(id, root))).filter((f) => f.endsWith('.md')).sort();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  for (const file of cards) {
    const card = parseTaskCard(await readFile(path.join(taskCardsDir(id, root), file), 'utf8'));
    const taskId = file.slice(0, -3);
    for (const reqId of card.reqs) {
      const entry = entries[reqId];
      if (!entry) continue;
      entry.tasks.push(taskId);
      for (const raw of card.files) {
        const anchor = parseAnchor(raw);
        const already = entry.anchors.some(
          (a) => a.file === anchor.file && a.symbol === anchor.symbol,
        );
        if (!already) entry.anchors.push({ ...anchor, task: taskId });
      }
    }
  }
  return entries;
}

export async function buildIndex(ids, root = process.cwd()) {
  const changes = {};
  for (const id of ids) {
    const entries = await buildChangeIndex(id, root);
    if (entries) changes[id] = entries;
  }
  return { schema: INDEX_SCHEMA, generated_at: new Date().toISOString(), changes };
}

export async function writeIndex(index, root = process.cwd()) {
  const file = indexPath(root);
  await writeFile(file, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return file;
}

export async function readIndex(root = process.cwd()) {
  const text = await readOptional(indexPath(root));
  return text === null ? null : JSON.parse(text);
}

const wordBoundary = (symbol) =>
  new RegExp(`(?<![\\w$])${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`);

// Returns the anchors that no longer resolve. An empty array means the index
// still describes the code — as far as a non-parsing check can tell.
export async function checkDrift(index, root = process.cwd()) {
  const drifted = [];
  const fileCache = new Map();

  for (const [changeId, entries] of Object.entries(index.changes ?? {})) {
    for (const [reqId, entry] of Object.entries(entries)) {
      for (const anchor of entry.anchors ?? []) {
        const abs = path.resolve(root, anchor.file);
        if (!fileCache.has(abs)) fileCache.set(abs, await readOptional(abs));
        const source = fileCache.get(abs);

        if (source === null) {
          drifted.push({ change: changeId, req: reqId, anchor, reason: 'file no longer exists' });
          continue;
        }
        if (anchor.symbol && !wordBoundary(anchor.symbol).test(source)) {
          drifted.push({
            change: changeId,
            req: reqId,
            anchor,
            reason: `symbol "${anchor.symbol}" not found in the file`,
          });
        }
      }
    }
  }
  return drifted;
}

export function formatDrift(drifted, checked) {
  if (!drifted.length) {
    return `index: ok (${checked} anchor${checked === 1 ? '' : 's'} resolve)\n`;
  }
  const lines = drifted.map(
    (d) =>
      `ERROR  ${d.change}/${d.req} -> ${d.anchor.file}` +
      `${d.anchor.symbol ? ` (${d.anchor.symbol})` : ''}\n       ${d.reason}` +
      `${d.anchor.task ? ` [${d.anchor.task}]` : ''}`,
  );
  return (
    `${lines.join('\n')}\n\n${drifted.length} anchor(s) no longer resolve.\n` +
    'index: failed\n\nEither the code moved and the task card should say where, or the ' +
    'requirement\nno longer describes anything that exists. A stale index is worse than ' +
    'none —\nfix the card or drop the requirement, do not regenerate around it.\n'
  );
}

export function countAnchors(index) {
  let n = 0;
  for (const entries of Object.values(index.changes ?? {})) {
    for (const entry of Object.values(entries)) n += (entry.anchors ?? []).length;
  }
  return n;
}
