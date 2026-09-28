import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from '../spec/config.js';
import {
  checkMiss,
  formatMiss,
  formatMissRate,
  latestFor,
  readTriageLog,
  recordTriage,
  summarizeNumstat,
} from '../spec/triage-log.js';
import { parseArgs } from './cost.js';

const run = promisify(execFile);

async function diffStats(root, range) {
  const args = range
    ? ['diff', '--numstat', range]
    : ['diff', '--numstat', '--cached'];
  const { stdout } = await run('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  return summarizeNumstat(stdout);
}

export async function triageAuditCommand(
  argv,
  { root = process.cwd(), stdout = process.stdout } = {},
) {
  const { flags, positional } = parseArgs(argv);

  if (positional[0] === 'rate' || flags.rate === true) {
    stdout.write(formatMissRate(await readTriageLog(root)));
    return 0;
  }

  const id = flags.id;
  if (typeof id !== 'string') {
    throw new Error('usage: sdd triage audit --id <ticket> [--range <git-range>]');
  }

  const log = await readTriageLog(root);
  const decision = latestFor(
    log.filter((e) => e.kind === 'decision'),
    id,
  );
  if (!decision) {
    throw new Error(`no triage decision recorded for ${id} — was it triaged through sdd?`);
  }

  const range = typeof flags.range === 'string' ? flags.range : null;
  const diff = await diffStats(root, range);
  const config = await loadConfig(root);
  const miss = checkMiss(decision, diff, config);

  await recordTriage({ kind: 'audit', id, class: decision.class, diff, miss }, root);
  stdout.write(formatMiss(miss));

  // Always 0. A miss is evidence for tuning, not a failure to fix.
  return 0;
}
