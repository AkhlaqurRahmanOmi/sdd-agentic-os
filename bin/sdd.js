#!/usr/bin/env node
import { costCommand } from '../src/commands/cost.js';
import { initCommand } from '../src/commands/init.js';
import { proposeCommand } from '../src/commands/propose.js';
import { tasksCommand } from '../src/commands/tasks.js';
import { triageCommand } from '../src/commands/triage.js';
import { validateCommand } from '../src/commands/validate.js';

const USAGE = `sdd — spec-driven development harness

  sdd init                        Create .sdd/ with a config and a constitution.

  sdd triage --ticket <file> [--id <change>]
                                  Classify a ticket. tiny and small exit here
                                  with acceptance criteria and never touch the
                                  rest of the system.
  sdd propose --id <change>       Write EARS requirements. One human gate here.
  sdd tasks --id <change>         Decompose into self-contained task cards.
  sdd validate [--change <id>]    Every requirement has evidence, every task
                                  maps to a requirement. Exits 1 otherwise.

  sdd cost                        Record and report what agent runs cost.
`;

const COMMANDS = {
  cost: costCommand,
  init: initCommand,
  propose: proposeCommand,
  tasks: tasksCommand,
  triage: triageCommand,
  validate: validateCommand,
};

const [command, ...rest] = process.argv.slice(2);

try {
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  const run = COMMANDS[command];
  if (!run) {
    process.stderr.write(`unknown command: ${command}\n\n${USAGE}`);
    process.exit(2);
  }
  process.exit(await run(rest));
} catch (err) {
  process.stderr.write(`sdd: ${err.message}\n`);
  process.exit(2);
}
