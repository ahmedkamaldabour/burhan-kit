import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchFor, runLaunch } from '../src/lib/verify-run.js';
import { tmpDir } from './helpers.js';

const WIN = { Path: 'C:\\tools;C:\\nodejs', PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: 'C:\\Windows\\system32\\cmd.exe' };
const only = (...files: string[]) => (p: string): boolean => files.includes(p);

test('on Linux and macOS the command and its arguments are started as given, with no shell', () => {
  for (const platform of ['linux', 'darwin'] as const) {
    assert.deepEqual(launchFor(['npm', 'test', 'a b'], { platform, env: {}, cwd: '/p' }), { file: 'npm', args: ['test', 'a b'], verbatim: false });
  }
});

test('on Windows a bare name is found on PATH with PATHEXT, and a program file is started directly', () => {
  const l = launchFor(['node', '-e', 'process.exit(0)'], { platform: 'win32', env: WIN, cwd: 'C:\\p', isFile: only('C:\\nodejs\\node.exe') });
  assert.deepEqual(l, { file: 'C:\\nodejs\\node.exe', args: ['-e', 'process.exit(0)'], verbatim: false });
});

test('on Windows a .cmd file runs through cmd.exe with every part quoted', () => {
  const l = launchFor(['npm', 'run', 'test suite'], { platform: 'win32', env: WIN, cwd: 'C:\\p', isFile: only('C:\\nodejs\\npm.cmd') });
  assert.deepEqual(l, { file: 'C:\\Windows\\system32\\cmd.exe', args: ['/d', '/s', '/c', '""C:\\nodejs\\npm.cmd" "run" "test suite""'], verbatim: true });
});

test('on Windows an argument cmd.exe would read is refused for a .cmd file, not escaped', () => {
  for (const bad of ['a&b', 'a|b', 'a<b', 'a>b', 'a^b', '%PATH%', 'a"b', '(x)', 'a!b', 'a\nb']) {
    assert.throws(() => launchFor(['npm', 'test', bad], { platform: 'win32', env: WIN, cwd: 'C:\\p', isFile: only('C:\\nodejs\\npm.cmd') }), /refuses the argument/, bad);
  }
  // the same argument is fine for a program file: no cmd.exe reads it
  assert.equal(launchFor(['node', 'a&b'], { platform: 'win32', env: WIN, cwd: 'C:\\p', isFile: only('C:\\nodejs\\node.exe') }).verbatim, false);
});

test('on Windows a name that is not found is returned as given, a path is resolved from the folder, and the environment names are read in any case', () => {
  assert.deepEqual(launchFor(['nope'], { platform: 'win32', env: WIN, cwd: 'C:\\p', isFile: only() }), { file: 'nope', args: [], verbatim: false });
  assert.equal(launchFor(['bin\\run.cmd'], { platform: 'win32', env: WIN, cwd: 'C:\\p', isFile: only('C:\\p\\bin\\run.cmd') }).args[3], '""C:\\p\\bin\\run.cmd""');
  const lower = { path: 'C:\\nodejs', pathext: '.EXE;.CMD', comspec: 'D:\\cmd.exe' };
  assert.equal(launchFor(['npm'], { platform: 'win32', env: lower, cwd: 'C:\\p', isFile: only('C:\\nodejs\\npm.cmd') }).file, 'D:\\cmd.exe');
});

test('an empty command is refused', () => {
  assert.throws(() => launchFor([], { platform: 'linux', env: {}, cwd: '/p' }), /needs a command/);
  assert.throws(() => launchFor([''], { platform: 'win32', env: WIN, cwd: 'C:\\p' }), /needs a command/);
});

test('a real run: exit 0 is ok, another exit is failed, a program that does not exist did not start', () => {
  const cwd = tmpDir('burhan-run-');
  const run = (argv: string[]) => runLaunch(launchFor(argv, { platform: process.platform, env: process.env, cwd }), cwd);
  assert.deepEqual(run([process.execPath, '-e', 'process.exit(0)']), { exit: 0, status: 'ok' });
  assert.deepEqual(run([process.execPath, '-e', 'process.exit(3)']), { exit: 3, status: 'failed' });
  const missing = run(['burhan-no-such-program-xyz']);
  assert.equal(missing.status, 'not-started');
  assert.equal(missing.exit, null);
});

test('on Windows a real .cmd file runs through cmd.exe, with its exit code and a quoted argument', { skip: process.platform === 'win32' ? false : 'a .cmd file runs only on Windows' }, () => {
  const cwd = tmpDir('burhan-cmd-');
  writeFileSync(join(cwd, 'four.cmd'), '@exit /b 4\r\n');
  writeFileSync(join(cwd, 'same.cmd'), '@if "%~1"=="hello world" (exit /b 0) else (exit /b 5)\r\n');
  const run = (argv: string[]) => runLaunch(launchFor(argv, { platform: 'win32', env: process.env, cwd }), cwd);
  assert.deepEqual(run([join(cwd, 'four.cmd')]), { exit: 4, status: 'failed' });
  assert.deepEqual(run([join(cwd, 'same.cmd'), 'hello world']), { exit: 0, status: 'ok' });
});
