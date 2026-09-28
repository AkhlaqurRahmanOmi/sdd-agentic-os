// Driver for any CLI that takes a prompt and prints text.
//
// It declares `usage: false`, and that is the whole point of it existing
// separately rather than pretending. A harness that does not report token
// counts cannot be measured, so `sdd cost` records these runs as UNMEASURED
// rather than as zero — recording zero would read as a free run and quietly
// drag a baseline down, which is the same failure the no-result-event refusal
// already guards against.
//
// Spec generation works here. Phase 0 measurement does not, and says so.

// `{prompt}` and `{model}` are substituted; everything else is passed through.
// Quoting is deliberately not supported: an arg template that tries to parse
// shell quoting gets it subtly wrong, so each argument is a separate list
// entry and the prompt is never split.
export function buildArgsFromTemplate(template, { prompt, model }) {
  if (!template) return [prompt];
  const parts = template.split(/\s+/).filter(Boolean);
  const args = [];
  for (const part of parts) {
    if (part === '{prompt}') args.push(prompt);
    else if (part === '{model}') {
      if (model) args.push(model);
    } else args.push(part.replaceAll('{model}', model ?? ''));
  }
  // A template that never mentions the prompt would silently send an empty
  // request, so append it rather than letting that happen.
  if (!parts.includes('{prompt}')) args.push(prompt);
  return args;
}

export function makeGenericDriver({ argsTemplate = null } = {}) {
  return {
    name: 'generic',
    defaultBin: null,
    capabilities: { usage: false, schema: false, allowedTools: false },

    buildArgs({ prompt, model }) {
      return buildArgsFromTemplate(argsTemplate, { prompt, model });
    },

    createParser() {
      const lines = [];
      return {
        handleLine(line) {
          lines.push(line);
        },
        result() {
          return {
            text: lines.join('\n').trim(),
            usage: null,
            measured: false,
            ok: true, // the exit code is the only signal; the caller applies it
            terminalReason: null,
          };
        },
      };
    },
  };
}

export const generic = makeGenericDriver();
