import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posix, win32 } from 'node:path';
import { linkTextWith, resolveWritePath, type WalkSys } from '../src/lib/fs-safe.js';

/** A filesystem in a map: `links` maps a path to its link text; every other path under `absent` does not exist, the rest are plain. */
function fake(path: typeof win32 | typeof posix, links: Record<string, string>, absent: string[] = []): WalkSys {
  return {
    path,
    win32: path === win32,
    linkText: (p) => {
      if (absent.some((a) => p === a || p.startsWith(a + path.sep))) return undefined;
      return links[p] ?? null;
    },
  };
}

test('Windows: `..` in a link text is taken as text, after the link\'s folder (the measured case: a write that stays inside)', () => {
  const links = { 'C:\\p\\.claude\\settings.json': '..\\evil\\..\\x.json', 'C:\\p\\evil': 'D:\\away\\deep' };
  assert.equal(resolveWritePath('C:\\p\\.claude\\settings.json', fake(win32, links)), 'C:\\p\\x.json');
});

test('Windows: the derived case lands outside, where the POSIX walk lands inside (the miss this item closes)', () => {
  const links = { 'C:\\p\\.claude\\settings.json': '..\\ln\\..\\..\\victim', 'C:\\p\\ln': 'C:\\p\\a\\b' };
  assert.equal(resolveWritePath('C:\\p\\.claude\\settings.json', fake(win32, links)), 'C:\\victim');
  const plinks = { '/p/.claude/settings.json': '../ln/../../victim', '/p/ln': '/p/a/b' };
  assert.equal(resolveWritePath('/p/.claude/settings.json', fake(posix, plinks)), '/p/victim');
});

test('Windows: a link text with forward slashes, an absolute one on another drive, a chain, and a loop', () => {
  assert.equal(resolveWritePath('C:\\p\\a.json', fake(win32, { 'C:\\p\\a.json': '../q/b.json' })), 'C:\\q\\b.json');
  assert.equal(resolveWritePath('C:\\p\\a.json', fake(win32, { 'C:\\p\\a.json': 'D:\\x\\a.json' })), 'D:\\x\\a.json');
  assert.equal(resolveWritePath('C:\\p\\one', fake(win32, { 'C:\\p\\one': 'two', 'C:\\p\\two': 'dir\\three', 'C:\\p\\dir': 'C:\\real' })), 'C:\\real\\three');
  assert.equal(resolveWritePath('C:\\p\\a', fake(win32, { 'C:\\p\\a': 'b', 'C:\\p\\b': 'a' })), null);
});

test('Windows: a missing part keeps the rest under it, and `..` after it in a link text is taken as text (no null)', () => {
  const sys = fake(win32, { 'C:\\p\\.claude\\settings.json': 'absent\\..\\evil\\x.json', 'C:\\p\\.claude\\evil': 'D:\\away' }, ['C:\\p\\.claude\\absent']);
  assert.equal(resolveWritePath('C:\\p\\.claude\\settings.json', sys), 'D:\\away\\x.json');
  assert.equal(resolveWritePath('C:\\p\\new\\x.json', fake(win32, {}, ['C:\\p\\new'])), 'C:\\p\\new\\x.json');
});

test('POSIX through the same seam: unchanged (`..` after a folder link is taken in the link target; after a missing part it is null)', () => {
  const sys = fake(posix, { '/p/.claude/settings.json': '../evil/../x.json', '/p/evil': '/away/deep' });
  assert.equal(resolveWritePath('/p/.claude/settings.json', sys), '/away/x.json');
  const gone = fake(posix, { '/p/.claude/settings.json': 'absent/../evil/x.json', '/p/.claude/evil': '/away' }, ['/p/.claude/absent']);
  assert.equal(resolveWritePath('/p/.claude/settings.json', gone), null);
});

test('the native link reader: not there is undefined, a plain path is null, and a readlink that fails throws (never taken as absent) (Deviation 2)', () => {
  const plain = { isSymbolicLink: () => false };
  const link = { isSymbolicLink: () => true };
  const gone = (): never => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
  assert.equal(linkTextWith(gone, () => 'x')('/p/a'), undefined);
  assert.equal(linkTextWith(() => plain, () => 'x')('/p/a'), null);
  assert.equal(linkTextWith(() => link, () => 'b')('/p/a'), 'b');
  assert.throws(() => linkTextWith(() => link, () => { throw Object.assign(new Error('EIO: readlink failed'), { code: 'EIO' }); })('/p/a'), /EIO/);
});
