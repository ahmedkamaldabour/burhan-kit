import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { notOnWindows, tmpDir } from '../helpers.js';
import { runCheck, checkShell, bashesOnPath } from '../../src/hooks/core/run-check.mjs';

// Which command syntax the check runs under: bash syntax (a Unix, or Git Bash on Windows) or cmd.exe. Tests about
// POSIX signals and process groups say why they do not run on Windows; the rest use commands both shells accept.
const posix = checkShell(process.platform, bashesOnPath(process.env))[0] !== 'cmd.exe';
const dir = () => tmpDir('burhan-run-');
const secs = (t0: bigint) => Number(process.hrtime.bigint() - t0) / 1e9;

test('pass: exit 0', async () => {
  assert.deepEqual(await runCheck('exit 0', dir(), 10, process.env), { kind: 'pass', code: 0, output: '' });
});
test('fail: the exit code and the output (stdout and stderr, in order)', async () => {
  const r = await runCheck(posix ? 'echo out; echo err >&2; exit 3' : 'echo out& echo err 1>&2& exit /b 3', dir(), 10, process.env);
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
test('the environment is passed unchanged (the user\'s locale)', { skip: posix ? false : 'the check uses bash variable syntax (cmd.exe has none)' }, async () => {
  const r = await runCheck('echo "LC=[${LC_ALL-unset}]"; exit 1', dir(), 10, { ...process.env, LC_ALL: 'C' });
  assert.match(r.output, /LC=\[C\]/);
  const env = { ...process.env }; delete env.LC_ALL;
  assert.match((await runCheck('echo "LC=[${LC_ALL-unset}]"; exit 1', dir(), 10, env)).output, /LC=\[unset\]/);
});
test('timeout: a slow check is stopped and reported as timed out', async () => {
  const t0 = process.hrtime.bigint();
  // a command that would run 20 s, stopped after 1 s: the bound leaves a wide margin for a slow runner (a Windows run took 4.4 s here once, 1.4 s another time)
  const r = await runCheck(posix ? 'sleep 20' : 'ping -n 21 127.0.0.1 >nul', dir(), 1, process.env);
  assert.equal(r.kind, 'timeout');
  assert.ok(secs(t0) < 10, `took ${secs(t0)} s`);
});
test('timeout: a check that ignores TERM is killed 2 s later', { skip: notOnWindows('POSIX signals: Windows kills the whole tree at once (taskkill), there is no TERM to ignore') }, async () => {
  const t0 = process.hrtime.bigint();
  const r = await runCheck('trap "" TERM; sleep 8', dir(), 1, process.env);
  assert.equal(r.kind, 'timeout');
  assert.ok(secs(t0) < 6, `took ${secs(t0)} s`);
});
test('a background child keeping stdout open does not hang the hook', { skip: notOnWindows('bash background syntax `( cmd &)`, and Windows child processes do not inherit stdout like a Unix fork') }, async () => {
  const t0 = process.hrtime.bigint();
  const r = await runCheck('(sleep 6 &); true', dir(), 2, process.env);
  assert.equal(r.kind, 'pass');
  assert.ok(secs(t0) < 5, `took ${secs(t0)} s`);
});
test('exit 124 or 137 from the check itself reads as a timeout (timeout(1) semantics)', async () => {
  assert.equal((await runCheck('node -e "process.exit(124)"', dir(), 10, process.env)).kind, 'timeout');
  assert.equal((await runCheck('node -e "process.exit(137)"', dir(), 10, process.env)).kind, 'timeout');
});
test('output keeps the first 4000 bytes', async () => {
  const r = await runCheck('node -e "process.stdout.write(\'Q\'.repeat(6000));process.exit(1)"', dir(), 10, process.env);
  assert.equal(r.output.length, 4000);
});
test('shell (D4): bash when found on PATH; else sh / cmd.exe; never WSL\'s System32 bash', () => {
  assert.deepEqual(checkShell('linux', ['/usr/bin/bash']), ['/usr/bin/bash', ['-c']]);
  assert.deepEqual(checkShell('linux', []), ['sh', ['-c']]);
  assert.deepEqual(checkShell('win32', ['C:\\Program Files\\Git\\bin\\bash.exe']), ['C:\\Program Files\\Git\\bin\\bash.exe', ['-c']]);
  assert.deepEqual(checkShell('win32', ['C:\\Windows\\System32\\bash.exe']), ['cmd.exe', ['/d', '/s', '/c']]);
  assert.deepEqual(checkShell('win32', []), ['cmd.exe', ['/d', '/s', '/c']]);
});
test('WF_CHECK_TIMEOUT=0 means no limit (GNU timeout 0)', async () => {
  assert.equal((await runCheck('node -e "setTimeout(function(){},1000)"', dir(), 0, process.env)).kind, 'pass');
});
test('a huge WF_CHECK_TIMEOUT does not overflow the timer (no 1 ms timeout, no warning)', async () => {
  assert.equal((await runCheck('exit 0', dir(), 9999999999, process.env)).kind, 'pass');
});
test('$0 inside the check is the bare shell name, as with `bash -c`', { skip: notOnWindows('Git Bash (MSYS) reports $0 as its full path /usr/bin/bash, and cmd.exe has no $0') }, async () => {
  assert.match((await runCheck('echo "zero=[$0]"; exit 1', dir(), 10, process.env)).output, /zero=\[(bash|sh)\]/);
});
test('timeout: the whole process group is stopped — a grandchild does not survive', { skip: notOnWindows('POSIX process groups and `$!`; the tree-kill test below covers Windows') }, async () => {
  const d = dir();
  const r = await runCheck('sleep 30 & echo $! > gc.pid; wait', d, 1, process.env);
  assert.equal(r.kind, 'timeout');
  const pid = Number(readFileSync(join(d, 'gc.pid'), 'utf8'));
  await new Promise((res) => setTimeout(res, 300));
  assert.throws(() => process.kill(pid, 0), /ESRCH/, `grandchild ${pid} still alive`);
});
test('timeout: the whole process tree is stopped — a grandchild started by the check does not survive', async () => {
  const d = dir();
  // check -> parent.js -> grandchild.js: the grandchild is two levels below the shell, so only a kill of the
  // whole tree (process group, or taskkill /T) reaches it. Script files keep the command text identical under
  // bash and cmd.exe.
  writeFileSync(join(d, 'grandchild.js'), "require('fs').writeFileSync('gc.pid', String(process.pid)); setTimeout(() => {}, 30000);");
  writeFileSync(join(d, 'parent.js'), "require('child_process').spawn(process.execPath, ['grandchild.js'], { stdio: 'ignore' }); setTimeout(() => {}, 30000);");
  const r = await runCheck('node parent.js', d, 5, process.env); // room for a slow runner to start the grandchild
  assert.equal(r.kind, 'timeout');
  const pid = Number(readFileSync(join(d, 'gc.pid'), 'utf8'));
  await new Promise((res) => setTimeout(res, 300));
  assert.throws(() => process.kill(pid, 0), /ESRCH/, `grandchild ${pid} still alive`);
});
// commit-gate-and-check-output SU2: the error of a failing check is at the end of its output, and a hook stopped by
// the agent must not leave the check running.
test('output keeps the LAST 4000 bytes (the error is at the end)', async () => {
  const r = await runCheck('node -e "process.stdout.write(\'A\'.repeat(6000)+\'REAL-ERROR\');process.exit(1)"', dir(), 10, process.env);
  assert.equal(r.output.length, 4000);
  assert.ok(r.output.endsWith('REAL-ERROR'), `ends with ${JSON.stringify(r.output.slice(-20))}`);
});
test('a cut never starts inside a UTF-8 character', async () => {
  // 3000 × 'é' + 'a' = 6001 bytes: the last 4000 start on the second byte of an 'é' (a naive cut decodes it as U+FFFD).
  const r = await runCheck('node -e "process.stdout.write(\'é\'.repeat(3000)+\'a\');process.exit(1)"', dir(), 10, process.env);
  assert.ok(!r.output.includes('\uFFFD'), 'no replacement character');
  assert.ok(r.output.startsWith('é') && r.output.endsWith('éa'));
});
test('the hook stopped by SIGTERM stops the running check too', { skip: notOnWindows('POSIX signals and process groups; Windows has no SIGTERM to forward') }, async () => {
  const d = dir();
  const mod = new URL('../../src/hooks/core/run-check.mjs', import.meta.url).href;
  writeFileSync(join(d, 'hook.mjs'), `import { runCheck } from ${JSON.stringify(mod)}; await runCheck('echo $$ > check.pid; exec sleep 30', process.cwd(), 60, process.env);`);
  const { spawn } = await import('node:child_process');
  const hook = spawn(process.execPath, ['hook.mjs'], { cwd: d, stdio: 'ignore' });
  const pidFile = join(d, 'check.pid');
  for (let i = 0; i < 100; i++) { try { if (readFileSync(pidFile, 'utf8').trim()) break; } catch { /* not yet */ } await new Promise((res) => setTimeout(res, 50)); }
  const pid = Number(readFileSync(pidFile, 'utf8'));
  const alive = (): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    hook.kill('SIGTERM');
    for (let i = 0; i < 60 && alive(); i++) await new Promise((res) => setTimeout(res, 50)); // up to 3 s
    assert.ok(!alive(), `check ${pid} still alive after the hook was stopped`);
  } finally {
    if (alive()) process.kill(pid, 'SIGKILL');
  }
});
