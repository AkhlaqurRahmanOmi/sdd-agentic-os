import { approvedGate, readGate, writeGate } from '../spec/gate.js';
import { parseRequirements } from '../spec/parse.js';
import { requirementsPath } from '../spec/paths.js';
import { readIfPresent, requireFlag, requireString } from './shared.js';

export async function approveCommand(
  argv,
  { root = process.cwd(), stdout = process.stdout } = {},
) {
  const flags = requireFlag.parse(argv);
  const id = requireString(flags, 'id');

  const md = await readIfPresent(requirementsPath(id, root));
  if (md === null) throw new Error(`${id} has no requirements.md to approve`);

  const { requirements, openQuestions } = parseRequirements(md);
  const existing = await readGate(id, root);

  // Approving with questions still open is allowed — sometimes the answer is
  // "the assumption is fine" — but it is recorded, not waved through silently.
  if (openQuestions.length && flags.force !== true) {
    throw new Error(
      `${id} still has ${openQuestions.length} unanswered open question(s):\n` +
        `${openQuestions.map((q) => `  - ${q}`).join('\n')}\n` +
        'Answer them in requirements.md, or pass --force to approve as-is.',
    );
  }

  const by = typeof flags.by === 'string' ? flags.by : (process.env.USER ?? 'unknown');
  await writeGate(id, approvedGate(by, openQuestions), root);

  stdout.write(
    `${id}: approved by ${by} (${requirements.length} requirement(s)` +
      `${openQuestions.length ? `, ${openQuestions.length} open question(s) accepted as-is` : ''})\n` +
      `${existing?.state === 'bypassed' ? '  (was bypassed; now reviewed)\n' : ''}` +
      `\nnext: sdd tasks --id ${id}\n`,
  );
  return 0;
}
