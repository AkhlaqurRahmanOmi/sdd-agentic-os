// Writers for the files `sdd tasks` produces. Kept separate from the prompts
// so the on-disk format is decided here, by code, rather than by whatever the
// model felt like emitting.

export function renderTaskCard(task) {
  const list = (items) => items.map((i) => `- ${i}`).join('\n');
  return `# ${task.id} — ${task.goal}

REQ: ${task.reqs.join(', ')}

## Requirement
${task.requirement_text.trim()}

## Files
${list(task.files)}

## Test
${task.test.trim()}

## Done when
${list(task.done_when)}
`;
}

export function renderTasksIndex(changeId, tasks) {
  return `# Tasks: ${changeId}

${tasks.map((t) => `- [ ] ${t.id} — ${t.goal}`).join('\n')}
`;
}

// One section per requirement, empty. validate fails until each is filled, so
// the skeleton is what turns "the agent forgot" into a failing check rather
// than a silent omission.
export function renderEvidenceSkeleton(changeId, reqIds) {
  return `# Evidence: ${changeId}

<!-- One entry per requirement. Each test entry records the command, the test
     it ran, and the exit status, so a later phase can re-run it rather than
     trusting this file:

     ## REQ-AREA-001
     - test: npm test -- auth
       node: test/auth.test.js > rejects invalid credentials
       exit: 0
-->

${reqIds.map((id) => `## ${id}\n`).join('\n')}`;
}

// state.md is the volatile file. It exists so nothing else has to be mutated
// mid-session: the always-loaded files stay byte-identical and keep their
// cached prefix.
export function renderState(changeId, phase) {
  return `# State: ${changeId}

Volatile. Rewrite this freely during a session; never edit requirements.md,
tasks/ or constitution.md mid-session — they are cached prefix.

## Phase
${phase}

## Done
-

## Decisions
-

## Next
-
`;
}
