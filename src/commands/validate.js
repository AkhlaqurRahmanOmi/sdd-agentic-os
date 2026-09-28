import { readdir } from 'node:fs/promises';
import { changesDir } from '../spec/paths.js';
import { formatProblems, validateChange, validateConstitution } from '../spec/validate.js';
import { stagedChanges } from './hooks.js';

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
  // Executing evidence runs shell commands out of a file in the repository.
  // It stays opt-in, and the hook (--staged) never gets it implicitly.
  const execute = argv.includes('--execute');
  if (execute && argv.includes('--staged')) {
    throw new Error(
      '--execute and --staged together would run repository-supplied commands ' +
        'on every commit. Run --execute in CI instead.',
    );
  }

  const changeFlag = argv.indexOf('--change');
  const only = changeFlag === -1 ? null : argv[changeFlag + 1];

  // --staged is what the pre-commit hook runs: only the changes this commit
  // touches, so work in flight elsewhere does not block the commit.
  let ids;
  if (only) ids = [only];
  else if (argv.includes('--staged')) ids = await stagedChanges(root);
  else ids = await listChanges(root);

  if (!ids.length) {
    stdout.write(
      argv.includes('--staged')
        ? 'validate: no spec files staged — nothing to check\n'
        : 'validate: no changes under .sdd/changes — nothing to check\n',
    );
    return 0;
  }

  const results = [];
  for (const id of ids) results.push(await validateChange(id, root, { execute }));

  // --strict is how a repository chooses to enforce the human gate in CI
  // without blocking the work that happens when nobody is around to review.
  if (argv.includes('--strict')) {
    for (const r of results) {
      for (const p of r.problems) {
        if (p.code === 'gate-pending' || p.code === 'gate-bypassed') p.severity = 'error';
      }
      r.ok = !r.problems.some((p) => p.severity === 'error');
    }
  }
  const constitutionProblems = await validateConstitution(root);

  stdout.write(formatProblems(results, constitutionProblems));
  const failed =
    results.some((r) => !r.ok) || constitutionProblems.some((p) => p.severity === 'error');
  return failed ? 1 : 0;
}
