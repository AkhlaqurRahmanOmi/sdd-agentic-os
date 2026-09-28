# ADR 002 — What the traceability index anchors to

**Status:** Accepted. Implemented in `sdd index`.
**Date:** 2026-09-28

> Backfilled from decisions recorded in `docs/milestones.md` while Phase 2 was
> built. The evidence decision came out of running the Phase 2 gate.

## Context

`index.json` maps requirements to the code that satisfies them, and CI fails
when a requirement points at code that no longer exists. The plan's own kill
criterion was blunt: *if the drift check cannot be made reliable, ship without
the index — a stale index is worse than none.*

Reliability here is asymmetric. A false **failure** blocks a legitimate commit;
people respond with `--no-verify`, and the check is dead within a week. A false
**pass** lets the index rot quietly. Both are bad, but the first kills the check
outright, so the design leans toward leniency and says so rather than pretending
to a precision it does not have.

## Decision

### Anchors are file + symbol, never line ranges

`src/auth/login.js (handleLogin)`, not `src/auth/login.js:L40-L72`.

A line range breaks on **any** edit above it, including a reformat that changes
nothing semantic. An anchor format that fires on unrelated commits is the
cry-wolf failure, and it would have arrived on roughly the first week of normal
work.

This was settled at Phase 1, when `sdd tasks` had to tell the model what to
write on a card, rather than discovered at Phase 2 when the index was built.
A line-range anchor is still accepted on input and recorded with the range
dropped, so an old card degrades rather than failing.

### Symbol presence is a word-boundary search, not a parse

`checkDrift` reads the file and tests `(?<![\w$])symbol(?![\w$])`.

This is honest about what it catches:

| Change | Detected |
|---|---|
| Symbol renamed | yes |
| Symbol deleted | yes |
| File deleted | yes |
| Symbol moved within the file | no — and correctly so |
| Symbol survives only in a comment or a string | **no** — false pass |

The alternative is a parser per language. That is a large, permanently-growing
surface for a check whose job is to notice that a card has gone stale, and
every language it does not yet cover fails open anyway. A check that is
occasionally too lenient beats one that is occasionally wrong and gets switched
off.

### Evidence is not in the index

The index carries requirement → tasks → anchors. It does **not** carry evidence.

This was not the original design. Evidence was in the index, and running the
Phase 2 gate showed why that fails: evidence changes every time a task
completes, so `index check` reported "out of date with the task cards" on nearly
every commit — the same cry-wolf failure the anchor decision was made to avoid,
reached by a different route.

Evidence lives in `evidence.md` and `sdd validate` checks it. The index now
changes only when requirements or task cards change, which is what "out of date"
should mean.

The general rule: **do not put things with different change frequencies in the
same checked artifact.**

### The index is checked two ways

1. **Staleness** — rebuild from the task cards and compare. Catches a card
   edited without rebuilding.
2. **Drift** — every anchor must still resolve. Catches code moving out from
   under a card.

Both exit 1. The first is the common case; the second is the one the plan cared
about.

## Consequences

- Task cards must name symbols, which is a real constraint on what `sdd tasks`
  emits and is enforced through the prompt rather than through validation.
- A symbol appearing in a comment masks its own deletion. Accepted.
- `.sdd/index.json` is a committed generated file, so it appears in every diff
  that changes a card. Noisy, but it is what makes the staleness check possible.

## Verified

By breaking it, not by reading the code:

- renamed symbol → exit 1
- deleted file → exit 1
- function moved 100 lines down → exit 0 (control)
- card edited without rebuilding → exit 1

## What would falsify this

- Word-boundary matching produces false passes often enough that the index
  drifts anyway. Then the kill criterion applies and the index goes, rather than
  a parser arriving to rescue it.
- `index.json` in every card diff proves annoying enough that people stop
  rebuilding it. The staleness check would then be firing constantly, which is
  the signal to move the index out of version control and rebuild it in CI.

## Addendum — evidence execution

This ADR left evidence as self-attestation: `validate` checked that the text
claimed `exit: 0`, never that it was true. `sdd validate --execute` now runs
the recorded commands and fails on a claim that disagrees with the observation.

It is opt-in because executing evidence means running arbitrary shell from a
file inside the repository. CI already runs repository-supplied code, so it
belongs there; a pre-commit hook would run it on every checkout of every
branch, so `--execute --staged` is refused.

That the evidence format already carried the command and exit status is why
this was additive rather than a migration — which was the reason for recording
them in the first place.

## See also

- ADR 001 — baseline measurement
- ADR 003 — context retrieval, which uses this index's graph for linkage
  distance
