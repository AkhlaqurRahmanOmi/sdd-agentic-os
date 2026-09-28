// Executes the commands recorded in evidence.md and compares what actually
// happens against what the evidence claims.
//
// Without this, `sdd validate` checks that the agent's evidence.md mentions
// the agent's own REQ ids with `exit: 0` beside them. That is self-attestation:
// it fails on a forgotten line, never on a fabricated one. Running the command
// is what turns the claim into a check.
//
// SECURITY: these commands come from a markdown file inside the repository, so
// running them is arbitrary shell execution from repository content. It is
// therefore opt-in (`--execute`), never the default, and deliberately not what
// the pre-commit hook runs — a hook that executes whatever a branch's
// evidence.md says would run it on every checkout of every branch.

import { spawn } from 'node:child_process';

export const DEFAULT_TIMEOUT_MS = 300_000;

// Commands are shared across requirements far more often than not, so a naive
// implementation re-runs the same suite once per REQ.
export function collectCommands(evidenceByReq) {
  const commands = new Map();
  for (const [reqId, entries] of evidenceByReq) {
    for (const entry of entries) {
      if (entry.kind !== 'test' || !entry.detail) continue;
      if (!commands.has(entry.detail)) commands.set(entry.detail, []);
      commands.get(entry.detail).push({ reqId, claimed: entry.fields.exit });
    }
  }
  return commands;
}

export function runCommand(command, { cwd = process.cwd(), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    const take = (chunk) => {
      // Enough to diagnose, not enough to bury the report.
      if (out.length < 4000) out += chunk;
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ command, exit: null, error: err.message, ms: Date.now() - started, output: out });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        command,
        exit: timedOut ? null : (code ?? null),
        signal: signal ?? null,
        timedOut,
        ms: Date.now() - started,
        output: out.trim(),
      });
    });
  });
}

export async function executeEvidence(evidenceByReq, { cwd = process.cwd(), timeoutMs } = {}) {
  const commands = collectCommands(evidenceByReq);
  const problems = [];

  for (const [command, claimants] of commands) {
    const result = await runCommand(command, { cwd, timeoutMs });

    for (const { reqId, claimed } of claimants) {
      const where = `${reqId}: \`${command}\``;

      if (result.timedOut) {
        problems.push({
          severity: 'error',
          code: 'evidence-timeout',
          message: `${where} did not finish within ${Math.round((timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s`,
          where: 'evidence.md',
        });
        continue;
      }
      if (result.exit === null) {
        problems.push({
          severity: 'error',
          code: 'evidence-unrunnable',
          message: `${where} could not be run: ${result.error ?? 'no exit status'}`,
          where: 'evidence.md',
        });
        continue;
      }
      // The claim and the observation disagreeing is the finding this whole
      // command exists for: the evidence was fabricated, or it has gone stale.
      if (claimed !== undefined && String(result.exit) !== String(claimed)) {
        problems.push({
          severity: 'error',
          code: 'evidence-mismatch',
          message:
            `${where} claims exit ${claimed} but actually exited ${result.exit}` +
            (result.output ? `\n        ${result.output.split('\n').slice(-3).join('\n        ')}` : ''),
          where: 'evidence.md',
        });
        continue;
      }
      if (result.exit !== 0) {
        problems.push({
          severity: 'error',
          code: 'evidence-failing',
          message: `${where} exited ${result.exit}`,
          where: 'evidence.md',
        });
      }
    }
  }

  return { problems, ran: commands.size };
}
