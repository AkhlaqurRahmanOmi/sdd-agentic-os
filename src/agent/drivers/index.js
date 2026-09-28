// Driver registry and resolution.
//
// Resolution order, most specific first: an explicit --driver flag, the
// SDD_AGENT_DRIVER environment variable, `agent.driver` in .sdd/config.yaml,
// then claude-code. The same order applies to the binary.

import { claudeCode } from './claude-code.js';
import { codex } from './codex.js';
import { detectDriver } from './detect.js';
import { makeGenericDriver } from './generic.js';

export const DRIVER_NAMES = ['claude-code', 'codex', 'generic'];

// Explicit beats configured beats detected. Detection only says which harness
// happens to be running sdd; a repository that has decided which agent it
// targets has said something stronger than that.
export function resolveDriver({ name, config = {}, env = process.env } = {}) {
  const detected = detectDriver(env);
  // "auto" and an empty value both mean "fall through to detection".
  const configured = config.agent?.driver;
  const fromConfig = configured && configured !== 'auto' ? configured : null;

  const chosen =
    name ?? env.SDD_AGENT_DRIVER ?? fromConfig ?? detected?.driver ?? 'claude-code';

  if (chosen === 'claude-code') return claudeCode;
  if (chosen === 'codex') return codex;
  if (chosen === 'generic') return makeGenericDriver({ argsTemplate: config.agent?.args ?? null });

  throw new Error(
    `unknown agent driver "${chosen}" — known: ${DRIVER_NAMES.join(', ')}.\n` +
      'A harness with no driver of its own runs under "generic", which works ' +
      'for\nspec generation but reports no token usage.',
  );
}

export function resolveBin({ driver, config = {}, env = process.env }) {
  // `agent.bin` belongs to whichever driver `agent.driver` names. Switching
  // driver with --driver must not keep the other one's binary: that produced
  // `codex` running as `claude --json`, which fails in a way that reads like
  // the driver being wrong rather than the binary.
  const configuredDriver = config.agent?.driver;
  // An empty bin means "use the driver's default", and a bin configured
  // alongside a different driver is not this driver's business.
  const configBin =
    config.agent?.bin && (!configuredDriver || configuredDriver === 'auto' || configuredDriver === driver.name)
      ? config.agent.bin
      : null;
  const claudeBin = driver.name === 'claude-code' ? env.SDD_CLAUDE_BIN : null;

  const bin = env.SDD_AGENT_BIN ?? claudeBin ?? configBin ?? driver.defaultBin;
  if (!bin) {
    throw new Error(
      `the "${driver.name}" driver has no default binary — set agent.bin in ` +
        '.sdd/config.yaml or SDD_AGENT_BIN',
    );
  }
  return bin;
}
