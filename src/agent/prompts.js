// The prompts are the product. Each one states the shape of the answer and
// the constraint that makes the phase worth running at all.

export const TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    class: { type: 'string', enum: ['tiny', 'small', 'feature', 'arch'] },
    reason: { type: 'string' },
    acceptance_criteria: { type: 'array', items: { type: 'string' } },
    area: { type: 'string' },
  },
  required: ['class', 'reason', 'acceptance_criteria', 'area'],
  additionalProperties: false,
};

export function triagePrompt(ticket, config) {
  return `Classify this ticket by how much specification work it needs.

tiny   One obvious edit. No ambiguity about what "done" means.
small  One or two files, under ~${config.triage.small_max_lines} lines changed. The approach is not in question.
feature  Behaviour that needs stating before it is built, or more than ~${config.triage.small_max_files} files.
arch   Changes a boundary, a schema, or a contract other code depends on.

Classifying down is the expensive mistake. A ticket marked tiny or small skips
specification entirely, so if you are between two classes, choose the larger.

For tiny and small, write acceptance criteria concrete enough to work from
without any further specification — that is the whole output for those classes.
For feature and arch, leave acceptance_criteria empty; the propose step handles
them.

"area" is a short uppercase token naming the part of the system this touches
(AUTH, BILLING, SEARCH). It becomes the REQ id prefix.

Ticket:
${ticket}`;
}

export function proposePrompt(ticket, area, constitution) {
  return `Write the requirements for this ticket.

Output GitHub-flavoured Markdown, exactly this shape and nothing else:

# Requirements: <ticket title>

## REQ-${area}-001
<one requirement in EARS form>

## REQ-${area}-002
<...>

## Open Questions
- <anything you had to assume>

Rules:

- EARS form. Every requirement contains "shall" and starts with its trigger:
  "When <trigger>, the system shall ...", "While <state>, the system shall ...",
  "If <condition>, then the system shall ...", "Where <feature>, the system
  shall ...", or an unconditional "The system shall ...".
- One testable claim per requirement. If you cannot describe the test, it is
  not a requirement yet — it is an open question.
- Number sequentially from 001. Do not skip numbers.
- State what must be true, never how to build it. No file names, no function
  names, no implementation.
- Put every assumption in Open Questions. An empty Open Questions section on a
  ticket that left you guessing is worse than no requirements, because the
  human gate after this step is the only place those guesses get caught.
${constitution ? `\nConstraints that hold for every change here:\n\n${constitution}\n` : ''}
Ticket:
${ticket}`;
}

export const TASKS_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          goal: { type: 'string' },
          reqs: { type: 'array', items: { type: 'string' } },
          requirement_text: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          test: { type: 'string' },
          done_when: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'goal', 'reqs', 'requirement_text', 'files', 'test', 'done_when'],
        additionalProperties: false,
      },
    },
  },
  required: ['tasks'],
  additionalProperties: false,
};

export function tasksPrompt(requirementsMarkdown, testCommandHint) {
  return `Decompose these requirements into task cards.

Each card is worked by an agent that will see the card and nothing else — not
these requirements, not the other cards. So each card must stand alone:

- "id": T01, T02, ... sequential, two digits.
- "goal": one line, imperative.
- "reqs": the REQ ids this task satisfies, exactly as written below.
- "requirement_text": the full text of those requirements, copied verbatim.
  This is what makes the card self-contained; do not paraphrase or summarise it.
- "files": the files to change. Name the symbol (function, class, export) rather
  than a line number where you can — line numbers go stale on the next commit
  above them.
- "test": the single command that proves this task is done${testCommandHint ? `, e.g. \`${testCommandHint}\`` : ''}.
- "done_when": concrete, checkable conditions. Not "works correctly".

Every requirement below must be covered by at least one task, and every task
must name at least one requirement. Prefer fewer, larger tasks: a card that
exists only to hand off to the next card costs more than it saves.

Requirements:
${requirementsMarkdown}`;
}
