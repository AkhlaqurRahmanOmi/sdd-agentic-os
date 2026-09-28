import { SCHEMA, append, assertValidId, readAll, readRecords } from '../cost/store.js';
import { TICKET_CLASSES, runWrapped } from '../cost/run.js';
import { aggregate, formatReport } from '../cost/report.js';

const USAGE = `sdd cost — record what an agent run costs

  sdd cost run --id <ticket> --class <${TICKET_CLASSES.join('|')}> [--phase <name>] -- <command...>
      Wrap a run, tee its output, append a record to .sdd/cost/<ticket>.jsonl.
      The command must emit stream-json, e.g.
        sdd cost run --id ABC-1 --class feature -- \\
          claude -p "<ticket>" --output-format stream-json --verbose

  sdd cost annotate --id <ticket> [--phase <name>] --corrections <n> [--followup-fix]
      Record rework after the fact: how many turns you spent correcting the
      agent, and whether the change needed a follow-up fix. Token cost alone
      does not answer "cheaper or better".

  sdd cost report [--id <ticket>]
      Aggregate recorded runs by ticket class and phase.

Options:
  --phase <name>   Defaults to "baseline".
  --no-keep-stream Do not save the raw stream alongside the record.
`;

export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  let rest = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      rest = argv.slice(i + 1);
      break;
    }
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (name.startsWith('no-')) {
      flags[name.slice(3)] = false;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[name] = true;
    } else {
      flags[name] = next;
      i += 1;
    }
  }
  return { flags, positional, rest };
}

function required(flags, name) {
  const value = flags[name];
  if (typeof value !== 'string' || !value) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

export async function costCommand(
  argv,
  { root = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {},
) {
  const { flags, positional, rest } = parseArgs(argv);
  const sub = positional[0];

  if (!sub || flags.help) {
    stdout.write(USAGE);
    return 0;
  }

  const phase = typeof flags.phase === 'string' ? flags.phase : 'baseline';

  if (sub === 'run') {
    const { exitCode } = await runWrapped({
      id: required(flags, 'id'),
      ticketClass: required(flags, 'class'),
      phase,
      command: rest ?? [],
      root,
      stdout,
      stderr,
      keepStream: flags['keep-stream'] !== false,
    });
    return typeof exitCode === 'number' ? exitCode : 1;
  }

  if (sub === 'annotate') {
    const id = assertValidId(required(flags, 'id'));
    const corrections = Number(required(flags, 'corrections'));
    if (!Number.isInteger(corrections) || corrections < 0) {
      throw new Error('--corrections must be a non-negative integer');
    }
    const record = {
      schema: SCHEMA,
      kind: 'annotation',
      id,
      phase,
      corrections,
      followup_fix: flags['followup-fix'] === true,
      recorded_at: new Date().toISOString(),
    };
    const file = await append(record, root);
    stderr.write(
      `[sdd cost] annotated ${id}/${phase}: ${corrections} correction turn(s), ` +
        `follow-up fix ${record.followup_fix ? 'yes' : 'no'} -> ${file}\n`,
    );
    return 0;
  }

  if (sub === 'report') {
    const records =
      typeof flags.id === 'string' ? await readRecords(flags.id, root) : await readAll(root);
    stdout.write(formatReport(aggregate(records)));
    return 0;
  }

  throw new Error(`unknown subcommand: ${sub}`);
}

export { USAGE };
