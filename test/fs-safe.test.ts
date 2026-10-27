import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isWritable, putFile, replaceDir, resolveWritePath } from '../src/lib/fs-safe.js';
import { posixOnly, symlinkSkip, tmpDir } from './helpers.js';

const tmp = () => tmpDir('burhan-fs-');

test('putFile creates parents', () => {
  const d = tmp(); putFile(join(d, 'a/b/c.txt'), 'x');
  assert.equal(readFileSync(join(d, 'a/b/c.txt'), 'utf8'), 'x');
});

test('putFile writes through a symlink and keeps it a symlink', () => {
  const d = tmp(); writeFileSync(join(d, 'AGENTS.md'), 'old'); symlinkSync('AGENTS.md', join(d, 'CLAUDE.md'));
  putFile(join(d, 'CLAUDE.md'), 'new');
  assert.ok(lstatSync(join(d, 'CLAUDE.md')).isSymbolicLink());
  assert.equal(readFileSync(join(d, 'AGENTS.md'), 'utf8'), 'new');
});

test('putFile keeps the file mode', { skip: posixOnly }, () => {
  const d = tmp(); const f = join(d, 's.json'); writeFileSync(f, '{}'); chmodSync(f, 0o600);
  putFile(f, '{"a":1}');
  assert.equal(statSync(f).mode & 0o777, 0o600);
});

test('replaceDir removes stale files', () => {
  const d = tmp(); mkdirSync(join(d, 'src')); writeFileSync(join(d, 'src/new'), '1');
  mkdirSync(join(d, 'dst')); writeFileSync(join(d, 'dst/stale'), '0');
  replaceDir(join(d, 'src'), join(d, 'dst'));
  assert.ok(existsSync(join(d, 'dst/new')));
  assert.ok(!existsSync(join(d, 'dst/stale')));
});

test('isWritable', () => {
  const d = tmp(); const f = join(d, 'ro'); writeFileSync(f, 'x'); chmodSync(f, 0o444);
  assert.equal(isWritable(f), process.getuid?.() === 0);
  assert.equal(isWritable(d), true);
});

test('resolveWritePath: where a write to the path would land', { skip: symlinkSkip }, () => {
  const d = tmp(); const away = tmp();
  writeFileSync(join(away, 'real.json'), '{}');
  mkdirSync(join(d, 'dir'));
  symlinkSync(join(away, 'real.json'), join(d, 'dir/file-link.json'));
  symlinkSync(join(away, 'nothing.json'), join(d, 'dir/dangling.json'));
  symlinkSync(away, join(d, 'folder-link'));
  const real = (p: string) => realpathSync(p);
  assert.equal(resolveWritePath(join(d, 'dir/file-link.json')), real(join(away, 'real.json')));
  assert.equal(resolveWritePath(join(d, 'dir/dangling.json')), join(real(away), 'nothing.json'));
  assert.equal(resolveWritePath(join(d, 'folder-link/new.json')), join(real(away), 'new.json'));
  assert.equal(resolveWritePath(join(d, 'dir/absent/x.json')), join(real(d), 'dir/absent/x.json'));
  assert.equal(resolveWritePath(join(d, 'dir')), real(join(d, 'dir')));
});

test('resolveWritePath takes `..` after a folder link in the link target, as the kernel does (review I-1)', { skip: symlinkSkip }, () => {
  const d = tmp(); const away = tmp();
  mkdirSync(join(away, 'deep'));
  writeFileSync(join(away, 'x.json'), '{}');
  writeFileSync(join(d, 'x.json'), '{}'); // the lexical spot inside the project
  symlinkSync(join(away, 'deep'), join(d, 'evil'));
  mkdirSync(join(d, '.claude'));
  symlinkSync('../evil/../x.json', join(d, '.claude/settings.json'));
  assert.equal(resolveWritePath(join(d, '.claude/settings.json')), join(realpathSync(away), 'x.json'));
  assert.equal(realpathSync.native(join(d, '.claude/settings.json')), join(realpathSync.native(away), 'x.json'), 'same as the kernel (Node\'s JS realpathSync takes `..` in the text)');
});

test('resolveWritePath: relative link chains, and a link loop is null', { skip: symlinkSkip }, () => {
  const d = tmp();
  mkdirSync(join(d, 'a')); writeFileSync(join(d, 'a/real.json'), '{}');
  symlinkSync('real.json', join(d, 'a/one.json'));
  symlinkSync('a/one.json', join(d, 'two.json'));
  assert.equal(resolveWritePath(join(d, 'two.json')), realpathSync(join(d, 'a/real.json')));
  symlinkSync('loop-b', join(d, 'loop-a')); symlinkSync('loop-a', join(d, 'loop-b'));
  assert.equal(resolveWritePath(join(d, 'loop-a')), null);
});

test('resolveWritePath: `..` after a part that does not exist is null (the kernel refuses it; the walk must not guess) (review C-1)', { skip: symlinkSkip }, () => {
  const d = tmp(); const away = tmp();
  mkdirSync(join(d, '.claude'));
  symlinkSync(away, join(d, '.claude/evil'));
  symlinkSync('absent/../evil/x.json', join(d, '.claude/settings.json'));
  assert.equal(resolveWritePath(join(d, '.claude/settings.json')), null);
});
