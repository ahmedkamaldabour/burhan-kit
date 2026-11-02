import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { isWritable, putFile, replaceDir, resolveWritePath } from '../src/lib/fs-safe.js';
import { assertInside } from '../src/lib/item-io.js';
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

// Paths are compared through realpathSync.native: on a Windows runner the temp folder may be spelled with a short name (RUNNER~1).
const samePlace = (a: string | null, b: string, msg?: string): void => { assert.ok(a !== null, msg); assert.equal(realpathSync.native(a), realpathSync.native(b), msg); };
const win = process.platform === 'win32';
// A link text is built with sep, not join: join would fold its `..` before the link is made.

test('resolveWritePath takes `..` after a folder link the way the OS does: POSIX in the link target, Windows as text (review I-1, AC-09)', { skip: symlinkSkip }, () => {
  const d = tmp(); const away = tmp();
  mkdirSync(join(away, 'deep'));
  writeFileSync(join(away, 'x.json'), '{}');
  writeFileSync(join(d, 'x.json'), '{}'); // the lexical spot inside the project
  symlinkSync(join(away, 'deep'), join(d, 'evil'));
  mkdirSync(join(d, '.claude'));
  symlinkSync(['..', 'evil', '..', 'x.json'].join(sep), join(d, '.claude', 'settings.json'));
  samePlace(resolveWritePath(join(d, '.claude', 'settings.json')), join(win ? d : away, 'x.json'));
  samePlace(resolveWritePath(join(d, '.claude', 'settings.json')), join(d, '.claude', 'settings.json'), 'the place the OS resolves the link to');
});

test('resolveWritePath: `../ln/../../victim` with ln a folder link inside the project lands where the OS writes (Windows: outside), and assertInside follows it (AC-09)', { skip: symlinkSkip }, () => {
  const d = tmp(); const proj = join(d, 'proj');
  mkdirSync(join(proj, 'a', 'b'), { recursive: true }); mkdirSync(join(proj, '.claude'));
  symlinkSync(join(proj, 'a', 'b'), join(proj, 'ln'));
  symlinkSync(['..', 'ln', '..', '..', 'victim'].join(sep), join(proj, '.claude', 'settings.json'));
  writeFileSync(join(d, 'victim'), ''); writeFileSync(join(proj, 'victim'), ''); // both spots exist, so the OS answer can be read
  const link = join(proj, '.claude', 'settings.json');
  samePlace(resolveWritePath(link), join(win ? d : proj, 'victim'));
  samePlace(resolveWritePath(link), link, 'the place the OS resolves the link to');
  if (win) assert.throws(() => assertInside(proj, link), /leads outside the project/);
  else assert.doesNotThrow(() => assertInside(proj, link));
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

test('resolveWritePath: `..` after a part that does not exist is null on POSIX (the kernel refuses it; the walk must not guess); Windows takes it as text (review C-1, AC-09)', { skip: symlinkSkip }, () => {
  const d = tmp(); const away = tmp();
  mkdirSync(join(d, '.claude'));
  symlinkSync(away, join(d, '.claude', 'evil'));
  symlinkSync(['absent', '..', 'evil', 'x.json'].join(sep), join(d, '.claude', 'settings.json'));
  writeFileSync(join(away, 'x.json'), '');
  if (win) samePlace(resolveWritePath(join(d, '.claude', 'settings.json')), join(away, 'x.json'));
  else assert.equal(resolveWritePath(join(d, '.claude', 'settings.json')), null);
});
