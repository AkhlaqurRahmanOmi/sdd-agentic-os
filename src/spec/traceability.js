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
// A model asked for "file (symbol)" will sometimes write a whole paragraph
// inside those parentheses, quotes and brackets included. Parsing by position
// rather than one regex over the whole entry keeps that paragraph out of the
// path, which previously reached open() and threw ENAMETOOLONG.
const MAX_PATH = 512;

// A reserved word cannot be an identifier, so when one turns up where a symbol
// should be, the card wrote prose in the parentheses — `(new)`, `(new file)` —
// not an anchor. Treating it as a missing symbol reports drift that no edit to
// the code could ever fix, which is how a check gets switched off. The anchor
// degrades to file-only instead.
const RESERVED = new Set([
  'new', 'class', 'function', 'const', 'let', 'var', 'return', 'if', 'else',
  'for', 'while', 'this', 'super', 'import', 'export', 'default', 'typeof',
  'instanceof', 'void', 'delete', 'in', 'of', 'do', 'try', 'catch', 'finally',
  'throw', 'switch', 'case', 'break', 'continue', 'await', 'async', 'yield',
  'null', 'true', 'false', 'undefined',
]);

export function parseAnchor(entry) {
  const text = entry.trim();
  const rawPath = text.split(/\s+/)[0] ?? '';

  // A line-range anchor keeps its file and drops the range: keeping it would
  // reintroduce exactly the drift the symbol form exists to avoid.
  const withLines = rawPath.match(/^(.+?):L?\d+(?:-L?\d+)?$/);
  const file = withLines ? withLines[1] : rawPath;

  const anchor = { file, symbol: null };
  if (withLines) anchor.droppedLineRange = true;

  // The symbol is the first identifier inside the first parentheses. Anything
  // after it is prose for whoever reads the card, not something to check.
  const paren = text.slice(rawPath.length).match(/\(\s*([A-Za-z_$][\w$.]*)/);
  if (paren && !RESERVED.has(paren[1])) anchor.symbol = paren[1];

  // Too long, empty, or containing control characters: not a path. Flagging it
  // beats failing to open it. Node rejects a null byte with a TypeError before
  // the syscall, so an fs error code never gets the chance to catch it.
  // eslint-disable-next-line no-control-regex
  if (!file || file.length > MAX_PATH || /[\u0000-\u001f]/.test(file)) {
    anchor.malformed = true;
    anchor.symbol = null;
  }
  return anchor;
}

async function readOptional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    // A card can name something that is not openable at all. Treating that as
    // "missing" reports it as drift, where crashing the check reports nothing.
    if (
      ['ENOENT', 'ENAMETOOLONG', 'EISDIR', 'EINVAL', 'ENOTDIR', 'ERR_INVALID_ARG_VALUE'].includes(
        err.code,
      )
    ) {
      return null;
    }
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

const wordBoundary = (name) =>
  new RegExp(`(?<![\\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`);

// A card naturally writes `Class.method`, and that dotted form never appears
// literally in source — the class and the method are declared separately. So
// each segment is checked on its own. Searching for the joined string marked
// every such anchor as drift, which is the cry-wolf failure that gets the
// check switched off.
export function symbolPresent(source, symbol) {
  return symbol
    .split('.')
    .filter(Boolean)
    .every((segment) => wordBoundary(segment).test(source));
}

// Returns the anchors that no longer resolve. An empty array means the index
// still describes the code — as far as a non-parsing check can tell.
export async function checkDrift(index, root = process.cwd()) {
  const drifted = [];
  const fileCache = new Map();

  for (const [changeId, entries] of Object.entries(index.changes ?? {})) {
    for (const [reqId, entry] of Object.entries(entries)) {
      for (const anchor of entry.anchors ?? []) {
        if (anchor.malformed) {
          drifted.push({
            change: changeId,
            req: reqId,
            anchor,
            reason: 'anchor is not a usable file path — fix the task card',
          });
          continue;
        }
        const abs = path.resolve(root, anchor.file);
        if (!fileCache.has(abs)) fileCache.set(abs, await readOptional(abs));
        const source = fileCache.get(abs);

        if (source === null) {
          drifted.push({ change: changeId, req: reqId, anchor, reason: 'file no longer exists' });
          continue;
        }
        if (anchor.symbol && !symbolPresent(source, anchor.symbol)) {
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
