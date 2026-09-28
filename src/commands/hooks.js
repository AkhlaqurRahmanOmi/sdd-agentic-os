import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);

// The hook validates only the changes this commit touches, not every change in
// the repository. Validating all of them would block a commit on change B
// because change A is mid-flight, which is how a pre-commit hook gets
// --no-verify'd into uselessness. CI validates everything; the hook keeps the
// feedback close to what you just edited.
// The resolved path to this installation is baked in at install time. Relying
// on `sdd` being on PATH makes the hook work for whoever installed it and fail
// for everyone else, which is the same as not having a hook.
const hookScript = (node, cli) => `#!/bin/sh
# Installed by \`sdd hooks install\`. Delete this file to remove it.
exec ${JSON.stringify(node)} ${JSON.stringify(cli)} validate --staged
`;

export async function hooksCommand(
  argv,
  { root = process.cwd(), stdout = process.stdout } = {},
) {
  const sub = argv.find((a) => !a.startsWith('--'));
  if (sub !== 'install') throw new Error('usage: sdd hooks install');

  let gitDir;
  try {
    const { stdout: out } = await run('git', ['rev-parse', '--git-dir'], { cwd: root });
    gitDir = path.resolve(root, out.trim());
  } catch {
    throw new Error('not a git repository');
  }

  const hookPath = path.join(gitDir, 'hooks', 'pre-commit');
  await mkdir(path.dirname(hookPath), { recursive: true });

  let existing = null;
  try {
    existing = await readFile(hookPath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (existing !== null && !existing.includes('sdd validate')) {
    throw new Error(
      `${hookPath} already exists and is not an sdd hook. ` +
        'Add `sdd validate --staged` to it by hand rather than losing what is there.',
    );
  }

  const cli = fileURLToPath(new URL('../../bin/sdd.js', import.meta.url));
  await writeFile(hookPath, hookScript(process.execPath, cli), 'utf8');
  await chmod(hookPath, 0o755);
  stdout.write(
    `installed ${hookPath}\n\nThe hook validates only the changes a commit ` +
      'touches. CI should run `sdd validate`\nwith no flags to cover the rest.\n',
  );
  return 0;
}

// Which .sdd/changes/<id>/ directories does the staged diff touch?
export async function stagedChanges(root = process.cwd()) {
  const { stdout } = await run('git', ['diff', '--cached', '--name-only'], { cwd: root });
  const ids = new Set();
  for (const file of stdout.split('\n')) {
    const m = file.trim().match(/^\.sdd\/changes\/([^/]+)\//);
    if (m) ids.add(m[1]);
  }
  return [...ids].sort();
}
