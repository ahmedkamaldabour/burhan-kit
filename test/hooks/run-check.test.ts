import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers.js';
import { runCheck, checkShell } from '../../src/hooks/core/run-check.mjs';

const posix = process.platform !== 'win32';
const dir = () => tmpDir('burhan-run-');
const secs = (t0: bigint) => Number(process.hrtime.bigint() - t0) / 1e9;

test('pass: exit 0', async () => {
  assert.deepEqual(await runCheck('exit 0', dir(), 10, process.env), { kind: 'pass', code: 0, output: '' });
});
test('fail: the exit code and the output (stdout and stderr, in order)', async () => {
  const r = await runCheck('echo out; echo err >&2; exit 3', dir(), 10, process.env);
  assert.equal(r.kind, 'fail');
  assert.equal(r.code, 3);
  assert.match(r.output, /out\r?\n.*err/s);
});
test('runs in the project directory', async () => {
  const d = dir(); writeFileSync(join(d, 'marker'), '');
  assert.equal((await runCheck(posix ? 'test -f marker' : 'if exist marker (exit 0) else (exit 1)', d, 10, process.env)).kind, 'pass');
});
test('a missing project directory -> exit 1, like `cd` failing', async () => {
  assert.deepEqual(await runCheck('exit 0', join(dir(), 'gone'), 10, process.env), { kind: 'fail', code: 1, output: '' });
});
test('the environment is passed unchanged (the user\'s locale)', { skip: !posix }, async () => {
  const r = await runCheck('echo "LC=[${LC_ALL-unset}]"; exit 1', dir(), 10, { ...process.env, LC_ALL: 'C' });
  assert.match(r.output, /LC=\[C\]/);
  const env = { ...process.env }; delete env.LC_ALL;
  assert.match((await runCheck('echo "LC=[${LC_ALL-unset}]"; exit 1', dir(), 10, env)).output, /LC=\[unset\]/);
});
test('timeout: a slow check is stopped and reported as timed out', async () => {
  const t0 = process.hrtime.bigint();
  const r = await runCheck(posix ? 'sleep 5' : 'ping -n 6 127.0.0.1 >nul', dir(), 1, process.env);
  assert.equal(r.kind, 'timeout');
  assert.ok(secs(t0) < 4, `took ${secs(t0)} s`);
});
test('timeout: a check that ignores TERM is killed 2 s later', { skip: !posix }, async () => {
  const t0 = process.hrtime.bigint();
  const r = await runCheck('trap "" TERM; sleep 8', dir(), 1, process.env);
  assert.equal(r.kind, 'timeout');
  assert.ok(secs(t0) < 6, `took ${secs(t0)} s`);
});
test('a background child keeping stdout open does not hang the hook', { skip: !posix }, async () => {
  const t0 = process.hrtime.bigint();
  const r = await runCheck('(sleep 6 &); true', dir(), 2, process.env);
  assert.equal(r.kind, 'pass');
  assert.ok(secs(t0) < 5, `took ${secs(t0)} s`);
});
test('exit 124 or 137 from the check itself reads as a timeout (timeout(1) semantics)', { skip: !posix }, async () => {
  assert.equal((await runCheck('exit 124', dir(), 10, process.env)).kind, 'timeout');
  assert.equal((await runCheck('exit 137', dir(), 10, process.env)).kind, 'timeout');
});
test('output keeps the first 4000 bytes', { skip: !posix }, async () => {
  const r = await runCheck('head -c 6000 /dev/zero | tr "\\0" Q; exit 1', dir(), 10, process.env);
  assert.equal(r.output.length, 4000);
});
test('shell (D4): bash when found on PATH; else sh / cmd.exe; never WSL\'s System32 bash', () => {
  assert.deepEqual(checkShell('linux', ['/usr/bin/bash']), ['/usr/bin/bash', ['-c']]);
  assert.deepEqual(checkShell('linux', []), ['sh', ['-c']]);
  assert.deepEqual(checkShell('win32', ['C:\\Program Files\\Git\\bin\\bash.exe']), ['C:\\Program Files\\Git\\bin\\bash.exe', ['-c']]);
  assert.deepEqual(checkShell('win32', ['C:\\Windows\\System32\\bash.exe']), ['cmd.exe', ['/d', '/s', '/c']]);
  assert.deepEqual(checkShell('win32', []), ['cmd.exe', ['/d', '/s', '/c']]);
});
test('WF_CHECK_TIMEOUT=0 means no limit (GNU timeout 0)', { skip: !posix }, async () => {
  assert.equal((await runCheck('sleep 1; exit 0', dir(), 0, process.env)).kind, 'pass');
});
test('a huge WF_CHECK_TIMEOUT does not overflow the timer (no 1 ms timeout, no warning)', async () => {
  assert.equal((await runCheck('exit 0', dir(), 9999999999, process.env)).kind, 'pass');
});
test('$0 inside the check is the bare shell name, as with `bash -c`', { skip: !posix }, async () => {
  assert.match((await runCheck('echo "zero=[$0]"; exit 1', dir(), 10, process.env)).output, /zero=\[(bash|sh)\]/);
});
test('timeout: the whole process group is stopped — a grandchild does not survive', { skip: !posix }, async () => {
  const d = dir();
  const r = await runCheck('sleep 30 & echo $! > gc.pid; wait', d, 1, process.env);
  assert.equal(r.kind, 'timeout');
  const pid = Number(readFileSync(join(d, 'gc.pid'), 'utf8'));
  await new Promise((res) => setTimeout(res, 300));
  assert.throws(() => process.kill(pid, 0), /ESRCH/, `grandchild ${pid} still alive`);
});
