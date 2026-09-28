import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { installCommand } from '../src/commands/install.js';
import { SKILLS, renderAgentsMd } from '../src/dist/templates.js';
import { readManifest } from '../src/dist/manifest.js';
import { scratch, sink } from './helpers.js';

const io = (root) => ({ root, stdout: sink() });
const read = (root, rel) => readFile(path.join(root, rel), 'utf8');

test('AGENTS.md stays within the 150-line budget it exists to respect', () => {
  assert.ok(renderAgentsMd().split('\n').length <= 150);
});

test('every skill has front matter a harness can read', () => {
  for (const skill of SKILLS) {
    assert.match(skill.name, /^sdd-[a-z]+$/);
    assert.ok(skill.description.length > 20, `${skill.name} needs a real description`);
  }
});

test('install writes AGENTS.md and skills for the generic floor and Claude Code', async () => {
  const root = await scratch('sdd-install-');
  await installCommand([], io(root));

  assert.match(await read(root, 'AGENTS.md'), /sdd triage/);
  for (const skill of SKILLS) {
    assert.match(await read(root, `.agents/skills/${skill.name}/SKILL.md`), /^---\n/);
    assert.match(await read(root, `.claude/skills/${skill.name}/SKILL.md`), /^---\n/);
  }
});

test('an unknown target is rejected rather than silently skipped', async () => {
  await assert.rejects(
    installCommand(['--targets', 'emacs'], io(await scratch('sdd-install-'))),
    /unknown target/,
  );
});

test('re-installing an untouched file updates it in place', async () => {
  const root = await scratch('sdd-install-');
  await installCommand([], io(root));
  const ctx = io(root);
  await installCommand([], ctx);
  assert.match(ctx.stdout.text, /unchanged/);
  assert.doesNotMatch(ctx.stdout.text, /CONFLICT/);
});

test('a file the user edited is never overwritten; the new version lands beside it', async () => {
  const root = await scratch('sdd-install-');
  await installCommand([], io(root));
  await writeFile(path.join(root, 'AGENTS.md'), '# my own rules\n', 'utf8');

  // Change what install would write, so there is something to conflict with.
  const manifest = await readManifest(root);
  manifest.files['AGENTS.md'] = 'stale-hash';
  await writeFile(
    path.join(root, '.sdd', 'generated.json'),
    JSON.stringify(manifest),
    'utf8',
  );

  const ctx = io(root);
  await installCommand([], ctx);

  assert.equal(await read(root, 'AGENTS.md'), '# my own rules\n');
  assert.match(await read(root, 'AGENTS.md.incoming'), /sdd triage/);
  assert.match(ctx.stdout.text, /CONFLICT/);
  assert.match(ctx.stdout.text, /Nothing you edited was overwritten/);
});

test('a pre-existing AGENTS.md sdd never wrote is treated as the user’s', async () => {
  const root = await scratch('sdd-install-');
  await writeFile(path.join(root, 'AGENTS.md'), '# predates sdd\n', 'utf8');

  const ctx = io(root);
  await installCommand([], ctx);

  assert.equal(await read(root, 'AGENTS.md'), '# predates sdd\n');
  assert.match(await read(root, 'AGENTS.md.incoming'), /sdd triage/);
  assert.match(ctx.stdout.text, /not written by sdd/);
});

test('a user edit that matches what install would write is adopted, not conflicted', async () => {
  const root = await scratch('sdd-install-');
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'AGENTS.md'), renderAgentsMd(), 'utf8');

  const ctx = io(root);
  await installCommand([], ctx);
  assert.doesNotMatch(ctx.stdout.text, /CONFLICT/);
});

test('the manifest records a hash for every file install wrote', async () => {
  const root = await scratch('sdd-install-');
  await installCommand(['--targets', 'generic'], io(root));
  const manifest = await readManifest(root);
  assert.equal(Object.keys(manifest.files).length, SKILLS.length + 1);
  for (const hash of Object.values(manifest.files)) assert.match(hash, /^[0-9a-f]{64}$/);
});
