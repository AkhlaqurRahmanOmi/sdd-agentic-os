# sdd

Spec-driven development harness. See [docs/milestones.md](docs/milestones.md)
for the phase plan.

Commands: `sdd init`, `sdd install`, `sdd triage`, `sdd propose`, `sdd tasks`,
`sdd validate`, `sdd index`, `sdd budget`, `sdd hooks`, `sdd cost`.

There is no design phase, no archive and no subagents, deliberately. They go in
when a real ticket makes their absence painful, not before.

## Install

No dependencies, no build step. Node 22+.

```
npm link          # or: node bin/sdd.js ...
npm test
```

## `sdd init`

Creates `.sdd/config.yaml` and `.sdd/constitution.md`. Neither is overwritten
if it already exists.

## The change pipeline

```sh
sdd triage --ticket ticket.md --id AUTH-9   # cheap model: tiny|small|feature|arch
sdd propose --id AUTH-9                     # EARS requirements  <- human gate
sdd tasks   --id AUTH-9                     # self-contained task cards
sdd validate --change AUTH-9
```

**triage** runs on the cheap model and is the only token rule in the plan with
benchmark support behind it. `tiny` and `small` exit there with acceptance
criteria and never touch the rest of the system — no change directory is
created. The prompt tells the model that classifying down is the expensive
mistake, because a misclassified feature skips everything silently.

**propose** writes `requirements.md` in EARS form and reports open questions,
then opens the review gate as `pending`. It refuses to overwrite requirements
that already exist, since a re-propose discards whatever a human reviewed.

**The gate has a way past it.** `sdd approve --id <id>` records that a human
read the requirements. When nobody is available — which on a side project is
most of the time — `sdd tasks --id <id> --bypass-gate "<reason>"` proceeds
anyway and writes down that it did. A gate with no escape hatch gets routed
around, and then there is no gate *and* no record that there wasn't one.

A bypass never looks like approval afterwards: `sdd validate` reports
`gate-bypassed` with the reason, and `sdd validate --strict` makes it an
error. That way a repository can enforce review in CI without blocking the
work at 2am. Approving later clears the bypass.

**tasks** writes one card per task. Each card inlines its requirement text
verbatim, so the agent working it loads the card and nothing else — never the
whole spec. It refuses to decompose while open questions are unanswered:
a guess made here is copied into every card, where it costs far more to find
than in one reviewed file. `--force` overrides.

Cards name target symbols rather than line numbers. Line anchors go stale on
the next commit above them; that is the Phase 2 index decision made early.

### Triage misses

A ticket classed tiny or small skips the whole system, so a wrong call leaves
no trace. After the change lands:

```sh
sdd triage audit --id <id> [--range <git-range>]
sdd triage audit rate
```

compares the decision against the diff it actually produced and records the
result in `.sdd/triage.jsonl`.

**A miss warns, it never fails.** By the time the diff can be measured the work
is done; failing there would only teach people to skip triage. The point is the
dataset — `small_max_files` and `small_max_lines` are guesses until real
tickets correct them, and `rate` reports the largest miss, which is what
actually bounds a threshold.

Each phase routes to its own model via `.sdd/config.yaml` — cheap for triage
and decomposition, not for requirements on brownfield code.

`state.md` is the only file rewritten mid-session. `requirements.md`, the task
cards and `constitution.md` stay byte-identical so their cached prefix holds.

## `sdd validate`

```sh
sdd validate [--change <id>]
```

Exits 1 if any change under `.sdd/changes/` fails. Checks that every
requirement has evidence, every task maps to a requirement that exists, every
requirement is covered by a task, the task index and the task cards agree, and
the constitution is within budget.

Warnings do not fail: a requirement not in EARS form, an unanswered open
question, a card with no target files.

### `--execute`

```sh
sdd validate --execute
```

Runs the commands `evidence.md` records instead of trusting the exit status it
claims. A claim that disagrees with reality is `evidence-mismatch`, which is
the finding the flag exists for: without it, an agent that writes `exit: 0`
beside a failing test passes.

Commands shared by several requirements run once.

**It is opt-in, and deliberately not what the hook runs.** These commands come
from a markdown file inside the repository, so executing them is arbitrary
shell execution from repository content. CI already runs repository-supplied
code, so `--execute` belongs there; a pre-commit hook does not, so
`--execute --staged` is refused rather than quietly allowed.

Execution is skipped when the shape checks already failed — running a suite to
discover that a REQ id is malformed wastes the slowest part of the check.

**Without `--execute`,** evidence is written by the same agent that wrote the
requirement, so a pass means the paperwork is internally consistent, not that
the code is correct. The output says so, and says how to upgrade.

## Enforcement

```sh
sdd hooks install     # pre-commit: validates only the changes this commit touches
sdd index build       # REQ -> tasks -> code anchors, committed as .sdd/index.json
sdd index check       # exits 1 when an anchor no longer resolves
sdd budget set --change <id>   # record this change's token ceiling
sdd budget check      # exits 1 when a change costs more than its ceiling
```

`.github/workflows/sdd.yml` runs all of these. The hook and CI differ
deliberately: the hook validates only what the commit touches, so work in
flight on another change does not block it, and CI validates everything, so a
change abandoned half-specified still fails.

### The index, and what it is honest about

Anchors are **file + symbol**, never line ranges. A line range breaks on any
edit above it, including a reformat, and a check that cries wolf gets
`--no-verify`'d within a week.

Symbol presence is a word-boundary search, not a parse. So: a deleted or
renamed symbol fails, code moving within a file does not, and a symbol
surviving only inside a comment or a string passes when it should not. The
alternative is a parser per language. A check that is occasionally too lenient
beats one that is occasionally wrong and gets switched off.

Evidence is deliberately **not** in the index. It changes every time a task
completes, so including it made "index is out of date" fire on nearly every
commit — the same cry-wolf failure by a different route. Evidence lives in
`evidence.md` and `sdd validate` checks it. This was found by running the
Phase 2 gate, not by reading the code.

### The ratchet

A ceiling comes from a recorded run, so `budget check` does nothing until
tickets have actually been measured. `budget set` lowers a ceiling freely and
refuses to raise one without `--raise` — a ceiling that quietly follows the
last run upward is a log, not a budget.

## Which agent runs it

```yaml
# .sdd/config.yaml
agent:
  driver: claude-code     # or: generic
  bin: claude
  args: ''                # generic only, e.g. 'exec --model {model} {prompt}'
```

| Driver | Token usage | Schema-constrained output | Tool allowlist | Verified |
|---|---|---|---|---|
| `claude-code` | yes | yes (`--json-schema`) | yes | yes — `sdd doctor` passes |
| `codex` | yes | yes (`--output-schema`, a file) | no (`--sandbox`) | **no** — see below |
| `generic` | **no** | no — asked for in the prompt, parsed on the way back | no | n/a |

`generic` runs any CLI that takes a prompt and prints text. Where the CLI
cannot constrain output to a schema, the prompt asks for JSON and `sdd`
recovers it from surrounding prose, failing loudly if there is none.

**What `generic` cannot do is measure.** It reports no token counts, so
`sdd cost` records those runs as **unmeasured** — not as zero. A zero would
read as a free run and drag a baseline down, which is the same failure the
no-result-event refusal already guards against. Unmeasured runs are recorded,
excluded from every aggregate, and named in `sdd cost report`. They also
cannot set or breach a budget ceiling.

So: the spec pipeline works with any agent. Phase 0 measurement works only
where the harness reports usage, and today that is Claude Code.

### `sdd doctor`

```sh
sdd doctor --driver codex
```

Runs a trivial prompt against the real CLI and reports which of the
capabilities a driver *declares* actually work. It exists because a driver
written from flags alone can look healthy while reporting nothing: the run
succeeds, usage comes back empty, and `sdd cost` silently under-records.

It costs one small model call. That is the price of knowing.

The `codex` driver is marked **unverified**: its flags and event names were
read out of codex-cli 0.158.0, but no successful run was possible where it was
written, so the nesting of the usage fields is unconfirmed. It therefore
searches the event for those fields rather than hardcoding a path, and
`doctor` says the driver is unverified until a real run passes. Run it once
with working credentials and the flag can come off.

Adding a native driver for another harness is one file in
`src/agent/drivers/`. Probe the real CLI first, then let `doctor` confirm it —
guessed flags produce a driver that silently does nothing, which is worse than
falling back to `generic`.

## Distribution

```sh
npx sdd-agentic-os install            # generic floor + Claude Code
npx sdd-agentic-os install --targets generic,claude,codex
```

Generates `AGENTS.md` (pointers only, under the 150-line budget, enforced by a
test) and one skill per command under `.agents/skills/`, plus a directory per
harness that has one.

`--targets codex` writes **no** skills directory. Codex reads the repository's
`AGENTS.md`; its skills are user-level (`~/.codex/skills`) with no
project-level equivalent, so writing `.codex/skills/` produced files nothing
reads — the same mistake as assuming `.agents/skills/` was a universal floor.

### The adapter is not optional for Claude Code

`.agents/skills/` is the generic floor, but **Claude Code does not read it.**
Running the CLI and reading the skills it reports shows `.claude/skills/`
discovered and `.agents/skills/` absent. So a harness-specific directory is
required, not a convenience — the "everything rides the generic floor with no
adapter code" assumption does not survive contact.

`npm run verify:discovery` asserts this: it installs into a temp project, runs
Claude Code headless, and checks the skills it reports. Claude Code emits its
discovered skills in the init event **before any API call**, so this needs no
credentials and the nightly workflow needs no secrets.

Codex discovery is **not** verified. `AGENTS.md` and `.codex/skills/` are
generated for it, but nothing here proves either is read, and the script says
so rather than reporting a pass it cannot support.

### Upgrades do not clobber edits

Every generated file's SHA-256 is recorded in `.sdd/generated.json`.
On re-install:

| State | What happens |
|---|---|
| Absent | written |
| Unchanged since sdd wrote it | updated in place |
| Edited since sdd wrote it | left alone; new version at `<path>.incoming` |
| Never written by sdd | left alone; new version at `<path>.incoming` |

The last row is the one that matters: a repo with an `AGENTS.md` predating sdd
keeps it.

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
