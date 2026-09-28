import { mkdir, writeFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, renderConfig } from '../spec/config.js';
import { changesDir, configPath, constitutionPath, sddDir } from '../spec/paths.js';

const CONSTITUTION = `# Constitution

Rules that hold for every change in this repository. Loaded on every run, so
this file is a budget: ${DEFAULT_CONFIG.budgets.constitution_tokens} tokens, enforced by \`sdd validate\`. If a rule
only applies to one area, it belongs in that area's docs, not here.

Immutable during a session. Editing it mid-change invalidates the cached
prefix every run depends on.

## Rules

- Tests accompany behaviour changes. A requirement with no failing-then-passing
  test has no evidence.
- Existing patterns win over new ones. Match the surrounding code.
- No new dependency without a line here saying why.

<!-- Replace these with rules this repository actually enforces. Three real
     rules beat thirty aspirational ones, and every line costs tokens on every
     single run. -->
`;

export async function initCommand(_argv, { root = process.cwd(), stdout = process.stdout } = {}) {
  await mkdir(changesDir(root), { recursive: true });

  const written = [];
  for (const [file, content] of [
    [configPath(root), renderConfig()],
    [constitutionPath(root), CONSTITUTION],
  ]) {
    try {
      // Never clobber a constitution or config the user has edited.
      await writeFile(file, content, { encoding: 'utf8', flag: 'wx' });
      written.push(file);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }

  stdout.write(
    written.length
      ? `initialised ${sddDir(root)}\n${written.map((f) => `  created ${f}`).join('\n')}\n`
      : `${sddDir(root)} already initialised — nothing changed\n`,
  );
  return 0;
}
