import { listChanges } from './validate.js';
import {
  buildIndex,
  checkDrift,
  countAnchors,
  formatDrift,
  indexPath,
  readIndex,
  writeIndex,
} from '../spec/traceability.js';
import { parseArgs } from './cost.js';

export async function indexCommand(
  argv,
  { root = process.cwd(), stdout = process.stdout } = {},
) {
  const { positional } = parseArgs(argv);
  const sub = positional[0] ?? 'check';

  if (sub === 'build') {
    const index = await buildIndex(await listChanges(root), root);
    const file = await writeIndex(index, root);
    stdout.write(`wrote ${file}\n  ${countAnchors(index)} anchor(s)\n`);
    return 0;
  }

  if (sub === 'check') {
    const onDisk = await readIndex(root);
    if (!onDisk) {
      stdout.write('index: no .sdd/index.json — run `sdd index build`\n');
      return 0;
    }

    // A committed index that no longer matches the task cards is itself drift,
    // and the more common kind: someone edited a card and never rebuilt.
    const fresh = await buildIndex(await listChanges(root), root);
    if (JSON.stringify(fresh.changes) !== JSON.stringify(onDisk.changes)) {
      stdout.write(
        `ERROR  ${indexPath(root)} is out of date with the task cards\n` +
          '       run `sdd index build` and commit the result\n\nindex: failed\n',
      );
      return 1;
    }

    const drifted = await checkDrift(onDisk, root);
    stdout.write(formatDrift(drifted, countAnchors(onDisk)));
    return drifted.length ? 1 : 0;
  }

  throw new Error('usage: sdd index build|check');
}
