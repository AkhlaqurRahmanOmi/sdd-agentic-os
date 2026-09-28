# ADR 001 — How the baseline is measured

**Status:** Accepted. Implemented in `sdd cost`.
**Date:** 2026-09-28

> Backfilled from decisions recorded in `docs/milestones.md` while Phase 0 was
> built. The decisions were made then; this file is the record, written after.

## Context

The whole plan turns on one comparison: do tickets run through the spec layer
cost less, or come out better, than tickets run without it? Every gate and
every kill criterion reads off that number.

The original design was: measure ten tickets with no SDD, build the spec layer,
then "run the same ten tickets through it and compare". That comparison cannot
be made. By the time the second run happens the tickets are done — the
repository is in a different state, the answer is known, and the fix may be
sitting in the history the agent can read. Whatever number came out would be
rationalised in whichever direction was wanted.

Agent runs are also high-variance. Identical prompts swing token counts by
large factors depending on which files the model decides to open. With three or
four tickets per class, that variance is larger than most effects worth
detecting.

## Decision

### Matched split, fixed before any ticket runs

Each ticket runs in exactly **one** arm — `baseline` or `sdd` — never both.
Arms are assigned up front by `sdd cost plan`, which writes
`.sdd/cost/assignment.json`, and that file is committed.

Assignment is deterministic from `(seed, ticket id)` and alternates down a
shuffled per-class list, so it is reproducible, not chosen by hand, and no class
lands entirely in one arm.

`sdd cost run` **refuses** a ticket whose arm disagrees with the assignment, and
refuses a class that disagrees with it. `--force` overrides and says on stderr
that the comparison no longer holds.

The failure mode this exists to prevent is not dishonesty. It is the ordinary
drift of assigning arms after seeing results. With enforcement, a post-hoc swap
has to be a visible edit to a committed file rather than a flag typed at a
prompt.

### Ticket mix is 6 feature / 4 bug

The original mix — 4 bug, 3 mid, 3 feature — splits the feature class 2/1,
leaving **one** feature ticket in the `sdd` arm. The kill criterion turns
entirely on feature-class tickets, so the gate would have rested on a single
data point.

6/4 splits 3/3 and 2/2. `sdd cost plan` confirms it by reporting no thin arms.

The mid class is **dropped**, not shrunk. Three classes across ten tickets
cannot give any class enough per arm, and mid is the class no gate or kill
criterion refers to.

### A delta under ~25% on the feature class is no signal

Three tickets per arm is enough to see a large effect and not enough to see a
small one. This is written down before the numbers exist precisely so it cannot
be negotiated afterwards, when a 17% difference is sitting there looking like a
result.

### Rework is recorded, not just tokens

The kill criterion is "cheaper **or better**". Tokens answer only the first
half, and "better" was undefined. `sdd cost annotate` records, per ticket:

- `--corrections N` — turns spent telling the agent it built the wrong thing
- `--followup-fix` — whether the change needed a follow-up

Neither is visible from inside a run, so both are entered by hand afterwards.
A spec layer costing 1.4x tokens while halving correction rounds is a win, and
without these two fields the gate would score it as a loss.

### Failed runs never enter the baseline

A run whose `result` event carries `is_error: true` is recorded with
`ok: false` and excluded from aggregates. The CLI reports `subtype: "success"`
even on a failed run, so `is_error` is the only field that says whether it
worked. A run that emits no `result` event is not recorded at all — a
zero-token record reads as a free run and drags the baseline down.

### Report median and range, never mean

At three or four tickets per class, one outlier moves the mean further than the
effect being measured.

## Consequences

- Each ticket yields data for one arm only, so ten tickets buy five comparisons,
  not ten.
- Three feature tickets per arm remains thin. This is a smoke test with a
  stated resolution limit, not a measurement.
- The assignment file must be committed before the first run, which is a step
  that is easy to skip and expensive to skip.

## What would falsify this

- Variance within an arm turns out to exceed 25%, in which case the threshold is
  too permissive and the feature-class gate cannot be decided at n=3 at all.
- Correction turns prove impossible to count consistently by hand, in which
  case "better" needs a different proxy before the gate, not after.

## See also

- ADR 002 — traceability anchors
- ADR 003 — context retrieval (proposes validating its weights against the
  `files_read_paths` this ADR's records collect)
