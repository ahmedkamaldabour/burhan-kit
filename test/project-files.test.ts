import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { countMatches, listProjectFiles, matchLines } from '../src/lib/project-files.js';
import { tmpDir } from './helpers.js';

function repo(files: string[], init = true): string {
  const dir = tmpDir('burhan-files-');
  if (init) spawnSync('git', ['init', '-q'], { cwd: dir });
  for (const f of files) { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), 'x'); }
  return dir;
}

test('listProjectFiles lists tracked and untracked files, not ignored ones, with / separators', () => {
  const dir = repo(['src/a.ts', 'dist/b.js']);
  writeFileSync(join(dir, '.gitignore'), 'dist/\n');
  assert.deepEqual(listProjectFiles(dir)?.sort(), ['.gitignore', 'src/a.ts']);
});

test('listProjectFiles is null outside a git checkout', () => {
  assert.equal(listProjectFiles(repo(['src/a.ts'], false)), null);
});

test('countMatches counts, and is null for a pattern the engine refuses', () => {
  const files = ['src/a.ts', 'src/b.ts', 'test/a.test.ts'];
  assert.equal(countMatches('^src/', files), 2);
  assert.equal(countMatches('\\^src/', files), 0);
  assert.equal(countMatches('(a)\\1', files), null);
});

test('matchLines: a count, the singular, and a zero that says to check', () => {
  const files = ['src/a.ts', 'src/b.ts', 'test/a.test.ts'];
  assert.deepEqual(matchLines(files, { WF_CODE_REGEX: '^src/', WF_TEST_REGEX: '^test/', WF_SENSITIVE_REGEX: '\\^src/', WF_EVIDENCE_REGEX: undefined }), [
    '  WF_CODE_REGEX matches 2 files',
    '  WF_TEST_REGEX matches 1 file',
    '  WF_SENSITIVE_REGEX matches no file in the project — check it (burhan doctor says why)',
  ]);
});
