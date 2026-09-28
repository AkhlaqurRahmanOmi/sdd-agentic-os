// The generated agent-facing files.
//
// AGENTS.md is pointers only. It is loaded on every run by every harness that
// reads it, so anything that could live in a skill file — loaded on demand —
// does not belong here. The plan's 150-line ceiling is enforced by a test.

export const SKILLS = [
  {
    name: 'sdd-triage',
    description:
      'Classify a ticket as tiny, small, feature or arch before doing any work. Use at the start of every ticket.',
    body: `Run triage before anything else on a new ticket.

\`\`\`sh
sdd triage --ticket <file> --id <change-id>
\`\`\`

**tiny** and **small** stop here. The command prints acceptance criteria; work
from those directly. Do not write requirements, do not create a change
directory, do not run \`sdd propose\`. Most tickets are this class, and skipping
the spec for them is where the savings come from.

**feature** and **arch** scaffold \`.sdd/changes/<id>/\` and continue to
\`sdd propose\`.

If a ticket classed tiny or small turns out to be larger once you are in the
code, stop and re-run triage rather than improvising a spec. The thresholds in
\`.sdd/config.yaml\` are guesses until real tickets correct them.`,
  },
  {
    name: 'sdd-propose',
    description:
      'Write EARS requirements for a feature or arch ticket. Use after triage returns feature or arch.',
    body: `\`\`\`sh
sdd propose --id <change-id>
\`\`\`

Writes \`.sdd/changes/<id>/requirements.md\` in EARS form and lists open
questions.

**This is the human gate.** Stop after this command and let a person read the
requirements. Every later step copies these requirements verbatim into task
cards, so a wrong one propagates into everything downstream and is far more
expensive to find there.

Do not answer the open questions yourself. They exist because the ticket did
not say, and guessing defeats the gate.`,
  },
  {
    name: 'sdd-tasks',
    description:
      'Decompose approved requirements into self-contained task cards. Use after a human has reviewed requirements.md.',
    body: `\`\`\`sh
sdd tasks --id <change-id>
\`\`\`

Writes one card per task to \`.sdd/changes/<id>/tasks/\`. Each card inlines its
requirement text, so when you work a task, **read the card and nothing else**.
Never load \`requirements.md\` alongside a card — the card already contains
what it needs, and loading both is the cost this whole layer exists to avoid.

The command refuses to run while open questions are unanswered. That is not a
bug to work around with \`--force\`: a guess made here is copied into every
card.

Cards name target symbols, not line numbers. Keep it that way when you edit
one — line numbers go stale on the next commit above them and break
\`sdd index check\`.`,
  },
  {
    name: 'sdd-evidence',
    description:
      'Record test evidence for a requirement so validate passes. Use after making a requirement pass.',
    body: `Every requirement needs an entry in \`.sdd/changes/<id>/evidence.md\` or
\`sdd validate\` fails and the pre-commit hook blocks the commit.

\`\`\`markdown
## REQ-AUTH-001
- test: npm test -- auth
  node: test/auth.test.js > rejects invalid credentials
  exit: 0
\`\`\`

Record the command you actually ran and the exit status it actually returned.
An entry with a non-zero exit fails validate, which is the point — do not
record a passing status for a test you did not see pass.

Then:

\`\`\`sh
sdd validate --change <id>
sdd index build    # if task cards changed
\`\`\``,
  },
];

export function renderSkill(skill) {
  return `---
name: ${skill.name}
description: ${skill.description}
---

${skill.body}
`;
}

export function renderAgentsMd() {
  return `# Agent instructions

Spec-driven development is enforced here by \`sdd\`. The checks below run in a
pre-commit hook and in CI, so skipping them fails the build rather than going
unnoticed.

## Before starting a ticket

Run \`sdd triage --ticket <file> --id <change-id>\` first.

Tiny and small tickets stop at triage and are worked directly from the
acceptance criteria it prints. Do not write a spec for them.

## For feature and arch tickets

1. \`sdd propose --id <id>\` — EARS requirements. **Stop here for human review.**
2. \`sdd tasks --id <id>\` — self-contained task cards.
3. Work one card at a time. The card inlines its requirement; do not also load
   \`requirements.md\`.
4. Record evidence in \`evidence.md\` as each requirement passes.
5. \`sdd validate --change <id>\` and \`sdd index build\`.

## Rules that will fail your commit

- A requirement with no evidence in \`evidence.md\`.
- A task card that maps to no requirement, or to one that does not exist.
- A requirement no task covers.
- A card with no test command or no done-when.
- A task card pointing at a symbol that no longer exists in the file.
- A change costing more tokens than its recorded ceiling.

## Files you must not edit mid-session

\`.sdd/constitution.md\`, \`requirements.md\` and the task cards are cached
prefix. Rewriting them mid-session invalidates the cache on every subsequent
run. Put working state in \`.sdd/changes/<id>/state.md\`, which exists for
exactly that.

## Detail

Skills in \`.agents/skills/\` (and \`.claude/skills/\` for Claude Code) carry the
per-command detail. They load on demand; this file does not.
`;
}
