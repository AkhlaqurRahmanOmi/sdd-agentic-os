import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { invokeAgentJson } from '../agent/invoke.js';
import { TASKS_SCHEMA, tasksPrompt } from '../agent/prompts.js';
import { loadConfig } from '../spec/config.js';
import { recordAgentRun } from '../cost/store.js';
import { REQ_ID, parseRequirements } from '../spec/parse.js';
import { parseAnchor } from '../spec/traceability.js';
import { changeDir, evidencePath, requirementsPath, taskCardsDir, tasksIndexPath } from '../spec/paths.js';
import { renderEvidenceSkeleton, renderState, renderTaskCard, renderTasksIndex } from '../spec/render.js';
import { readIfPresent, requireFlag, requireString } from './shared.js';
import { bypassedGate, readGate, writeGate } from '../spec/gate.js';

export async function tasksCommand(
  argv,
  { root = process.cwd(), stdout = process.stdout, stderr = process.stderr, flags } = {},
) {
  const f = flags ?? requireFlag.parse(argv);
  const id = requireString(f, 'id');
  const config = await loadConfig(root);

  const requirementsMd = await readFile(requirementsPath(id, root), 'utf8');
  const { requirements, openQuestions } = parseRequirements(requirementsMd);
  const reqIds = requirements.map((r) => r.id).filter((r) => REQ_ID.test(r));
  if (!reqIds.length) throw new Error('requirements.md declares no well-formed requirements');

  // The human gate. Proceeding without review is always possible, but it takes
  // a flag and a reason, and it leaves a record that outlives this command.
  const gate = await readGate(id, root);
  const bypass = typeof f['bypass-gate'] === 'string' ? f['bypass-gate'] : null;

  if (gate?.state === 'pending' && !bypass) {
    throw new Error(
      `${id}: requirements have not been reviewed.\n` +
        `  sdd approve --id ${id}                      once a human has read them\n` +
        `  sdd tasks --id ${id} --bypass-gate "<why>"  to proceed without review\n` +
        'A bypass is recorded and reported by `sdd validate`; it does not look\n' +
        'like approval afterwards.',
    );
  }
  if (bypass) {
    await writeGate(id, bypassedGate(bypass, openQuestions), root);
    stderr.write(`[sdd] gate bypassed for ${id}: ${bypass}\n`);
  }

  // Decomposing against unanswered questions bakes the guess into every card,
  // where it is far more expensive to find than in one reviewed file.
  if (openQuestions.length && f.force !== true && !bypass) {
    throw new Error(
      `${openQuestions.length} open question(s) are still unanswered in ` +
        `requirements.md:\n${openQuestions.map((q) => `  - ${q}`).join('\n')}\n` +
        'Answer them, or pass --force to decompose around them.',
    );
  }

  const { data, usage, measured, driver } = await invokeAgentJson({
    prompt: tasksPrompt(requirementsMd, typeof f.test === 'string' ? f.test : null),
    model: config.tasks.model,
    schema: TASKS_SCHEMA,
    cwd: root,
    config,
    driver: typeof f.driver === 'string' ? f.driver : null,
    stderr,
  });

  // Record the call before doing anything with its result: a phase that
  // writes files but leaves no ledger entry is exactly the gap that made the
  // sdd arm unmeasurable.
  if (typeof f.id === 'string') {
    await recordAgentRun(
      { id: f.id, step: 'tasks', usage, measured, driver, phase: typeof f.phase === 'string' ? f.phase : 'sdd' },
      root,
    );
  }

  const known = new Set(reqIds);
  for (const task of data.tasks) {
    const unknown = task.reqs.filter((r) => !known.has(r));
    if (unknown.length) {
      throw new Error(`${task.id} references requirements that do not exist: ${unknown.join(', ')}`);
    }
  }

  // Anchors are checked here, before anything is written, for the same reason
  // requirement coverage is: a card that names `src/x.ts (existing)` or writes
  // a paragraph in the parentheses passes decomposition and then fails
  // `sdd index check` later, a long way from the cause. The format is stated
  // in the prompt; this is what makes it binding.
  const badAnchors = [];
  for (const task of data.tasks) {
    for (const entry of task.files ?? []) {
      const anchor = parseAnchor(entry);
      if (anchor.malformed) {
        badAnchors.push(`${task.id}: not a file path — ${entry.slice(0, 80)}`);
        continue;
      }
      // A path with no extension and no slash is usually prose that lost its
      // path, and an anchor pointing at nothing is worse than no anchor.
      if (!anchor.file.includes('/') && !anchor.file.includes('.')) {
        badAnchors.push(`${task.id}: "${anchor.file}" does not look like a path`);
      }
    }
  }
  if (badAnchors.length && f.force !== true) {
    throw new Error(
      `${badAnchors.length} task card anchor(s) are not usable:\n` +
        `${badAnchors.map((b) => `  - ${b}`).join('\n')}\n` +
        'Each entry must read `path/to/file.ts (symbolName)` — one identifier, ' +
        'no prose\nin the parentheses. Re-run `sdd tasks`, or pass --force to ' +
        'write the cards anyway\nand accept that `sdd index check` will report ' +
        'these.',
    );
  }
  const covered = new Set(data.tasks.flatMap((t) => t.reqs));
  const uncovered = reqIds.filter((r) => !covered.has(r));
  if (uncovered.length) {
    throw new Error(`no task covers ${uncovered.join(', ')} — re-run, or add the tasks by hand`);
  }

  await mkdir(taskCardsDir(id, root), { recursive: true });
  for (const task of data.tasks) {
    await writeFile(path.join(taskCardsDir(id, root), `${task.id}.md`), renderTaskCard(task), 'utf8');
  }
  await writeFile(tasksIndexPath(id, root), renderTasksIndex(id, data.tasks), 'utf8');

  // Never overwrite evidence already recorded.
  if ((await readIfPresent(evidencePath(id, root))) === null) {
    await writeFile(evidencePath(id, root), renderEvidenceSkeleton(id, reqIds), 'utf8');
  }
  await writeFile(path.join(changeDir(id, root), 'state.md'), renderState(id, 'tasks'), 'utf8');

  stdout.write(
    `\nwrote ${data.tasks.length} card(s) to ${path.relative(root, taskCardsDir(id, root))}\n` +
      `${data.tasks.map((t) => `  ${t.id}  ${t.goal}  (${t.reqs.join(', ')})`).join('\n')}\n` +
      `\nEach card inlines its requirement text, so work one card at a time and\n` +
      `never load requirements.md alongside it.\n\nnext: sdd validate --change ${id}\n`,
  );
  return 0;
}
