// Append-only log of every triage decision, and the audit that checks those
// decisions against what the change actually turned out to be.
//
// A ticket classed tiny or small skips the whole system. When that call is
// wrong, nothing currently notices: the work happens, the spec never exists,
// and the thresholds that produced the misclassification stay exactly as
// wrong as they were. This turns that silence into a record.
//
// An audit finding is a WARNING, never a failure. By the time a diff can be
// measured the work is finished, so blocking the commit helps nobody and
// teaches people to route around triage. The point is the dataset: thresholds
// in config.yaml are guesses until real tickets correct them.

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sddDir } from './paths.js';

export const TRIAGE_LOG_SCHEMA = 1;
export const SKIPS_SPEC = new Set(['tiny', 'small']);
export const triageLogPath = (root = process.cwd()) => path.join(sddDir(root), 'triage.jsonl');

export async function recordTriage(entry, root = process.cwd()) {
  const file = triageLogPath(root);
  await mkdir(path.dirname(file), { recursive: true });
  const record = { schema: TRIAGE_LOG_SCHEMA, at: new Date().toISOString(), ...entry };
  await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

export async function readTriageLog(root = process.cwd()) {
  try {
    return (await readFile(triageLogPath(root), 'utf8'))
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// The most recent decision for a ticket wins: re-running triage is the
// documented response to discovering a ticket was larger than it looked.
export function latestFor(log, id) {
  const matches = log.filter((e) => e.id === id);
  return matches.length ? matches[matches.length - 1] : null;
}

// `git diff --numstat` output -> {files, lines}. Lines counts added plus
// deleted: a change that deletes 200 lines is not small because it added none.
export function summarizeNumstat(numstat) {
  let files = 0;
  let lines = 0;
  for (const raw of numstat.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const [added, deleted] = line.split('\t');
    files += 1;
    // Binary files report "-"; count the file, not phantom lines.
    if (added !== '-') lines += Number(added) + Number(deleted);
  }
  return { files, lines };
}

export function checkMiss(decision, diff, config) {
  if (!decision || !SKIPS_SPEC.has(decision.class)) return null;

  const maxFiles = config.triage.small_max_files;
  const maxLines = config.triage.small_max_lines;
  const overFiles = diff.files > maxFiles;
  const overLines = diff.lines > maxLines;
  if (!overFiles && !overLines) return null;

  return {
    id: decision.id,
    class: decision.class,
    diff,
    thresholds: { files: maxFiles, lines: maxLines },
    exceeded: [overFiles && 'files', overLines && 'lines'].filter(Boolean),
  };
}

export function formatMiss(miss) {
  if (!miss) return 'triage: no miss — the change is within what its class predicted\n';
  const { diff, thresholds, exceeded } = miss;
  return (
    ` warn  triage miss: ${miss.id} was classed "${miss.class}" but changed ` +
    `${diff.files} file(s), ${diff.lines} line(s)\n` +
    `       thresholds: ${thresholds.files} file(s), ${thresholds.lines} line(s) ` +
    `— exceeded on ${exceeded.join(' and ')}\n\n` +
    'Recorded, not blocked: the work is already done and failing here would\n' +
    'only teach people to skip triage. Misses are the evidence that tunes\n' +
    '`triage.small_max_files` and `small_max_lines` in .sdd/config.yaml.\n'
  );
}

export function formatMissRate(log) {
  const decisions = log.filter((e) => e.kind === 'decision');
  const audits = log.filter((e) => e.kind === 'audit');
  if (!audits.length) {
    return (
      `${decisions.length} triage decision(s) recorded, none audited yet.\n` +
      'Run `sdd triage audit --id <id>` after a change lands to build the\n' +
      'dataset the thresholds need.\n'
    );
  }
  const missed = audits.filter((a) => a.miss);
  const lines = [
    `${audits.length} audited, ${missed.length} miss(es) ` +
      `(${Math.round((missed.length / audits.length) * 100)}%)`,
    '',
  ];
  for (const a of missed) {
    lines.push(
      `  ${a.id.padEnd(12)} ${String(a.miss.class).padEnd(6)} ` +
        `${a.miss.diff.files} file(s), ${a.miss.diff.lines} line(s)`,
    );
  }
  if (missed.length) {
    const maxFiles = Math.max(...missed.map((a) => a.miss.diff.files));
    const maxLines = Math.max(...missed.map((a) => a.miss.diff.lines));
    lines.push(
      '',
      `The largest miss changed ${maxFiles} file(s) and ${maxLines} line(s).`,
      'Raising the thresholds past that would stop flagging these; lowering',
      'them sends more work through the spec layer. Which is right depends on',
      'whether the misses actually went wrong, which only you can say.',
    );
  }
  return `${lines.join('\n')}\n`;
}
