import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { invokeAgent } from '../agent/invoke.js';
import { proposePrompt } from '../agent/prompts.js';
import { loadConfig } from '../spec/config.js';
import { parseRequirements } from '../spec/parse.js';
import { changeDir, constitutionPath, requirementsPath } from '../spec/paths.js';
import { renderState } from '../spec/render.js';
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
    stderr,
  });

  await writeFile(file, `${text.trim()}\n`, 'utf8');
  await writeFile(path.join(changeDir(id, root), 'state.md'), renderState(id, 'proposed'), 'utf8');

  const { requirements, openQuestions } = parseRequirements(text);
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
      'wrong one\npropagates into every task card.\n\nnext: sdd tasks --id ' +
      `${id}\n`,
  );
  return 0;
}
