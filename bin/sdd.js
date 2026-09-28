#!/usr/bin/env node
import { costCommand } from '../src/commands/cost.js';
import { initCommand } from '../src/commands/init.js';
import { validateCommand } from '../src/commands/validate.js';

const USAGE = `sdd — spec-driven development harness

  sdd init                Create .sdd/ with a config and a constitution.
  sdd validate [--change <id>]
                          Check that every requirement has evidence and every
                          task maps to a requirement. Exits 1 on any error.
  sdd cost                Record and report what agent runs cost.

Run a subcommand with --help for its options.
`;

const COMMANDS = { cost: costCommand, init: initCommand, validate: validateCommand };

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
