import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { invokeAgent } from '../agent/invoke.js';
import { proposePrompt } from '../agent/prompts.js';
import { loadConfig } from '../spec/config.js';
import { parseRequirements } from '../spec/parse.js';
import { changeDir, constitutionPath, requirementsPath } from '../spec/paths.js';
import { renderState } from '../spec/render.js';
import { pendingGate, writeGate } from '../spec/gate.js';
import { readIfPresent, readTicket, requireFlag, requireString } from './shared.js';

export async function proposeCommand(
  argv,
  { root = process.cwd(), stdout = process.stdout, stderr = process.stderr, flags } = {},
) {
  const f = flags ?? requireFlag.parse(argv);
  const id = requireString(f, 'id');
  const ticket = await readTicket(f, root);
  const config = await loadConfig(root);

  const area =
    (typeof f.area === 'string' && f.area) ||
    (await readIfPresent(path.join(changeDir(id, root), 'area')))?.trim() ||
    'CORE';

  const file = requirementsPath(id, root);
  const existing = await readIfPresent(file);
  if (existing !== null && f.force !== true) {
    throw new Error(
      `${file} already exists. Re-proposing discards requirements a human has ` +
        'already reviewed — pass --force if that is what you want.',
    );
  }

  const { text } = await invokeAgent({
    prompt: proposePrompt(ticket, area, await readIfPresent(constitutionPath(root))),
    model: config.propose.model,
    cwd: root,
    config,
    driver: typeof f.driver === 'string' ? f.driver : null,
    stderr,
  });

  await writeFile(file, `${text.trim()}\n`, 'utf8');
  await writeFile(path.join(changeDir(id, root), 'state.md'), renderState(id, 'proposed'), 'utf8');

  const { requirements, openQuestions } = parseRequirements(text);
  await writeGate(id, pendingGate(openQuestions), root);
  stdout.write(`\nwrote ${file}\n  ${requirements.length} requirement(s)\n`);
  if (openQuestions.length) {
    stdout.write(
      `\n${openQuestions.length} open question(s) — answer these before tasks:\n` +
        `${openQuestions.map((q) => `  - ${q}`).join('\n')}\n`,
    );
  }
  // The one human gate in the plan. Saying so is the cheapest way to stop it
  // being skipped by habit.
  stdout.write(
    `\nRead ${path.relative(root, file)} before going further. This is the ` +
      'human gate;\nevery later phase inlines these requirements verbatim, so a ' +
      'wrong one\npropagates into every task card.\n' +
      `\nnext: sdd approve --id ${id}    (then sdd tasks --id ${id})\n` +
      `\nNobody available? \`sdd tasks --id ${id} --bypass-gate "<reason>"\`\n` +
      'proceeds and records that the gate was not reviewed, rather than\n' +
      'leaving no trace that it was skipped.\n',
  );
  return 0;
}
