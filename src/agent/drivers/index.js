// Driver registry and resolution.
//
// Resolution order, most specific first: an explicit --driver flag, the
// SDD_AGENT_DRIVER environment variable, `agent.driver` in .sdd/config.yaml,
// then claude-code. The same order applies to the binary.

import { claudeCode } from './claude-code.js';
import { makeGenericDriver } from './generic.js';

export const DRIVER_NAMES = ['claude-code', 'generic'];

export function resolveDriver({ name, config = {}, env = process.env } = {}) {
  const chosen = name ?? env.SDD_AGENT_DRIVER ?? config.agent?.driver ?? 'claude-code';

  if (chosen === 'claude-code') return claudeCode;
  if (chosen === 'generic') return makeGenericDriver({ argsTemplate: config.agent?.args ?? null });

  throw new Error(
    `unknown agent driver "${chosen}" — known: ${DRIVER_NAMES.join(', ')}.\n` +
      'A harness with no driver of its own runs under "generic", which works ' +
      'for\nspec generation but reports no token usage.',
  );
}

export function resolveBin({ driver, config = {}, env = process.env }) {
  const bin = env.SDD_CLAUDE_BIN ?? env.SDD_AGENT_BIN ?? config.agent?.bin ?? driver.defaultBin;
  if (!bin) {
    throw new Error(
      `the "${driver.name}" driver has no default binary — set agent.bin in ` +
        '.sdd/config.yaml or SDD_AGENT_BIN',
    );
  }
  return bin;
}
