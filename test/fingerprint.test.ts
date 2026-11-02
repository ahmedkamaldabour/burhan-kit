import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { codeState } from '../src/lib/fingerprint.js';
import { tmpDir } from './helpers.js';

const git = (dir: string, ...args: string[]): void => { spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir }); };
function repo(files: Record<string, string>, init = true): string {
  const dir = tmpDir('burhan-fp-');
  if (init) git(dir, 'init', '-q');
  for (const [f, text] of Object.entries(files)) { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), text); }
  return dir;
}

test('the same files give the same code state, whatever the commit', () => {
  const dir = repo({ 'src/a.ts': 'a', 'README.md': 'r' });
  const first = codeState(dir, []);
  assert.match(first.value ?? '', /^fp1:[0-9a-f]{64}$/);
  assert.equal(first.files, 2);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'one');
  assert.equal(codeState(dir, []).value, first.value);
});

test('a changed, new or deleted file changes the code state; putting the bytes back restores it', () => {
  const dir = repo({ 'src/a.ts': 'a' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'one');
  const first = codeState(dir, []).value;
  writeFileSync(join(dir, 'src/a.ts'), 'b');
  assert.notEqual(codeState(dir, []).value, first);
  writeFileSync(join(dir, 'src/a.ts'), 'a');
  assert.equal(codeState(dir, []).value, first);
  writeFileSync(join(dir, 'src/new.ts'), 'n');
  assert.notEqual(codeState(dir, []).value, first);
  rmSync(join(dir, 'src/new.ts'));
  rmSync(join(dir, 'src/a.ts'));
  const gone = codeState(dir, []);
  assert.notEqual(gone.value, first);
  assert.equal(gone.files, 1, 'a tracked file that is gone is still listed, as deleted');
});

test('an ignored file and an excluded folder or file do not change the code state', () => {
  const dir = repo({ 'src/a.ts': 'a', '.gitignore': 'dist/\n', 'docs/work/x.md': 'w', '.burhan/local/PROGRESS.md': 's' });
  const exclude = ['docs/work', '.burhan/local/PROGRESS.md'];
  const first = codeState(dir, exclude);
  assert.equal(first.files, 2, '.gitignore and src/a.ts');
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'dist/b.js'), 'built');
  writeFileSync(join(dir, 'docs/work/x.md'), 'changed');
  writeFileSync(join(dir, 'docs/work/y-verify.jsonl'), '{}\n');
  writeFileSync(join(dir, '.burhan/local/PROGRESS.md'), 'changed');
  assert.equal(codeState(dir, exclude).value, first.value);
});

test('an excluded folder is matched as a folder, not as a name prefix', () => {
  const dir = repo({ 'docs/work/x.md': 'w', 'docs/workshop.md': 'a' });
  const first = codeState(dir, ['docs/work']);
  assert.equal(first.files, 1);
  writeFileSync(join(dir, 'docs/workshop.md'), 'b');
  assert.notEqual(codeState(dir, ['docs/work']).value, first.value);
});

test('outside a git checkout there is no code state, and it says why', () => {
  const s = codeState(repo({ 'src/a.ts': 'a' }, false), []);
  assert.equal(s.value, null);
  assert.equal(s.files, 0);
  assert.match(s.why ?? '', /not a git checkout/);
});
