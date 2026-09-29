// Parsers for the .sdd/changes/<id>/ files.
//
// The format is plain Markdown on purpose: an agent writes these files and a
// human reads them in a diff, so anything that needs a tool to read would be
// the wrong shape. Parsing is therefore deliberately shallow — headings and
// a small number of labelled lines, nothing that depends on Markdown nuance.

export const REQ_ID = /^REQ-[A-Z][A-Z0-9]*-\d{3}$/;
export const TASK_ID = /^T\d{2,}$/;

// EARS requirements are recognisable by "shall"; the trigger keyword tells you
// which EARS pattern was used. Neither is a hard requirement at parse time —
// validate decides what is fatal.
const EARS_TRIGGERS = ['when', 'while', 'if', 'where', 'the'];

function sections(markdown, depth = 2) {
  const marker = `${'#'.repeat(depth)} `;
  const out = [];
  let current = null;
  markdown.split('\n').forEach((line, i) => {
    if (line.startsWith(marker)) {
      if (current) out.push(current);
      current = { heading: line.slice(marker.length).trim(), line: i + 1, body: [] };
    } else if (current) {
      current.body.push(line);
    }
  });
  if (current) out.push(current);
  return out.map((s) => ({ ...s, body: s.body.join('\n').trim() }));
}

export function parseRequirements(markdown) {
  const requirements = [];
  const openQuestions = [];

  for (const section of sections(markdown)) {
    // Anything not headed by a REQ id is prose — a Decisions section, notes,
    // a glossary. Treating every heading as a requirement made real specs
    // fail validation for containing paragraphs. A heading that *starts*
    // REQ is still taken as an attempted requirement, so a malformed id is
    // reported rather than silently skipped.
    // An id attempt is a heading that starts REQ in any casing, or is a bare
    // upper-case token like AUTH-1. Prose headings ("Decisions", "Resolved
    // Questions") are neither, so they are skipped without hiding a typo'd id.
    const looksLikeRequirement =
      /^REQ/i.test(section.heading) || /^[A-Z0-9][A-Z0-9_-]*$/.test(section.heading);
    if (/^open questions$/i.test(section.heading)) {
      openQuestions.push(
        ...section.body
          .split('\n')
          .map((l) => l.replace(/^[-*]\s*/, '').trim())
          .filter(Boolean),
      );
      continue;
    }
    if (!looksLikeRequirement) continue;

    const text = section.body;
    const firstWord = text.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
    requirements.push({
      id: section.heading,
      line: section.line,
      text,
      hasShall: /\bshall\b/i.test(text),
      hasEarsTrigger: EARS_TRIGGERS.includes(firstWord),
    });
  }
  return { requirements, openQuestions };
}

// A task card inlines the requirement text so the agent working the task never
// loads the whole spec. `REQ:` is the only structural line validate depends on.
export function parseTaskCard(markdown) {
  const heading = markdown.match(/^#\s+(\S+)\s*(?:[—-]\s*(.*))?$/m);
  const reqLine = markdown.match(/^REQ:\s*(.+)$/m);
  const reqs = reqLine
    ? reqLine[1].split(',').map((r) => r.trim()).filter(Boolean)
    : [];
  const body = Object.fromEntries(
    sections(markdown).map((s) => [s.heading.toLowerCase(), s.body]),
  );
  return {
    id: heading?.[1] ?? null,
    goal: heading?.[2]?.trim() ?? '',
    reqs,
    files: (body.files ?? '')
      .split('\n')
      .map((l) => l.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean),
    test: (body.test ?? '').replace(/^```\w*\n?|```$/gm, '').trim(),
    doneWhen: (body['done when'] ?? '')
      .split('\n')
      .map((l) => l.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean),
  };
}

export function parseTasksIndex(markdown) {
  const entries = [];
  for (const line of markdown.split('\n')) {
    const m = line.match(/^\s*[-*]\s*\[([ xX])\]\s*(T\d{2,})\b\s*(?:[—-]\s*(.*))?$/);
    if (m) entries.push({ id: m[2], done: m[1].toLowerCase() === 'x', goal: (m[3] ?? '').trim() });
  }
  return entries;
}

// Evidence is one section per REQ. Each entry records the command that ran and
// the exit status it reported, so a later phase can re-execute it rather than
// trusting the text.
export function parseEvidence(markdown) {
  const byReq = new Map();
  for (const section of sections(markdown)) {
    const entries = [];
    let current = null;
    for (const raw of section.body.split('\n')) {
      const line = raw.trim();
      const start = line.match(/^[-*]\s*(\w+):\s*(.*)$/);
      if (start) {
        if (current) entries.push(current);
        current = { kind: start[1].toLowerCase(), detail: start[2].trim(), fields: {} };
        continue;
      }
      const field = line.match(/^(\w+):\s*(.*)$/);
      if (field && current) current.fields[field[1].toLowerCase()] = field[2].trim();
    }
    if (current) entries.push(current);
    byReq.set(section.heading, entries);
  }
  return byReq;
}

// Deliberately an approximation, and reported as one. A real tokenizer would
// mean a dependency and a network call for a budget that only needs to catch
// a constitution that has grown by a third.
export function approxTokens(text) {
  return Math.ceil(text.length / 4);
}
