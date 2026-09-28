import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { changeDir, taskCardsDir } from '../src/spec/paths.js';

export const scratch = (prefix = 'sdd-') => mkdtemp(path.join(tmpdir(), prefix));

export const sink = () => ({
  chunks: [],
  write(c) { this.chunks.push(c); },
  get text() { return this.chunks.join(''); },
});

// A change that validate should accept, so tests can break exactly one thing.
export async function writeValidChange(root, id = 'REV-1') {
  await mkdir(taskCardsDir(id, root), { recursive: true });
  const write = (file, body) => writeFile(path.join(changeDir(id, root), file), body, 'utf8');

  await write(
    'requirements.md',
    `# Requirements: ${id}

## REQ-AUTH-001
When a user submits invalid credentials, the system shall return 401 without
indicating which field was wrong.

## REQ-AUTH-002
While a session is expired, the system shall reject requests with 401.
`,
  );
  await write('tasks.md', `# Tasks: ${id}\n\n- [ ] T01 — Reject invalid credentials\n- [ ] T02 — Reject expired sessions\n`);
  await writeFile(
    path.join(taskCardsDir(id, root), 'T01.md'),
    `# T01 — Reject invalid credentials

REQ: REQ-AUTH-001

## Requirement
When a user submits invalid credentials, the system shall return 401 without
indicating which field was wrong.

## Files
- src/auth/login.js

## Test
npm test -- auth

## Done when
- Invalid password returns 401 with a generic message.
`,
    'utf8',
  );
  await writeFile(
    path.join(taskCardsDir(id, root), 'T02.md'),
    `# T02 — Reject expired sessions

REQ: REQ-AUTH-002

## Requirement
While a session is expired, the system shall reject requests with 401.

## Files
- src/auth/session.js

## Test
npm test -- session

## Done when
- An expired session returns 401.
`,
    'utf8',
  );
  await write(
    'evidence.md',
    `# Evidence: ${id}

## REQ-AUTH-001
- test: npm test -- auth
  node: test/auth.test.js > rejects invalid credentials
  exit: 0

## REQ-AUTH-002
- test: npm test -- session
  node: test/session.test.js > rejects expired sessions
  exit: 0
`,
  );
  return id;
}
