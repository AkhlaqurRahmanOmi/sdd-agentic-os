// Aggregates recorded runs into the Phase 0 baseline table.
//
// Reports median and range rather than the mean: with three or four tickets
// per class a single outlier moves the mean more than the effect being
// measured, which is the whole thing the gate is trying to read.

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function totalTokens(t) {
  return t.input + t.cache_read + t.cache_write + t.output;
}

export function aggregate(records) {
  const runs = records.filter((r) => r.kind === 'run' && r.ok);
  const failed = records.filter((r) => r.kind === 'run' && !r.ok);
  const notes = records.filter((r) => r.kind === 'annotation');

  const groups = new Map();
  for (const r of runs) {
    const key = `${r.class}\u0000${r.phase}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const rows = [];
  for (const [key, group] of groups) {
    const [ticketClass, phase] = key.split('\u0000');
    const noteFor = (r) =>
      notes.filter((n) => n.id === r.id && n.phase === r.phase);
    const corrections = group
      .flatMap(noteFor)
      .map((n) => n.corrections)
      .filter((n) => typeof n === 'number');
    const followups = group.flatMap(noteFor).filter((n) => n.followup_fix === true);

    rows.push({
      class: ticketClass,
      phase,
      n: group.length,
      tickets: [...new Set(group.map((r) => r.id))].sort(),
      total: median(group.map((r) => totalTokens(r.tokens))),
      range: [
        Math.min(...group.map((r) => totalTokens(r.tokens))),
        Math.max(...group.map((r) => totalTokens(r.tokens))),
      ],
      input: median(group.map((r) => r.tokens.input)),
      cacheRead: median(group.map((r) => r.tokens.cache_read)),
      cacheWrite: median(group.map((r) => r.tokens.cache_write)),
      output: median(group.map((r) => r.tokens.output)),
      thinking: median(group.map((r) => r.tokens.thinking)),
      cost: median(group.map((r) => r.cost_usd).filter((c) => typeof c === 'number')),
      turns: median(group.map((r) => r.turns).filter((t) => typeof t === 'number')),
      filesRead: median(group.map((r) => r.files_read)),
      corrections: median(corrections),
      correctionsN: corrections.length,
      followupFixes: followups.length,
    });
  }

  rows.sort((a, b) => a.class.localeCompare(b.class) || a.phase.localeCompare(b.phase));
  return { rows, failed, runs };
}

function pad(value, width, right = false) {
  const s = String(value);
  return right ? s.padStart(width) : s.padEnd(width);
}

function table(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i]).length)),
  );
  const line = (cells) =>
    cells.map((c, i) => pad(c, widths[i], i > 0)).join('  ').trimEnd();
  return [
    line(headers),
    widths.map((w) => '-'.repeat(w)).join('  '),
    ...rows.map(line),
  ].join('\n');
}

const n = (v) => (v == null ? '-' : Math.round(v).toLocaleString('en-US'));

export function formatReport({ rows, failed }) {
  if (!rows.length) return 'No successful runs recorded yet.\n';

  const out = [];
  out.push('Token totals by ticket class (median, range across tickets)\n');
  out.push(
    table(
      ['class', 'phase', 'n', 'median', 'min', 'max', 'cost', 'turns', 'files'],
      rows.map((r) => [
        r.class,
        r.phase,
        r.n,
        n(r.total),
        n(r.range[0]),
        n(r.range[1]),
        r.cost == null ? '-' : `$${r.cost.toFixed(3)}`,
        n(r.turns),
        n(r.filesRead),
      ]),
    ),
  );

  out.push('\n\nWhere the tokens go (median per run, share of total)\n');
  out.push(
    table(
      ['class', 'phase', 'input', 'cache-read', 'cache-write', 'output', 'thinking'],
      rows.map((r) => {
        const share = (v) =>
          r.total ? `${n(v)} (${Math.round((v / r.total) * 100)}%)` : n(v);
        return [
          r.class,
          r.phase,
          share(r.input),
          share(r.cacheRead),
          share(r.cacheWrite),
          share(r.output),
          n(r.thinking),
        ];
      }),
    ),
  );

  const annotated = rows.filter((r) => r.correctionsN > 0);
  if (annotated.length) {
    out.push('\n\nRework (from `sdd cost annotate`)\n');
    out.push(
      table(
        ['class', 'phase', 'annotated', 'median corrections', 'follow-up fixes'],
        annotated.map((r) => [r.class, r.phase, r.correctionsN, n(r.corrections), r.followupFixes]),
      ),
    );
  } else {
    out.push(
      '\n\nNo rework annotations recorded. Token cost alone cannot answer ' +
        '"cheaper or better" —\nrecord corrections with `sdd cost annotate` ' +
        'or the Phase 1 gate has only half its evidence.',
    );
  }

  if (failed.length) {
    out.push(
      `\n\n${failed.length} failed run(s) excluded: ` +
        failed.map((r) => `${r.id}/${r.phase}`).join(', '),
    );
  }

  const phases = [...new Set(rows.map((r) => r.phase))];
  if (phases.length > 1) {
    out.push('\n\nPhase comparison by class\n');
    const classes = [...new Set(rows.map((r) => r.class))];
    out.push(
      table(
        ['class', ...phases, 'delta'],
        classes.map((c) => {
          const byPhase = phases.map(
            (p) => rows.find((r) => r.class === c && r.phase === p)?.total ?? null,
          );
          const [first, last] = [byPhase[0], byPhase[byPhase.length - 1]];
          const delta =
            first && last ? `${(((last - first) / first) * 100).toFixed(0)}%` : '-';
          return [c, ...byPhase.map(n), delta];
        }),
      ),
    );
    out.push(
      '\n\nThese phases ran against different repository states. Treat the delta ' +
        'as directional,\nnot as a measurement, unless the runs were matched or replayed from a pinned commit.',
    );
  }

  return `${out.join('')}\n`;
}
