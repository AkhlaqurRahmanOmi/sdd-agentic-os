// Matched-split assignment.
//
// Arms are fixed before any ticket runs and written to
// .sdd/cost/assignment.json. The failure mode this exists to prevent is
// assigning arms after seeing results; `sdd cost run` refuses a ticket whose
// arm does not match its assignment, so a post-hoc swap has to be a visible
// edit to a committed file rather than a flag typed at the prompt.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { costDir } from './store.js';
import { TICKET_CLASSES } from './run.js';

export const ARMS = ['baseline', 'sdd'];

export function assignmentPath(root = process.cwd()) {
  return path.join(costDir(root), 'assignment.json');
}

// Deterministic from (seed, ticket id) so the split is reproducible and not
// chosen by hand, but balanced within each class so one arm cannot end up with
// every feature ticket.
function order(ids, seed) {
  return [...ids].sort((a, b) => {
    const ha = createHash('sha256').update(`${seed}:${a}`).digest('hex');
    const hb = createHash('sha256').update(`${seed}:${b}`).digest('hex');
    return ha < hb ? -1 : ha > hb ? 1 : a.localeCompare(b);
  });
}

export function assign(tickets, seed = 'sdd') {
  for (const t of tickets) {
    if (!TICKET_CLASSES.includes(t.class)) {
      throw new Error(`${t.id}: class must be one of ${TICKET_CLASSES.join(', ')}`);
    }
  }
  const byClass = new Map();
  for (const t of tickets) {
    if (!byClass.has(t.class)) byClass.set(t.class, []);
    byClass.get(t.class).push(t.id);
  }

  const assignments = {};
  for (const [cls, ids] of byClass) {
    // Alternate arms down a shuffled per-class list: an odd count leaves at
    // most one extra ticket in the arm that starts, never a whole class.
    order(ids, `${seed}:${cls}`).forEach((id, i) => {
      assignments[id] = { class: cls, arm: ARMS[i % ARMS.length] };
    });
  }
  return { seed, created_at: new Date().toISOString(), assignments };
}

export async function writeAssignment(plan, root = process.cwd()) {
  const file = assignmentPath(root);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  return file;
}

export async function readAssignment(root = process.cwd()) {
  try {
    return JSON.parse(await readFile(assignmentPath(root), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// Counts per class per arm. The gate turns on the feature class, so a class
// with fewer than two tickets in an arm is worth saying out loud.
export function balance(plan) {
  const counts = new Map();
  for (const { class: cls, arm } of Object.values(plan.assignments)) {
    if (!counts.has(cls)) counts.set(cls, { baseline: 0, sdd: 0 });
    counts.get(cls)[arm] += 1;
  }
  return [...counts.entries()]
    .map(([cls, arms]) => ({ class: cls, ...arms, min: Math.min(arms.baseline, arms.sdd) }))
    .sort((a, b) => a.class.localeCompare(b.class));
}

export function formatPlan(plan) {
  const rows = balance(plan);
  const lines = [`Matched split (seed "${plan.seed}")\n`];
  for (const { class: cls, baseline, sdd } of rows) {
    const ids = Object.entries(plan.assignments)
      .filter(([, a]) => a.class === cls)
      .map(([id, a]) => `${id}:${a.arm}`)
      .sort();
    lines.push(`  ${cls.padEnd(8)} baseline ${baseline}  sdd ${sdd}   ${ids.join('  ')}`);
  }
  const thin = rows.filter((r) => r.min < 2);
  if (thin.length) {
    lines.push(
      `\n  Thin arms: ${thin.map((r) => `${r.class} (min ${r.min})`).join(', ')}.` +
        '\n  A class with fewer than two tickets per arm cannot support a gate' +
        '\n  decision — it is a smoke test. Add tickets to that class or say' +
        '\n  plainly that the gate does not turn on it.',
    );
  }
  return `${lines.join('\n')}\n`;
}
