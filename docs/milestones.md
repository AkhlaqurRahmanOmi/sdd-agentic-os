# Milestones

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

**Decided:**
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

**Unresolved:**
- The human gate after `propose` is the real cost center on a side project.
  No timeout, no auto-proceed-with-flagged-assumptions path is specified.
- Misclassified feature-as-small skips the whole system silently. Cheap
  detector: log a triage miss when a "small" ticket's diff exceeds N files
  or M lines.

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

**Decided:**
- Anchors are file + symbol, never line ranges.
- Evidence is not in `index.json`. It changes on every task completion, so
  including it made "index out of date" fire on nearly every commit. Found by
  running the gate.

**Still unresolved:**
- `validate` checks that the agent's `evidence.md` mentions the agent's own
  REQ IDs. That is self-attestation: it fails on a forgotten line, never on
  wrong code. The format records the command and exit status, so executing
  them is additive — but it is not built.
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

**Unresolved:**
- That kill criterion fires in the same week this milestone ships, so it has
  no data to fire on. A crude distribution attempt (clone + install script, one
  other person, no versioning) belongs around week 4 if the criterion is to mean
  anything.
- "Scripts via shell, no MCP server" assumes every target harness can execute
  them. Verify against Codex sandboxing before building the plugin.

---

## Token rules, in payoff order
1. Triage small work out entirely — the only rule with benchmark support
2. Never mutate always-loaded files mid-session; volatile state in `state.md`
3. Task cards with line anchors, never whole-spec loading
4. No MCP server; scripts via shell
5. Cheap model for search/format/decompose, not for requirements on brownfield code
