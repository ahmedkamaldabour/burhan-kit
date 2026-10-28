import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpDir } from './helpers.js';

// Tests run from .test-build/test, so the repository root is two levels up.
const script = fileURLToPath(new URL('../../scripts/measure-artifacts.mjs', import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
const put = (root: string, rel: string, text: string): void => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text); };

test('a file is counted in words, bytes and an estimated token count (bytes / 4, rounded up)', () => {
  const root = tmpDir('burhan-measure-');
  put(root, 'a.md', 'one two  three\nfour'); // 4 words, 19 bytes
  const r = run('--root', root, '--file', 'a.md');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\| a\.md \| 4 \| 19 \| 5 \|/);
  assert.match(r.stdout, /estimate/i, 'the token column is labelled as an estimate');
});

test('bytes are UTF-8 bytes, not characters', () => {
  const root = tmpDir('burhan-measure-');
  const text = 'مرحبا بالعالم\n';
  put(root, 'ar.md', text);
  const r = run('--root', root, '--file', 'ar.md');
  assert.match(r.stdout, new RegExp(`\\| ar\\.md \\| 2 \\| ${Buffer.byteLength(text, 'utf8')} \\|`));
});

test('--set adds the counts of several files into one labelled row', () => {
  const root = tmpDir('burhan-measure-');
  put(root, 'a.md', 'one two\n');
  put(root, 'b.md', 'three\n');
  const r = run('--root', root, '--set', 'stage=a.md,b.md');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\| stage \(sum of 2 files\) \| 3 \| 14 \| 4 \|/);
});

test('a missing file is named and the exit code is 1, never a silent zero row', () => {
  const root = tmpDir('burhan-measure-');
  const r = run('--root', root, '--file', 'nope.md');
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /nope\.md.*missing/);
});

test('--sections lists the words of each "## " section and how many of them are in table rows', () => {
  const root = tmpDir('burhan-measure-');
  put(root, 'r.md', '# T\nintro words\n## First\nalpha beta\n| x | y |\n|---|---|\n| one | two |\n## Second\ngamma\n');
  const r = run('--root', root, '--sections', 'r.md');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\| First \| 13 \| 11 \|/); // alpha beta (2) + `| x | y |` (5) + `|---|---|` (1) + `| one | two |` (5); the 11 are the table rows
  assert.match(r.stdout, /\| Second \| 1 \| 0 \|/);
});

test('a 200,000-character line is counted without delay', () => {
  const root = tmpDir('burhan-measure-');
  put(root, 'long.md', 'x'.repeat(200000) + '\n');
  const started = Date.now();
  const r = run('--root', root, '--file', 'long.md');
  assert.match(r.stdout, /\| long\.md \| 1 \| 200001 \| 50001 \|/);
  assert.ok(Date.now() - started < 5000);
});
