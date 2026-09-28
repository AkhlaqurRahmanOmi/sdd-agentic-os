import { checkBudgets, formatBudgets, setCeiling } from '../cost/budget.js';
import { parseArgs } from './cost.js';

export async function budgetCommand(
  argv,
  { root = process.cwd(), stdout = process.stdout } = {},
) {
  const { flags, positional } = parseArgs(argv);
  const sub = positional[0] ?? 'check';

  if (sub === 'set') {
    const id = flags.change;
    if (typeof id !== 'string') throw new Error('usage: sdd budget set --change <id> [--raise]');
    const { tokens, previous } = await setCeiling(id, { root, raise: flags.raise === true });
    const n = (v) => v.toLocaleString('en-US');
    stdout.write(
      previous === null
        ? `${id}: ceiling set to ${n(tokens)} tokens\n`
        : `${id}: ceiling ${n(previous)} -> ${n(tokens)} tokens\n`,
    );
    return 0;
  }

  if (sub === 'check') {
    const results = await checkBudgets(root);
    stdout.write(formatBudgets(results));
    return results.some((r) => r.status === 'over') ? 1 : 0;
  }

  throw new Error('usage: sdd budget set|check');
}
