# Milestones

Decisions made along the way are recorded in [docs/adr/](adr/); this file
tracks the phases and their gates.

Paste into GitHub → Issues → Milestones → New milestone.
Week 1 begins Mon 2026-09-28. Due dates are the Sunday ending each phase.

---

## Phase 0 — Baseline
**Due:** 2026-10-04

Build `sdd cost` and measure 10 real RevinrIT tickets:
**6 multi-service features, 4 one-file bugs.** The mid-size class is dropped.

Per-phase records in `.sdd/cost/<id>.jsonl`: input, cached-read, cache-write,
output, thinking tokens, model, wall time, files read, turn count.

**Exit:** a baseline number per ticket class exists. Phase 1 does not start without it.

**Conditional:** if file-reading is not in the top two token sinks, the
traceability index defers to Phase 4 or is dropped.

**Decided** (→ [ADR 001](adr/001-baseline-measurement.md)):
- Comparison design is a **matched split**: each ticket runs in exactly one
  arm, arms fixed before any ticket runs via `sdd cost plan`, which writes
  `.sdd/cost/assignment.json`. `sdd cost run` refuses a ticket in the wrong
  arm, so a post-hoc swap has to be a visible edit to a committed file.
- `sdd cost` records correction turns and follow-up fixes via
  `sdd cost annotate`, because tokens answer only the "cheaper" half of the
  kill criterion.

- Ticket mix is **6 feature / 4 bug**, replacing the original 4 bug / 3 mid /
  3 feature. That mix split the feature class 2/1, leaving the `sdd` arm with
  one feature ticket — and the kill criterion turns entirely on feature-class
  tickets, so the gate would have rested on a single data point. 6/4 splits
  3/3 and 2/2, which `sdd cost plan` confirms by reporting no thin arms.

  The mid class is dropped rather than shrunk. Three classes across ten
  tickets cannot give any class enough per arm, and mid is the class no gate
  or kill criterion refers to.

  Two features per arm is still thin. It is enough to see a large effect and
  not enough to see a small one, so a delta under roughly 25% should be read
  as "no signal", not as a result.

---

## Phase 1 — Core
**Due:** 2026-10-25

Repo layout under `.sdd/`: `config.yaml`, `constitution.md` (≤1500 tokens,
immutable during a session), `changes/<id>/` with `requirements.md` (EARS,
`REQ-<AREA>-<NNN>`), `tasks.md`, `tasks/T01.md`, `state.md`, `evidence.md`.

Four commands:
- `sdd triage <ticket>` — cheap model → tiny/small/feature/arch. Tiny and small
  exit here with inline acceptance criteria.
- `sdd propose` — EARS requirements, REQ IDs, Open Questions block. One human gate.
- `sdd tasks` — cards: goal, inlined REQ text, target files with anchors,
  test command, done-when. Nothing else.
- `sdd validate` — every REQ has evidence, every task maps to a REQ, else exit 1.

No design phase. No archive. No subagents.

**Exit:** the 10 tickets run through it and beat baseline on feature-class.

**Kill:** if feature tickets don't beat baseline, the problem is triage or
cards. Do not add a design phase to fix it.

**Resolved:**
- The gate after `propose` has an escape hatch. `sdd approve` records review;
  `sdd tasks --bypass-gate "<reason>"` proceeds without it and writes down
  that it did. `sdd validate` reports a bypass, `--strict` makes it an error.
  A gate with no way past it gets routed around, leaving no gate and no record
  that there wasn't one.
- `sdd triage audit` compares a decision against the diff it produced and
  records misses to `.sdd/triage.jsonl`. It warns and never fails: the work is
  already done by then, and the value is the dataset that tunes the
  thresholds.

---

## Phase 2 — Enforcement + index
**Due:** 2026-11-01

In order:
1. Git pre-commit hook + CI job running `sdd validate`. Agent-agnostic by
   construction. This is the differentiator.
2. Budget ratchet — CI fails when a change exceeds its recorded token ceiling.
3. `index.json` — traceability graph written as a byproduct of `sdd tasks`,
   plus a CI check that fails when a REQ points at code that no longer exists.

**Exit:** a deliberately broken commit fails CI. Verified by breaking it, not
by reading the code.

**Kill:** if the drift check can't be made reliable, ship without the index.
A stale index is worse than none.

**Gate verified** by breaking it, not by reading the code:
- requirement with no evidence -> pre-commit hook blocks a real commit
- renamed symbol -> `index check` exits 1; deleted file -> exits 1
- function moved 100 lines down -> exits 0 (control: movement is not drift)
- run over ceiling -> `budget check` exits 1

**Decided** (→ [ADR 002](adr/002-traceability-anchors.md)):
- Anchors are file + symbol, never line ranges.
- Evidence is not in `index.json`. It changes on every task completion, so
  including it made "index out of date" fire on nearly every commit. Found by
  running the gate.

**Resolved:**
- `sdd validate --execute` runs the recorded evidence commands and fails when
  a claimed exit status disagrees with the observed one. Opt-in, and refused
  together with `--staged`: the commands come from a file in the repository,
  so CI is the right place to run them and a pre-commit hook is not.

**Still unresolved:**
- Symbol presence is a word-boundary search, not a parse. A symbol surviving
  only in a comment or a string passes when it should not.

---

## Phase 3 — Distribution
**Due:** 2026-11-15

- npm core: `npx @you/sdd init`
- Generates `AGENTS.md` (≤150 lines, pointers only) + `.agents/skills/sdd-*/SKILL.md`
- Native plugins for Claude Code and Codex only
- SHA-256 per generated file; `.incoming` sidecars on conflict
- Nightly CI installing into headless Claude Code and Codex, asserting skill discovery

Everything else rides the generic floor with no adapter code.

**Kill:** week 7 and nobody but you uses it → personal tool. Drop npm and the
marketplace, keep the repo and a deploy script, iterate weekly.

**Verified:**
- Claude Code discovers all four generated skills. Asserted by running the CLI
  headless and reading the skills it reports, which needs no credentials
  because discovery is in the init event, before any API call.
- Upgrade safety: an edited or pre-existing file is never overwritten; the new
  version lands at `<path>.incoming`.

**Found, and it contradicts the plan:**
- Claude Code does **not** read `.agents/skills/`. The native adapter is
  required, not a convenience, so "everything else rides the generic floor with
  no adapter code" does not hold. Every harness that does not read AGENTS.md
  needs its own directory.

**Still unresolved:**
- Codex discovery is unverified. Files are generated for it; nothing proves
  they are read. The nightly says so rather than claiming a pass.
- The kill criterion fires in the same week this milestone ships, so it still
  has no data to fire on.
- The npm package name is `sdd-agentic-os` and unpublished. Nothing has been
  released.

---

## Token rules, in payoff order
1. Triage small work out entirely — the only rule with benchmark support
2. Never mutate always-loaded files mid-session; volatile state in `state.md`
3. Task cards with symbol anchors, never whole-spec loading (ADR 002:
   line anchors were rejected — they break on any edit above them)
4. No MCP server; scripts via shell
5. Cheap model for search/format/decompose, not for requirements on brownfield code
