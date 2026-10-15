import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { bashesOnPath } from '../src/hooks/core/run-check.mjs';

// The Windows "no-bash" CI jobs set BURHAN_EXPECT_NO_BASH=1 after removing bash and jq from PATH. This test
// is the proof that the run really had neither, so a green suite there means the Node hooks need nothing
// else. Everywhere else it is skipped.
const skip = process.env.BURHAN_EXPECT_NO_BASH === '1' ? false : 'BURHAN_EXPECT_NO_BASH is not set (only the no-bash CI jobs set it)';

// WSL's launcher (C:\Windows\System32\bash.exe) cannot be taken off PATH and is never used by the hooks
// (run-check ignores it), so it does not count as a reachable bash.
const usable = (path: string): boolean => !/\\windows\\system32\\/i.test(path);

test('no usable bash is on PATH', { skip }, () => {
  assert.deepEqual(bashesOnPath(process.env).filter(usable), []);
});

// The git-bash job mirrors the tripwire: if the runner image ever drops Git Bash, that job would silently become a
// second no-bash job, so it fails instead.
test('a usable bash is on PATH', { skip: process.env.BURHAN_EXPECT_BASH === '1' ? false : 'BURHAN_EXPECT_BASH is not set (only the git-bash CI job sets it)' }, () => {
  assert.notDeepEqual(bashesOnPath(process.env).filter(usable), []);
});

test('jq is not on PATH', { skip }, () => {
  const r = spawnSync('jq', ['--version'], { encoding: 'utf8' });
  assert.ok(r.error, `jq ran (status ${r.status}); it must not be on PATH in this job`);
  assert.equal((r.error as NodeJS.ErrnoException).code, 'ENOENT');
});
