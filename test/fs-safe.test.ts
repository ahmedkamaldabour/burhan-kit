import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isWritable, putFile, replaceDir } from '../src/lib/fs-safe.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'burhan-fs-'));

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

test('putFile keeps the file mode', () => {
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
