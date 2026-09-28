// The human gate after `sdd propose`.
//
// The gate's problem is not that people skip it. It is that on a side project
// there is often nobody to ask at the time the work is happening, and a gate
// with no way past it gets routed around — at which point there is no gate and
// no record that there wasn't one.
//
// So: you can always proceed. Bypassing is one flag and needs a reason. What
// it does not do is look like approval afterwards. `sdd validate` reports a
// bypassed gate, and `--strict` makes it an error, so a repository that wants
// the gate enforced can enforce it in CI without blocking the work at 11pm.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { changeDir } from './paths.js';

export const GATE_SCHEMA = 1;
export const STATES = ['pending', 'approved', 'bypassed'];

export const gatePath = (id, root = process.cwd()) => path.join(changeDir(id, root), 'gate.json');

export async function readGate(id, root = process.cwd()) {
  try {
    return JSON.parse(await readFile(gatePath(id, root), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeGate(id, gate, root = process.cwd()) {
  const file = gatePath(id, root);
  await writeFile(file, `${JSON.stringify(gate, null, 2)}\n`, 'utf8');
  return file;
}

export const pendingGate = (openQuestions) => ({
  schema: GATE_SCHEMA,
  state: 'pending',
  open_questions: openQuestions,
  at: new Date().toISOString(),
});

export const approvedGate = (by, openQuestions) => ({
  schema: GATE_SCHEMA,
  state: 'approved',
  by,
  open_questions_at_approval: openQuestions,
  at: new Date().toISOString(),
});

export const bypassedGate = (reason, openQuestions) => ({
  schema: GATE_SCHEMA,
  state: 'bypassed',
  reason,
  open_questions_at_bypass: openQuestions,
  at: new Date().toISOString(),
});

// What validate should say about a change's gate. A missing gate file is not
// a problem: changes that predate the gate, or were never proposed through
// sdd, should not start failing.
export function gateProblems(id, gate, where) {
  if (!gate) return [];

  if (gate.state === 'pending') {
    return [
      {
        severity: 'warn',
        code: 'gate-pending',
        message: `${id}: requirements have not been reviewed (sdd approve --id ${id})`,
        where,
      },
    ];
  }
  if (gate.state === 'bypassed') {
    return [
      {
        severity: 'warn',
        code: 'gate-bypassed',
        message:
          `${id}: the review gate was bypassed — ${gate.reason}` +
          (gate.open_questions_at_bypass?.length
            ? ` (${gate.open_questions_at_bypass.length} open question(s) unanswered at the time)`
            : ''),
        where,
      },
    ];
  }
  return [];
}
