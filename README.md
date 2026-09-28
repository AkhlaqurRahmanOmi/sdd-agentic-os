# sdd

Spec-driven development harness. See [docs/milestones.md](docs/milestones.md)
for the phase plan.

Phase 0 only: `sdd cost`. Nothing else is built yet, deliberately — the rest of
the system does not start until there is a baseline to compare it against.

## Install

No dependencies, no build step. Node 22+.

```
npm link          # or: node bin/sdd.js ...
npm test
```

## `sdd cost`

Wraps an agent run and appends a record to `.sdd/cost/<ticket>.jsonl`.

```sh
sdd cost run --id REV-101 --class feature -- \
  claude -p "$(cat ticket.md)" --output-format stream-json --verbose
```

`--class` is one of `bug`, `mid`, `feature`, `arch`. `--phase` defaults to
`baseline`; use `--phase sdd` for the Phase 1 comparison runs.

The wrapped command **must** emit `stream-json` — that is where the token
counts live. Every line is forwarded to stdout unchanged, so the wrapper stays
composable; the summary goes to stderr. The raw stream is kept beside the
record as `<ticket>.<phase>.stream.jsonl` (gitignored).

### Recording rework

```sh
sdd cost annotate --id REV-101 --corrections 4 --followup-fix
```

Tokens alone cannot answer the plan's "cheaper **or better**" kill criterion.
`--corrections` is how many turns you spent telling the agent it built the
wrong thing; `--followup-fix` records that the change needed a follow-up.
Both are entered by hand after the run, because neither is visible from
inside it.

### Reading the table

```sh
sdd cost report
```

Reports **median and range**, not mean. With three or four tickets per class a
single outlier moves the mean further than the effect being measured.

## What gets recorded

From the run's `result` event: input / cache-read / cache-write / output /
thinking tokens, `total_cost_usd`, turn count, wall and API time, model.
Cost comes from the CLI rather than a hardcoded price table, so it does not go
stale when pricing changes.

Files read are not in the result event, so they are counted from `Read`
tool-use blocks in the `assistant` events — distinct paths and total calls.
This is the number the Phase 0 conditional turns on: if file-reading is not a
top-two token sink, the traceability index defers or is dropped.

## Two deliberate refusals

A run that emits no `result` event is **not recorded**. A zero-token record
would look like a free run and drag the baseline down.

A run whose result carries `is_error: true` is recorded with `ok: false` and
excluded from report aggregates. The CLI reports `subtype: "success"` even on
a failed run, so `is_error` is the only field that says whether it worked —
an auth failure otherwise lands in the baseline as a cheap success.

## Still unresolved

The Phase 1 gate re-runs these tickets after they are already done, against a
different repository state. The report labels cross-phase deltas as
directional for that reason. Settle the comparison design — matched split or
pinned-commit replay — before spending the ten tickets, not after.
