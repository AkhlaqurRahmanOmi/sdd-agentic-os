// Generated-file tracking, so `sdd install` can upgrade its own output without
// destroying anything a user edited.
//
// The manifest records the SHA-256 of each file as sdd last wrote it. On the
// next install:
//   absent            -> write it
//   hash matches      -> untouched since sdd wrote it, safe to overwrite
//   hash differs      -> edited; write <path>.incoming and leave theirs alone
//   no manifest entry -> not ours; same as edited
//
// The last case matters most: a repo that had AGENTS.md before sdd arrived
// must not lose it because the tool assumed ownership.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sddDir } from '../spec/paths.js';

export const MANIFEST_SCHEMA = 1;
export const manifestPath = (root = process.cwd()) => path.join(sddDir(root), 'generated.json');

export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

async function readOptional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function readManifest(root = process.cwd()) {
  const text = await readOptional(manifestPath(root));
  return text === null ? { schema: MANIFEST_SCHEMA, files: {} } : JSON.parse(text);
}

export async function writeManifest(manifest, root = process.cwd()) {
  await mkdir(path.dirname(manifestPath(root)), { recursive: true });
  await writeFile(manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export function classify(relPath, onDisk, manifest) {
  if (onDisk === null) return 'create';
  const recorded = manifest.files?.[relPath];
  if (!recorded) return 'foreign';
  return recorded === sha256(onDisk) ? 'update' : 'edited';
}

// Writes one generated file, returning what it did rather than deciding for
// the caller how loud to be about it.
export async function writeGenerated(relPath, content, { root = process.cwd(), manifest }) {
  const abs = path.join(root, relPath);
  const onDisk = await readOptional(abs);
  const action = classify(relPath, onDisk, manifest);

  await mkdir(path.dirname(abs), { recursive: true });

  if (action === 'create' || action === 'update') {
    if (onDisk === content) {
      manifest.files[relPath] = sha256(content);
      return { relPath, action: 'unchanged' };
    }
    await writeFile(abs, content, 'utf8');
    manifest.files[relPath] = sha256(content);
    return { relPath, action };
  }

  // Edited or foreign: never overwrite. Park the new version beside it.
  if (onDisk === content) {
    // They edited it into exactly what we would have written. Adopt it.
    manifest.files[relPath] = sha256(content);
    return { relPath, action: 'adopted' };
  }
  await writeFile(`${abs}.incoming`, content, 'utf8');
  return { relPath, action: action === 'foreign' ? 'foreign' : 'conflict' };
}

export function formatInstall(results) {
  const by = (a) => results.filter((r) => r.action === a);
  const lines = [];

  for (const r of [...by('create'), ...by('update')]) {
    lines.push(`  ${r.action === 'create' ? 'created ' : 'updated '} ${r.relPath}`);
  }
  const unchanged = by('unchanged').length + by('adopted').length;
  if (unchanged) lines.push(`  unchanged ${unchanged} file(s)`);

  const conflicts = [...by('conflict'), ...by('foreign')];
  if (conflicts.length) {
    lines.push('');
    for (const r of conflicts) {
      lines.push(
        `  CONFLICT ${r.relPath}` +
          `\n           ${r.action === 'foreign' ? 'not written by sdd' : 'edited since sdd wrote it'}` +
          `\n           new version is at ${r.relPath}.incoming — merge what you want`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}
