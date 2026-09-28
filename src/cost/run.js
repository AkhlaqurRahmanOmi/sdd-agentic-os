// Wraps an agent run, tees its stream-json output, and appends one record.

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createStreamParser } from './stream.js';
import { SCHEMA, append, assertValidId, costDir } from './store.js';

export const TICKET_CLASSES = ['bug', 'mid', 'feature', 'arch'];

export async function runWrapped({
  id,
  ticketClass,
  phase,
  command,
  root = process.cwd(),
  stdout = process.stdout,
  stderr = process.stderr,
  keepStream = true,
  force = false,
}) {
  assertValidId(id);
  if (!TICKET_CLASSES.includes(ticketClass)) {
    throw new Error(`--class must be one of: ${TICKET_CLASSES.join(', ')}`);
  }
  if (!command.length) throw new Error('no command given after --');

  await checkAssignment({ id, ticketClass, phase, root, stderr, force });

  const parser = createStreamParser();
  const startedAt = new Date();
  const startedMs = Date.now();

  let rawSink = null;
  if (keepStream) {
    await mkdir(costDir(root), { recursive: true });
    rawSink = createWriteStream(
      path.join(costDir(root), `${id}.${phase}.stream.jsonl`),
      { flags: 'a' },
    );
  }

  const child = spawn(command[0], command.slice(1), {
    stdio: ['inherit', 'pipe', 'inherit'],
  });

  // Forward every line unchanged so the wrapper stays composable, and parse a
  // copy as it goes.
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => {
    stdout.write(`${line}\n`);
    if (rawSink) rawSink.write(`${line}\n`);
    parser.handleLine(line);
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => {
      lines.close();
      resolve(signal ? `signal:${signal}` : (code ?? 0));
    });
  });
  if (rawSink) await new Promise((resolve) => rawSink.end(resolve));

  const summary = parser.summarize();
  const wrapperWallMs = Date.now() - startedMs;

  // No result event means no usage numbers. Recording a zero here would look
  // like a free run and quietly drag the baseline down, so refuse instead.
  if (!summary) {
    throw new Error(
      'no result event in output — the wrapped command must run with ' +
        '`--output-format stream-json` (and `--verbose` for `claude -p`)',
    );
  }

  const record = {
    schema: SCHEMA,
    kind: 'run',
    id,
    class: ticketClass,
    phase,
    started_at: startedAt.toISOString(),
    model: summary.model,
    session_id: summary.sessionId,
    tokens: summary.tokens,
    cost_usd: summary.costUsd,
    wall_ms: summary.wallMs ?? wrapperWallMs,
    wrapper_wall_ms: wrapperWallMs,
    api_ms: summary.apiMs,
    turns: summary.turns,
    read_calls: summary.readCalls,
    files_read: summary.filesRead.length,
    files_read_paths: summary.filesRead,
    model_usage: summary.modelUsage,
    exit_code: exitCode,
    ok: summary.ok && exitCode === 0,
    terminal_reason: summary.terminalReason,
    command,
  };

  const file = await append(record, root);
  stderr.write(formatRunSummary(record, file));
  return { record, file, exitCode };
}

// A matched split only means anything if the arms were fixed in advance.
// Running a ticket in the arm it was not assigned to is the one mistake that
// silently invalidates the comparison, so it stops the run rather than warning.
async function checkAssignment({ id, ticketClass, phase, root, stderr, force }) {
  const { readAssignment } = await import('./assignment.js');
  const plan = await readAssignment(root);
  if (!plan) return;

  const assigned = plan.assignments[id];
  if (!assigned) {
    stderr.write(
      `[sdd cost] ${id} is not in the matched split — recording it anyway, ` +
        'but it will not be part of the comparison.\n',
    );
    return;
  }
  if (assigned.class !== ticketClass) {
    throw new Error(
      `${id} is assigned class "${assigned.class}", not "${ticketClass}". ` +
        'Fix the class or re-plan the split.',
    );
  }
  if (assigned.arm !== phase) {
    if (!force) {
      throw new Error(
        `${id} is assigned to the "${assigned.arm}" arm but this run is ` +
          `"${phase}". Running a ticket in the wrong arm invalidates the ` +
          'matched split. Pass --force if that is genuinely what you want.',
      );
    }
    stderr.write(
      `[sdd cost] !! ${id} forced into "${phase}" against its assigned ` +
        `"${assigned.arm}" arm — the comparison no longer holds.\n`,
    );
  }
}

export function formatRunSummary(r, file) {
  const t = r.tokens;
  const cost = r.cost_usd == null ? 'n/a' : `$${r.cost_usd.toFixed(4)}`;
  const banner = r.ok
    ? ''
    : `\n  !! run failed (${r.terminal_reason ?? `exit ${r.exit_code}`}) — ` +
      'recorded as ok=false and excluded from report aggregates\n';
  return (
    `\n[sdd cost] ${r.id} (${r.class}/${r.phase})${banner}` +
    `\n  model      ${r.model ?? 'unknown'}` +
    `\n  tokens     in ${t.input}  cache-r ${t.cache_read}  cache-w ${t.cache_write}` +
    `  out ${t.output}  thinking ${t.thinking}` +
    `\n  cost       ${cost}` +
    `\n  turns      ${r.turns ?? 'n/a'}   files read ${r.files_read} (${r.read_calls} calls)` +
    `\n  wall       ${((r.wall_ms ?? 0) / 1000).toFixed(1)}s` +
    `\n  recorded   ${file}\n\n`
  );
}
