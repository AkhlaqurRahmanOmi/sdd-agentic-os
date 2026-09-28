// `sdd validate` — the enforcement point. Deterministic, agent-agnostic, and
// the thing a pre-commit hook and a CI job both run.
//
// Scope, stated plainly because it is easy to overestimate: this checks the
// SHAPE of a change's spec files, not the truth of what they claim. Evidence
// is written by the same agent that wrote the requirement, so a passing
// validate means "the paperwork is consistent", not "the code is correct".
// Phase 2 adds execution of the recorded commands; the evidence format carries
// the command and exit status so that lands without a format change.

import { readFile, readdir } from 'node:fs/promises';
import { executeEvidence } from './execute.js';
import { gateProblems, readGate } from './gate.js';
import {
  REQ_ID,
  TASK_ID,
  approxTokens,
  parseEvidence,
  parseRequirements,
  parseTaskCard,
  parseTasksIndex,
} from './parse.js';
import { gatePath as gatePathFor } from './gate.js';
import {
  constitutionPath,
  evidencePath,
  requirementsPath,
  taskCardPath,
  taskCardsDir,
  tasksIndexPath,
} from './paths.js';

export const CONSTITUTION_TOKEN_BUDGET = 1500;

async function readOptional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

const problem = (severity, code, message, where) => ({ severity, code, message, where });

export async function validateChange(id, root = process.cwd(), { execute = false } = {}) {
  const problems = [];
  const fail = (...a) => problems.push(problem('error', ...a));
  const warn = (...a) => problems.push(problem('warn', ...a));

  const requirementsMd = await readOptional(requirementsPath(id, root));
  if (requirementsMd === null) {
    fail('no-requirements', 'requirements.md is missing', requirementsPath(id, root));
    return { id, problems, ok: false };
  }

  const { requirements, openQuestions } = parseRequirements(requirementsMd);
  if (!requirements.length) {
    fail('no-requirements', 'requirements.md declares no requirements', requirementsPath(id, root));
  }

  const seen = new Set();
  for (const req of requirements) {
    const where = `${requirementsPath(id, root)}:${req.line}`;
    if (!REQ_ID.test(req.id)) {
      fail('bad-req-id', `"${req.id}" is not a REQ-<AREA>-<NNN> id`, where);
      continue;
    }
    if (seen.has(req.id)) fail('duplicate-req', `${req.id} is declared more than once`, where);
    seen.add(req.id);
    if (!req.text) fail('empty-req', `${req.id} has no requirement text`, where);
    // EARS is a house style, not a correctness property — say so, don't block.
    else if (!req.hasShall) warn('not-ears', `${req.id} is not in EARS form (no "shall")`, where);
  }

  // An unanswered open question means the spec was not ready to be worked.
  if (openQuestions.length) {
    warn(
      'open-questions',
      `${openQuestions.length} open question(s) still unanswered`,
      requirementsPath(id, root),
    );
  }

  const reqIds = new Set(requirements.map((r) => r.id).filter((r) => REQ_ID.test(r)));

  // --- tasks -------------------------------------------------------------
  const indexMd = await readOptional(tasksIndexPath(id, root));
  const indexEntries = indexMd === null ? [] : parseTasksIndex(indexMd);
  if (indexMd === null) fail('no-tasks', 'tasks.md is missing', tasksIndexPath(id, root));

  let cardFiles = [];
  try {
    cardFiles = (await readdir(taskCardsDir(id, root)))
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.slice(0, -3))
      .sort();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const indexIds = new Set(indexEntries.map((e) => e.id));
  for (const entry of indexIds) {
    if (!cardFiles.includes(entry)) {
      fail('missing-card', `tasks.md lists ${entry} but tasks/${entry}.md does not exist`, tasksIndexPath(id, root));
    }
  }
  for (const card of cardFiles) {
    if (!indexIds.has(card)) {
      fail('unlisted-card', `tasks/${card}.md exists but tasks.md does not list it`, taskCardPath(id, card, root));
    }
  }

  const coveredReqs = new Set();
  for (const taskId of cardFiles) {
    const where = taskCardPath(id, taskId, root);
    const card = parseTaskCard(await readFile(where, 'utf8'));
    if (!TASK_ID.test(taskId)) fail('bad-task-id', `"${taskId}" is not a T<NN> id`, where);
    if (card.id && card.id !== taskId) {
      fail('task-id-mismatch', `card heading says ${card.id} but the file is ${taskId}.md`, where);
    }
    if (!card.reqs.length) {
      fail('task-without-req', `${taskId} maps to no requirement`, where);
    }
    for (const req of card.reqs) {
      if (!reqIds.has(req)) fail('unknown-req', `${taskId} references unknown ${req}`, where);
      else coveredReqs.add(req);
    }
    // A card missing its test command or its done-when is a card the agent
    // cannot close on its own; that is a spec defect, not a style nit.
    if (!card.test) fail('task-without-test', `${taskId} has no test command`, where);
    if (!card.doneWhen.length) fail('task-without-done', `${taskId} has no done-when`, where);
    if (!card.files.length) warn('task-without-files', `${taskId} names no target files`, where);
  }

  for (const req of reqIds) {
    if (!coveredReqs.has(req)) fail('uncovered-req', `${req} is not covered by any task`, requirementsPath(id, root));
  }

  // --- evidence ----------------------------------------------------------
  const evidenceMd = await readOptional(evidencePath(id, root));
  const evidence = evidenceMd === null ? new Map() : parseEvidence(evidenceMd);
  if (evidenceMd === null) {
    fail('no-evidence', 'evidence.md is missing', evidencePath(id, root));
  }
  for (const req of reqIds) {
    const entries = evidence.get(req) ?? [];
    if (!entries.length) {
      fail('req-without-evidence', `${req} has no evidence`, evidencePath(id, root));
      continue;
    }
    for (const entry of entries) {
      if (entry.kind !== 'test') continue;
      const exit = entry.fields.exit;
      if (exit === undefined) {
        warn('evidence-without-exit', `${req}: test evidence records no exit status`, evidencePath(id, root));
      } else if (exit !== '0') {
        fail('evidence-failing', `${req}: test evidence records exit ${exit}`, evidencePath(id, root));
      }
    }
  }
  for (const req of evidence.keys()) {
    if (REQ_ID.test(req) && !reqIds.has(req)) {
      warn('stale-evidence', `evidence.md has ${req}, which requirements.md no longer declares`, evidencePath(id, root));
    }
  }

  // A bypassed or unreviewed gate is reported, never silently equivalent to
  // approval. It warns rather than fails: enforcing it is a repository policy
  // (`--strict`), not a property of the spec being well-formed.
  problems.push(...gateProblems(id, await readGate(id, root), gatePathFor(id, root)));

  // Opt-in: actually run what the evidence claims. Only worth doing once the
  // shape checks above pass — running a suite to discover a REQ id is
  // malformed wastes the slowest part of the check.
  let executed = null;
  if (execute && !problems.some((p) => p.severity === 'error')) {
    const onlyDeclared = new Map(
      [...evidence].filter(([req]) => reqIds.has(req)),
    );
    executed = await executeEvidence(onlyDeclared, { cwd: root });
    problems.push(...executed.problems);
  }

  return {
    id,
    problems,
    executed,
    ok: !problems.some((p) => p.severity === 'error'),
  };
}

export async function validateConstitution(root = process.cwd()) {
  const problems = [];
  const text = await readOptional(constitutionPath(root));
  if (text === null) return problems;
  const tokens = approxTokens(text);
  if (tokens > CONSTITUTION_TOKEN_BUDGET) {
    problems.push(
      problem(
        'error',
        'constitution-too-long',
        `constitution.md is ~${tokens} tokens, over the ${CONSTITUTION_TOKEN_BUDGET} budget ` +
          '(approximated at 4 chars/token)',
        constitutionPath(root),
      ),
    );
  }
  return problems;
}

export function formatProblems(results, constitutionProblems = []) {
  const lines = [];
  const all = [
    ...constitutionProblems.map((p) => ({ ...p, change: null })),
    ...results.flatMap((r) => r.problems.map((p) => ({ ...p, change: r.id }))),
  ];
  const ran = results.reduce((n, r) => n + (r.executed?.ran ?? 0), 0);
  const executedAny = results.some((r) => r.executed);

  if (!all.length) {
    const n = results.length;
    return (
      `validate: ok (${n} change${n === 1 ? '' : 's'}` +
      (executedAny ? `, ${ran} evidence command${ran === 1 ? '' : 's'} executed` : '') +
      ')\n'
    );
  }
  for (const p of all) {
    const scope = p.change ? `${p.change}: ` : '';
    lines.push(`${p.severity === 'error' ? 'ERROR' : ' warn'}  ${scope}${p.message}\n        ${p.where} [${p.code}]`);
  }
  const errors = all.filter((p) => p.severity === 'error').length;
  const warns = all.length - errors;
  lines.push(`\n${errors} error(s), ${warns} warning(s)`);
  if (errors === 0) {
    lines.push('validate: ok (warnings do not fail)');
  } else if (executedAny) {
    lines.push(
      `validate: failed (${ran} evidence command(s) executed)`,
    );
  } else {
    lines.push(
      'validate: failed\n\nThis checks that the spec files are internally consistent. ' +
        'Evidence is\nself-reported by the agent that wrote the requirement — a pass means the\n' +
        'paperwork holds together, not that the code is correct.\n' +
        'Pass --execute to run the recorded commands instead of trusting them.',
    );
  }
  return `${lines.join('\n')}\n`;
}
