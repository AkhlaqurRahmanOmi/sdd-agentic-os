// The budget ratchet: a change may not cost more than its recorded ceiling.
//
// A ratchet only ratchets in one direction. `budget set` lowers a ceiling
// freely and refuses to raise one without --raise, because a ceiling that
// quietly follows the last run upward is not a budget, it is a log.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readRecords } from './store.js';
import { totalTokens } from './report.js';
import { sddDir } from '../spec/paths.js';

export const BUDGET_SCHEMA = 1;
export const budgetPath = (root = process.cwd()) => path.join(sddDir(root), 'budgets.json');

export async function readBudgets(root = process.cwd()) {
  try {
    return JSON.parse(await readFile(budgetPath(root), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { schema: BUDGET_SCHEMA, ceilings: {} };
    throw err;
  }
}

export async function writeBudgets(budgets, root = process.cwd()) {
  const file = budgetPath(root);
  await writeFile(file, `${JSON.stringify(budgets, null, 2)}\n`, 'utf8');
  return file;
}

// The most recent successful run is what a ceiling is measured against; an
// errored run has no meaningful total.
export async function latestRun(id, root = process.cwd()) {
  const records = (await readRecords(id, root)).filter(
    // An unmeasured run has no token total, so it can neither set nor breach a
    // ceiling. Treating it as zero would ratchet every budget to nothing.
    (r) => r.kind === 'run' && r.ok && r.measured !== false && r.tokens,
  );
  if (!records.length) return null;

  // A ticket's cost is the sum of its pipeline steps -- triage, propose,
  // tasks, implement -- not whichever record was written last. Only the most
  // recent record per step counts: summing the whole history would
  // double-count a re-run, so running `sdd tasks` twice would read as a
  // ticket that cost both attempts and a ceiling could never come down.
  const latestPerStep = new Map();
  for (const r of records) latestPerStep.set(r.step ?? 'implement', r);
  const current = [...latestPerStep.values()];

  const sum = (pick) => current.reduce((n, r) => n + (pick(r) ?? 0), 0);
  return {
    ...records[records.length - 1],
    steps: current.length,
    tokens: {
      input: sum((r) => r.tokens.input),
      cache_read: sum((r) => r.tokens.cache_read),
      cache_write: sum((r) => r.tokens.cache_write),
      output: sum((r) => r.tokens.output),
      thinking: sum((r) => r.tokens.thinking),
    },
  };
}

export async function setCeiling(id, { root = process.cwd(), raise = false } = {}) {
  const run = await latestRun(id, root);
  if (!run) throw new Error(`${id} has no successful recorded run to set a ceiling from`);

  const tokens = totalTokens(run.tokens);
  const budgets = await readBudgets(root);
  const existing = budgets.ceilings[id];

  if (existing && tokens > existing.tokens && !raise) {
    throw new Error(
      `${id}: last run used ${tokens.toLocaleString('en-US')} tokens, over its ` +
        `ceiling of ${existing.tokens.toLocaleString('en-US')}. A ratchet only ` +
        'moves down — pass --raise to move it up deliberately, and say in the ' +
        'commit message why this change is allowed to cost more.',
    );
  }

  budgets.ceilings[id] = {
    tokens,
    set_at: new Date().toISOString(),
    from_phase: run.phase,
    class: run.class,
  };
  await writeBudgets(budgets, root);
  return { tokens, previous: existing?.tokens ?? null };
}

export async function checkBudgets(root = process.cwd()) {
  const budgets = await readBudgets(root);
  const ids = Object.keys(budgets.ceilings);
  const results = [];

  for (const id of ids) {
    const run = await latestRun(id, root);
    if (!run) {
      results.push({ id, status: 'no-run', ceiling: budgets.ceilings[id].tokens });
      continue;
    }
    const tokens = totalTokens(run.tokens);
    const ceiling = budgets.ceilings[id].tokens;
    results.push({
      id,
      status: tokens > ceiling ? 'over' : 'under',
      tokens,
      ceiling,
      overBy: tokens - ceiling,
    });
  }
  return results;
}

export function formatBudgets(results) {
  if (!results.length) {
    return (
      'budget: no ceilings recorded.\n\n' +
      'A ceiling comes from a recorded run, so this stays empty until tickets\n' +
      'have actually been measured. Set one with `sdd budget set --change <id>`.\n'
    );
  }
  const lines = [];
  for (const r of results) {
    if (r.status === 'no-run') {
      lines.push(` warn  ${r.id}: ceiling recorded but no successful run to check against`);
    } else if (r.status === 'over') {
      lines.push(
        `ERROR  ${r.id}: ${r.tokens.toLocaleString('en-US')} tokens, ` +
          `${r.overBy.toLocaleString('en-US')} over its ceiling of ` +
          `${r.ceiling.toLocaleString('en-US')}`,
      );
    } else {
      lines.push(
        `   ok  ${r.id}: ${r.tokens.toLocaleString('en-US')} / ` +
          `${r.ceiling.toLocaleString('en-US')}`,
      );
    }
  }
  const over = results.filter((r) => r.status === 'over').length;
  lines.push(over ? `\n${over} change(s) over budget.\nbudget: failed` : '\nbudget: ok');
  return `${lines.join('\n')}\n`;
}
