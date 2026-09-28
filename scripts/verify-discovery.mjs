#!/usr/bin/env node
// Asserts that a harness actually discovers the skills `sdd install` generates.
//
// Claude Code reports the skills it found in its stream-json init event, which
// it emits before any API call. So this runs headless with no credentials —
// the nightly needs no secrets, and a discovery regression fails loudly rather
// than showing up as an agent that quietly ignores the skills.

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installCommand } from '../src/commands/install.js';
import { SKILLS } from '../src/dist/templates.js';

const CLI = fileURLToPath(new URL('../bin/sdd.js', import.meta.url));

function runClaude(cwd, bin) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      bin,
      ['-p', 'noop', '--output-format', 'stream-json', '--verbose', '--model', 'claude-haiku-4-5'],
      { cwd, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let out = '';
    child.stdout.on('data', (c) => {
      out += c;
    });
    child.on('error', reject);
    child.on('close', () => resolve(out));
    setTimeout(() => child.kill('SIGKILL'), 120_000).unref();
  });
}

function discoveredSkills(streamJson) {
  for (const line of streamJson.split('\n')) {
    try {
      const event = JSON.parse(line);
      if (event.subtype === 'init') return event.skills ?? [];
    } catch {
      /* not JSON */
    }
  }
  return null;
}

const bin = process.env.SDD_CLAUDE_BIN ?? 'claude';
const root = await mkdtemp(path.join(tmpdir(), 'sdd-discovery-'));

try {
  await installCommand(['--targets', 'generic,claude'], { root, stdout: { write() {} } });

  const skills = discoveredSkills(await runClaude(root, bin));
  if (skills === null) {
    console.error('FAIL: no init event — could not read what the harness discovered');
    console.error(`(is \`${bin}\` installed? set SDD_CLAUDE_BIN to point at it)`);
    process.exit(1);
  }

  const expected = SKILLS.map((s) => s.name);
  const missing = expected.filter((name) => !skills.includes(name));

  if (missing.length) {
    console.error(`FAIL: Claude Code did not discover: ${missing.join(', ')}`);
    console.error(`it discovered ${skills.length} skill(s); sdd-* among them: ` +
      `${skills.filter((s) => s.startsWith('sdd-')).join(', ') || 'none'}`);
    process.exit(1);
  }

  console.log(`ok: Claude Code discovered all ${expected.length} sdd skills`);
  console.log(`   ${expected.join(', ')}`);

  // Codex reads AGENTS.md rather than a skills directory, and its discovery is
  // not asserted here. Claiming a pass for something unverified is worse than
  // an open gap, so this says so instead.
  console.log('\nnote: Codex discovery is NOT verified by this script.');
  console.log('      AGENTS.md is generated for it, but nothing here proves it is read.');
} finally {
  await rm(root, { recursive: true, force: true });
}
