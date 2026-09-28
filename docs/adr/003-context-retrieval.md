# ADR 003 — Context retrieval and state compaction

**Status:** Proposed. No implementation.
**Date:** 2026-09-28

> Numbering note: this is filed as 003 as requested. ADRs 001 and 002 do not
> exist. Either backfill them for the matched-split and anchor-format decisions
> already made in `docs/milestones.md`, or renumber this to 001.

## Context

Task cards today inline their requirement text and name target symbols. That
makes a card self-contained, which is the point. What it does not do is decide
**what else** an agent should see: which other requirements, which prior
decisions, which slices of which files.

Right now the answer is "nothing", and the agent compensates by reading. Phase 0
will say how much that costs. This ADR proposes what to do if file-reading turns
out to be a top-two token sink — and nothing here should be built before that
number exists.

## Design reference

Park et al., *Generative Agents: Interactive Simulacra of Human Behavior*
(`joonspk-research/generative_agents`, Apache 2.0). **Design reference only.**
No code is imported, no Python dependency is added, and nothing below is a port.
It is a 2023 social-simulation research artifact, not a coding-agent framework;
the two mechanisms below are the only parts that transfer.

### Mechanism 1 — retrieval scoring

`persona/cognitive_modules/retrieve.py`. Every memory node is scored on three
components, each min-max normalised to [0,1] across the candidate pool, then
combined with fixed weights:

```
score = w_recency·recency·0.5 + w_relevance·relevance·3 + w_importance·importance·2
```

- **recency** = `decay ** i` over nodes sorted chronologically — decay by *rank*,
  not wall-clock.
- **importance** = `node.poignancy`, an integer **assigned once when the memory
  is written** and thereafter just read.
- **relevance** = cosine similarity between the focal point's embedding and the
  node's.

The load-bearing idea is the one the paper barely dwells on: **importance is
scored at write time so that retrieval is cheap.** Read-time scoring touches no
model. That inverts directly onto our problem.

(One detail we do *not* take: retrieval updates `last_accessed`, so retrieved
nodes become recent again and self-reinforce. In a social sim that models
rumination. In code retrieval it would pin whatever you looked at last, which
is the opposite of useful.)

### Mechanism 2 — reflection

`persona/cognitive_modules/reflect.py`. Reflection does not run per turn. It
runs when accumulated importance since the last reflection crosses a threshold
(`importance_trigger_curr <= 0`). It then derives focal points from recent
nodes, retrieves against them, synthesises a small number of higher-level
statements **each carrying pointers to the evidence it was drawn from**, and
writes those back as first-class memories with their own importance — so
reflections are themselves retrievable, and reflectable-on.

Two properties transfer: synthesis is periodic rather than continuous, and the
output keeps evidence pointers rather than replacing the record.

## Decision

### 1. Retrieval selects a task card's context pack

At `sdd tasks` time, for each card, score every candidate (a requirement, a
prior decision, or a file) and attach the top *N* as a **context pack** —
written into the card, not into always-loaded context.

```
score(c) = 0.5·recency(c) + 3.0·relevance(c, T) + 1.5·importance(c)
```

with each component min-max normalised to [0,1] across the candidate pool.

**recency(c)** — `0.9 ** rank(c)`, where `rank` is the candidate's position when
sorted by its last-touching commit, most recent first. Rank-based, like the
reference, so a day of heavy commits does not flatten the curve.
Source: `git log -1 --format=%ct -- <path>`. No model call.

**relevance(c, T)** — `0.7·linkage + 0.3·path`, for task card `T`:

- `linkage = 2^-d`, where `d` is the shortest distance in the traceability graph
  (`.sdd/index.json`) between `c` and any of `T`'s requirements. Same REQ `d=0`,
  shares a task `d=1`, and so on.
- `path` — exact target file `1.0`; otherwise `0.5 · 0.5^k` where `k` is the
  number of directory segments separating `c` from the nearest target.

Linkage dominates deliberately. See the finding below.

**importance(c)** — assigned once, 1–10, by `sdd tasks` at decomposition, stored
on the card. `sdd tasks` is already a model call, so this is free; retrieval
then reads an integer. This is the whole transfer from the reference, and the
reason the retriever never calls a model: **an LLM-scored retriever costs more
than the reads it saves.**

### 2. Reflection compacts `state.md` at phase exits

`state.md` is the only file rewritten mid-session. Over a long change it
accumulates raw entries. At **phase exit only** — `triage→propose`,
`propose→tasks`, `tasks→validate` — compact it: many raw entries become fewer
higher-level statements, each keeping pointers to the entries it summarises.

Phase exits are rare (three or four per change), so this may use a model call
where retrieval may not. Never per turn.

Compacted statements carry their own importance and become retrieval candidates,
as in the reference. Raw entries move to `state.archive.md` rather than being
deleted: a compaction that loses the record is not compaction, it is forgetting.

## Worked example

There are **no committed task cards or requirements in this repository**, so
there is no card to run this against directly. Instead: the card is
reconstructed from commit `f0d51d4`, the real change that removed evidence from
the traceability index. Every other input is real — actual `git log` timestamps
and the actual module import graph, which stands in for the REQ graph that does
not exist yet.

**Card:** *Stop `index check` firing on every commit*
**Targets:** `src/spec/traceability.js (buildChangeIndex)`, `src/commands/index-cmd.js`

```
rank file                              score   rec   rel   imp  pathΩ  dist
---- --------------------------------- ------ ----- ----- ----- ----- -----
   1 src/spec/traceability.js           4.675  0.35  1.00  1.00  1.00     0
   2 src/commands/index-cmd.js          4.564  0.50  1.00  0.87  1.00     0
   3 src/spec/parse.js                  2.452  0.08  0.43  0.75  0.50     1
   4 src/commands/validate.js           2.259  0.45  0.43  0.50  0.50     1
   5 src/spec/paths.js                  1.882  0.07  0.43  0.37  0.50     1
   6 src/spec/validate.js               1.650  0.05  0.23  0.62  0.50     2
   ---------------- cut at N=6 ----------------
   7 src/commands/tasks.js              1.339  0.18  0.23  0.37  0.50     2
   8 bin/sdd.js                         1.336  1.00  0.28  0.00  0.06     1
   9 src/commands/cost.js               1.307  0.04  0.43  0.00  0.50     1
```

The top six are the right six. `parse.js` ranks third and holds `parseEvidence`,
the function the fix actually removed a call to — it is the single most useful
file to have in context and nothing about the card's text mentions it. Recency
alone would have ranked it 20th of 28.

## Findings from computing it

**Naive path overlap is degenerate in a flat repository.** The first formula
scored "same directory" identically to "same file". With both targets in
`src/spec/` and `src/commands/` — most of this repo — every candidate scored
`1.00` on relevance and the component contributed nothing. The fix is the
`0.5^k` decay above, and the general lesson is that path proximity is a weak
signal until a repo has real directory depth. Linkage is the signal; path is a
tiebreaker. Had this ADR been written without running the numbers, the
degenerate version would have been proposed.

**Recency is the weakest of the three and may deserve less than 0.5.** At rank 8
sits `bin/sdd.js` with relevance 0.28 and importance 0, carried almost entirely
by being the most recently committed file. In a social simulation recency
predicts what matters next. In code it frequently does not: a file untouched for
a year may be exactly right, and a file touched five times this week may be
churning precisely because nobody understands it. The reference's weights were
tuned for a different problem and should not be inherited on faith.

**Every weight here is a guess.** `[0.5, 3, 1.5]` is the reference's shape with
importance pulled down. Nothing validates it. The cheap validation is Phase 0's
`files_read_paths`: for a recorded run, compare what retrieval would have
selected against what the agent actually opened. Precision and recall against
real reads costs nothing extra to collect and is the only thing that would
justify these numbers.

## Constraints honoured

| Constraint | How |
|---|---|
| No LLM call in scoring | recency from `git log`, linkage from `index.json`, path from string comparison |
| Importance assigned once, by `sdd tasks` | stored on the card at decomposition; retrieval reads an integer |
| Reflection at phase exit only | three or four times per change, never per turn |
| Nothing added to always-loaded context | the pack is written into the card; `AGENTS.md` and `constitution.md` are untouched |

## What would falsify this

- Phase 0 shows file-reading is not a top-two token sink. Then this is solving a
  problem that is not costing anything, and it should be dropped, not deferred.
- Retrieval precision against `files_read_paths` is no better than "every file
  the card already names, plus its direct imports". Then the scoring is
  ceremony around a one-line heuristic, and the one-line heuristic wins.
- Context packs go stale. A pack is computed at decomposition and read later;
  if targets move between the two, the pack points at the past. `sdd index
  check` covers anchors and would need to cover packs too.

## Not decided here

Value of *N*. It should come from measured pack sizes against real cards, not
from a round number chosen now.
