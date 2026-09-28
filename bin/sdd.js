#!/usr/bin/env node
import { costCommand } from '../src/commands/cost.js';

const USAGE = `sdd — spec-driven development harness

  sdd cost   Record and report what agent runs cost.

Run \`sdd cost\` for its options.
`;

const [command, ...rest] = process.argv.slice(2);

try {
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  if (command !== 'cost') {
    process.stderr.write(`unknown command: ${command}\n\n${USAGE}`);
    process.exit(2);
  }
  process.exit(await costCommand(rest));
} catch (err) {
  process.stderr.write(`sdd: ${err.message}\n`);
  process.exit(2);
}
