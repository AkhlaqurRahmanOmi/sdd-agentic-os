import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { DEFAULT_CONFIG, loadConfig, parseConfig, renderConfig } from '../src/spec/config.js';
import { configPath, sddDir } from '../src/spec/paths.js';
import { scratch } from './helpers.js';

test('scalars, nesting and comments parse', () => {
  const parsed = parseConfig(`
# a comment
triage:
  model: claude-haiku-4-5   # trailing comment
  small_max_files: 2
  enabled: true
name: bare value
`);
  assert.deepEqual(parsed, {
    triage: { model: 'claude-haiku-4-5', small_max_files: 2, enabled: true },
    name: 'bare value',
  });
});

test('a line it cannot parse throws rather than being skipped', () => {
  assert.throws(() => parseConfig('this is not config\n'), /cannot parse/);
});

test('an indented key with no parent throws', () => {
  assert.throws(() => parseConfig('  orphan: 1\n'), /no parent/);
});

test('missing config falls back to defaults', async () => {
  assert.deepEqual(await loadConfig(await scratch('sdd-config-')), DEFAULT_CONFIG);
});

test('config overrides merge over defaults instead of replacing sections', async () => {
  const root = await scratch('sdd-config-');
  await mkdir(sddDir(root), { recursive: true });
  await writeFile(configPath(root), 'triage:\n  model: claude-sonnet-5\n', 'utf8');
  const config = await loadConfig(root);
  assert.equal(config.triage.model, 'claude-sonnet-5');
  assert.equal(config.triage.small_max_files, DEFAULT_CONFIG.triage.small_max_files);
  assert.equal(config.propose.model, DEFAULT_CONFIG.propose.model);
});

test('rendered config round-trips through the parser', () => {
  assert.deepEqual(parseConfig(renderConfig()), DEFAULT_CONFIG);
});
