import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const helperUrl = new URL('./helpers.js', import.meta.url).href;

function childCreatesTwoTmpDirs(throws: boolean) {
  const script = [
    `import { existsSync } from 'node:fs';`,
    `import { tmpDir } from ${JSON.stringify(helperUrl)};`,
    "const dirs = [tmpDir('burhan-helper-'), tmpDir('burhan-helper-')];",
    'console.log(JSON.stringify({ dirs, exist: dirs.map(existsSync) }));',
    ...(throws ? ["throw new Error('expected child failure');"] : []),
  ].join('\n');
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' });
}

function childResult(stdout: string): { dirs: string[]; exist: boolean[] } {
  return JSON.parse(stdout) as { dirs: string[]; exist: boolean[] };
}

test('tmpDir removes every registered directory when its process exits normally', () => {
  const result = childCreatesTwoTmpDirs(false);
  assert.equal(result.status, 0, result.stderr);
  const { dirs, exist } = childResult(result.stdout);
  assert.deepEqual(exist, [true, true]);
  for (const dir of dirs) assert.equal(existsSync(dir), false, dir);
});

test('tmpDir removes every registered directory when its process throws', () => {
  const result = childCreatesTwoTmpDirs(true);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /expected child failure/);
  const { dirs, exist } = childResult(result.stdout);
  assert.deepEqual(exist, [true, true]);
  for (const dir of dirs) assert.equal(existsSync(dir), false, dir);
});

test('three migrated test files leave no temp directory behind', () => {
  // A private TMPDIR: other test files running at the same time cannot change the count.
  // Without NODE_TEST_CONTEXT: node --test skips files when it sees it is inside another test run.
  const own = mkdtempSync(join(tmpdir(), 'burhan-helpers-count-'));
  try {
    const files = ['fs-safe.test.js', 'stats.test.js', 'status.test.js'].map((file) => fileURLToPath(new URL(`./${file}`, import.meta.url)));
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), TMPDIR: own };
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ℹ pass [1-9]/, 'the three files really ran');
    assert.deepEqual(readdirSync(own), []);
  } finally {
    rmSync(own, { recursive: true, force: true });
  }
});
