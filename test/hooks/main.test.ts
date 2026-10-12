import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { packageRoot } from '../../src/lib/kit.js';
import { run } from '../../src/hooks/main.mjs';

const entry = join(packageRoot(), '.test-build/src/hooks/main.mjs');
const sh = (args: string[], input: string, env: NodeJS.ProcessEnv = {}) =>
  spawnSync(process.execPath, [entry, ...args], { input, encoding: 'utf8', env: { ...process.env, ...env } });

test('fail open: garbage, a non-object, unknown part or check -> exit 0, no output', () => {
  for (const [args, input] of [[['core', 'session-gates'], 'nope'], [['core', 'session-gates'], '[1,2]'], [['core', 'session-gates'], ''],
    [['core', 'no-such-check'], '{}'], [['nope', 'x'], '{}'], [[], '{}']] as [string[], string][]) {
    const r = sh(args, input);
    assert.equal(r.status, 0, `${args.join(' ')} <<< ${input}`);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, '');
  }
});
test('fail open: a check that throws -> no output; the error is kept for WF_HOOK_DEBUG', async () => {
  const boom = { core: { boom: () => { throw new Error('deliberate'); } } };
  const r = await run(['core', 'boom'], '{"event":"x"}', {}, boom);
  assert.equal(r.stdout, '');
  assert.match(r.debug, /deliberate/);
});
test('the entry prints the debug text on stderr only with WF_HOOK_DEBUG=1', () => {
  const bad = sh(['core', 'session-gates'], '{"event":"session_start","project_dir":"/nonexistent-\u0000"}');
  assert.deepEqual([bad.status, bad.stderr], [0, '']);
});
test('run() returns the output text without exiting', async () => {
  assert.deepEqual(await run(['core', 'no-such-check'], '{}', process.env), { stdout: '', debug: '' });
});
