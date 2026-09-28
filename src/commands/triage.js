import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { invokeAgentJson } from '../agent/invoke.js';
import { TRIAGE_SCHEMA, triagePrompt } from '../agent/prompts.js';
import { loadConfig } from '../spec/config.js';
import { changeDir } from '../spec/paths.js';
import { renderState } from '../spec/render.js';
import { recordTriage } from '../spec/triage-log.js';
import { readTicket, requireFlag } from './shared.js';
import { triageAuditCommand } from './triage-audit.js';
import { parseArgs } from './cost.js';

// tiny and small never reach the rest of the system — that exit is the only
// token rule in the plan with benchmark support behind it.
const SKIPS_SPEC = new Set(['tiny', 'small']);

export async function triageCommand(
  argv,
  { root = process.cwd(), stdout = process.stdout, stderr = process.stderr, flags } = {},
) {
  // `sdd triage audit ...` checks a past decision against the diff it produced.
  const { positional } = parseArgs(argv);
  if (positional[0] === 'audit') {
    return triageAuditCommand(argv.slice(argv.indexOf('audit') + 1), { root, stdout });
  }

  const f = flags ?? requireFlag.parse(argv);
  const ticket = await readTicket(f, root);
  const config = await loadConfig(root);

  const { data } = await invokeAgentJson({
    prompt: triagePrompt(ticket, config),
    model: config.triage.model,
    schema: TRIAGE_SCHEMA,
    cwd: root,
    config,
    driver: typeof f.driver === 'string' ? f.driver : null,
    stderr,
  });

  // Recorded for every class, including the ones that write nothing else.
  // Without this a tiny/small decision leaves no trace and cannot be audited.
  if (typeof f.id === 'string') {
    await recordTriage(
      { kind: 'decision', id: f.id, class: data.class, area: data.area, reason: data.reason },
      root,
    );
  }

  stdout.write(`\nclass: ${data.class}  (area ${data.area})\n${data.reason}\n`);

  if (SKIPS_SPEC.has(data.class)) {
    stdout.write(
      `\nAcceptance criteria — work from these directly, no spec:\n${data.acceptance_criteria
        .map((c) => `  - ${c}`)
        .join('\n')}\n\n` +
        'If this turns out to need more than it looked like, re-run triage\n' +
        'rather than improvising a spec: a class that was wrong is worth\n' +
        'recording, because the thresholds are guesses until tickets correct them.\n' +
        '\nAfter it lands: `sdd triage audit --id <id>` checks the decision\n' +
        'against the diff it actually produced.\n',
    );
    return 0;
  }

  if (typeof f.id !== 'string') {
    stdout.write(`\nNeeds a spec. Re-run with --id <change-id> to scaffold it.\n`);
    return 0;
  }

  const dir = changeDir(f.id, root);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'ticket.md'), `${ticket.trim()}\n`, 'utf8');
  await writeFile(path.join(dir, 'area'), `${data.area}\n`, 'utf8');
  await writeFile(path.join(dir, 'state.md'), renderState(f.id, 'triaged'), 'utf8');
  stdout.write(`\nscaffolded ${dir}\nnext: sdd propose --id ${f.id}\n`);
  return 0;
}
