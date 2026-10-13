import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packageRoot } from '../src/lib/kit.js';
import { tmpDir } from './helpers.js';

type JobsFor = (input: { freeBytes: number; cpus: number; env: NodeJS.ProcessEnv }) => number;

type Proc = { pid: number; kill: (pid: number, signal: string) => void; exit: (code: number) => void };
type Finish = (code: number | null, signal: string | null, proc: Proc) => void;

async function loadRunner(): Promise<{ jobsFor: JobsFor; finish: Finish }> {
  const script = join(packageRoot(), 'scripts', 'test-node.mjs');
  return import(pathToFileURL(script).href) as Promise<{ jobsFor: JobsFor; finish: Finish }>;
}

function fakeProc(): { proc: Proc; calls: string[] } {
  const calls: string[] = [];
  return { calls, proc: { pid: 42, kill: (pid, signal) => { calls.push(`kill ${pid} ${signal}`); }, exit: (code) => { calls.push(`exit ${code}`); } } };
}

test('finish passes the child exit code through', async () => {
  const { finish } = await loadRunner();
  const { proc, calls } = fakeProc();
  finish(3, null, proc);
  assert.deepEqual(calls, ['exit 3']);
});

test('finish re-raises the signal that stopped the child (review I-1)', async () => {
  const { finish } = await loadRunner();
  const { proc, calls } = fakeProc();
  finish(null, 'SIGTERM', proc);
  assert.deepEqual(calls, ['kill 42 SIGTERM']);
});

test('jobsFor clamps a low free-memory result to one job', async () => {
  const { jobsFor } = await loadRunner();
  assert.equal(jobsFor({ freeBytes: 128 * 1024 * 1024, cpus: 8, env: {} }), 1);
});

test('jobsFor uses the memory formula within the CPU limit', async () => {
  const { jobsFor } = await loadRunner();
  assert.equal(jobsFor({ freeBytes: 6 * 1024 * 1024 * 1024, cpus: 16, env: {} }), 12);
});

test('jobsFor clamps a high free-memory result to one less than the CPU count', async () => {
  const { jobsFor } = await loadRunner();
  assert.equal(jobsFor({ freeBytes: 12 * 256 * 1024 * 1024, cpus: 4, env: {} }), 3);
});

test('jobsFor keeps one job available on a one-CPU machine', async () => {
  const { jobsFor } = await loadRunner();
  assert.equal(jobsFor({ freeBytes: 12 * 256 * 1024 * 1024, cpus: 1, env: {} }), 1);
});

test('jobsFor lets BURHAN_TEST_JOBS override the memory calculation', async () => {
  const { jobsFor } = await loadRunner();
  assert.equal(jobsFor({ freeBytes: 128 * 1024 * 1024, cpus: 8, env: { BURHAN_TEST_JOBS: '2' } }), 2);
});

for (const value of ['0', 'x', '-1']) {
  test(`jobsFor rejects invalid BURHAN_TEST_JOBS=${JSON.stringify(value)}`, async () => {
    const { jobsFor } = await loadRunner();
    assert.throws(
      () => jobsFor({ freeBytes: 128 * 1024 * 1024, cpus: 8, env: { BURHAN_TEST_JOBS: value } }),
      /BURHAN_TEST_JOBS/,
    );
  });
}

test('the runner reports and fails for a failing test file', () => {
  const dir = tmpDir('burhan-test-node-');
  const failingFile = join(dir, 'planned-failure.test.js');
  writeFileSync(failingFile, "import test from 'node:test';\ntest('planned failure', () => { throw new Error('planned failure'); });\n");

  const result = spawnSync(process.execPath, [join(packageRoot(), 'scripts', 'test-node.mjs'), failingFile], {
    encoding: 'utf8',
    // Without NODE_TEST_CONTEXT: node --test skips files when it sees it is inside another test run.
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), BURHAN_TEST_JOBS: '1' },
  });

  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stdout + result.stderr, /planned-failure\.test\.js/);
  assert.match(result.stdout + result.stderr, /node tests: \d+ at a time/);
});
