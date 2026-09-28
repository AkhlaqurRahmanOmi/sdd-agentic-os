import { readdir } from 'node:fs/promises';
import { changesDir } from '../spec/paths.js';
import { formatProblems, validateChange, validateConstitution } from '../spec/validate.js';

export async function listChanges(root = process.cwd()) {
  try {
    const entries = await readdir(changesDir(root), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export async function validateCommand(
  argv,
  { root = process.cwd(), stdout = process.stdout } = {},
) {
  const changeFlag = argv.indexOf('--change');
  const only = changeFlag === -1 ? null : argv[changeFlag + 1];

  const ids = only ? [only] : await listChanges(root);
  if (!ids.length) {
    stdout.write('validate: no changes under .sdd/changes — nothing to check\n');
    return 0;
  }

  const results = [];
  for (const id of ids) results.push(await validateChange(id, root));
  const constitutionProblems = await validateConstitution(root);

  stdout.write(formatProblems(results, constitutionProblems));
  const failed =
    results.some((r) => !r.ok) || constitutionProblems.some((p) => p.severity === 'error');
  return failed ? 1 : 0;
}
