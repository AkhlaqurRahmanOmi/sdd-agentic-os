import assert from 'node:assert/strict';
import test from 'node:test';
import { describeDetection, detectDriver } from '../src/agent/drivers/detect.js';
import { resolveBin, resolveDriver } from '../src/agent/drivers/index.js';

test('a Claude Code session is detected from its own markers', () => {
  assert.equal(detectDriver({ CLAUDECODE: '1' }).driver, 'claude-code');
  assert.equal(detectDriver({ CLAUDE_CODE_ENTRYPOINT: 'cli' }).driver, 'claude-code');
});

test('a Codex sandbox is detected from its own markers', () => {
  assert.equal(detectDriver({ CODEX_SANDBOX: 'seatbelt' }).driver, 'codex');
  assert.equal(detectDriver({ CODEX_SANDBOX_NETWORK_DISABLED: '1' }).driver, 'codex');
});

test('an unrecognised environment detects nothing rather than guessing', () => {
  assert.equal(detectDriver({ PATH: '/usr/bin' }), null);
});

test('nested harnesses are reported as ambiguous, not resolved by coin flip', () => {
  const d = detectDriver({ CLAUDECODE: '1', CODEX_SANDBOX: '1' });
  assert.equal(d.driver, null);
  assert.deepEqual(d.ambiguous.sort(), ['claude-code', 'codex']);
  assert.match(describeDetection(d), /ambiguous/);
});

test('detection picks the driver when nothing is configured', () => {
  assert.equal(resolveDriver({ env: { CODEX_SANDBOX: '1' } }).name, 'codex');
});

test('"auto" in config means detect, it does not pin claude-code', () => {
  const config = { agent: { driver: 'auto' } };
  assert.equal(resolveDriver({ config, env: { CODEX_SANDBOX: '1' } }).name, 'codex');
});

test('a configured driver outranks detection', () => {
  const config = { agent: { driver: 'generic', bin: 'x' } };
  assert.equal(resolveDriver({ config, env: { CLAUDECODE: '1' } }).name, 'generic');
});

test('an explicit --driver outranks both', () => {
  const config = { agent: { driver: 'generic', bin: 'x' } };
  assert.equal(
    resolveDriver({ name: 'claude-code', config, env: { CODEX_SANDBOX: '1' } }).name,
    'claude-code',
  );
});

test('with nothing configured and nothing detected, claude-code is the default', () => {
  assert.equal(resolveDriver({ env: {} }).name, 'claude-code');
});

test('a detected driver uses its own binary, not one left in config', () => {
  // `sdd init` writes an empty bin; a stale one must not follow the detection.
  const config = { agent: { driver: 'auto', bin: '' } };
  const driver = resolveDriver({ config, env: { CODEX_SANDBOX: '1' } });
  assert.equal(resolveBin({ driver, config, env: {} }), 'codex');
});

test('an explicit bin alongside auto still applies', () => {
  const config = { agent: { driver: 'auto', bin: '/opt/my-claude' } };
  const driver = resolveDriver({ config, env: { CLAUDECODE: '1' } });
  assert.equal(resolveBin({ driver, config, env: {} }), '/opt/my-claude');
});
