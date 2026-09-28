// Detects which harness is running sdd right now.
//
// An agent CLI that shells out to `sdd` sets its own environment variables in
// the child process, so the harness identifies itself without being asked.
// The markers below were read out of the tools themselves, not assumed:
// CLAUDECODE / CLAUDE_CODE_ENTRYPOINT are present in a Claude Code session,
// and CODEX_SANDBOX / CODEX_SANDBOX_NETWORK_DISABLED appear in the codex
// binary as the variables it sets for sandboxed commands.
//
// What detection answers is "which harness invoked sdd", and sdd then assumes
// you want to spawn the same one for propose and tasks. That is usually right
// and not always, which is why configuration outranks it.

export const MARKERS = [
  { driver: 'claude-code', vars: ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'] },
  { driver: 'codex', vars: ['CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED'] },
];

export function detectDriver(env = process.env) {
  const matches = MARKERS.filter(({ vars }) => vars.some((v) => env[v] !== undefined)).map(
    ({ driver, vars }) => ({
      driver,
      via: vars.filter((v) => env[v] !== undefined),
    }),
  );

  if (matches.length === 1) return matches[0];

  // Nested harnesses — one agent driving another — leave both sets of markers
  // in the environment and there is no way to tell which is the parent. Saying
  // so and falling back beats picking one and being quietly wrong.
  if (matches.length > 1) {
    return { driver: null, ambiguous: matches.map((m) => m.driver) };
  }
  return null;
}

export function describeDetection(detected) {
  if (!detected) return 'no harness detected from the environment';
  if (detected.ambiguous) {
    return `ambiguous: markers for ${detected.ambiguous.join(' and ')} are both set`;
  }
  return `${detected.driver} (from ${detected.via.join(', ')})`;
}
