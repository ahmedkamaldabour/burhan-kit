import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BurhanError } from '../src/lib/errors.js';
import { editStateFile, ReplaceFailed, withLock } from '../src/lib/state-write.js';
import { project, STATE } from './item-fixture.js';
import { posixOnly, symlinkSkip, tmpDir } from './helpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'src', 'cli.js');
const ROOT = join(HERE, '..', '..');
const names = (dir: string): string[] => readdirSync(dir).sort();
const isRoot = process.platform !== 'win32' && process.getuid?.() === 0;
const appendX = (text: string): string => `${text}x\n`;

function scratch(content: string | Buffer = 'a\nb\n'): { dir: string; file: string } {
  const dir = tmpDir('burhan-sw-');
  const file = join(dir, 'PROGRESS.md');
  writeFileSync(file, content);
  return { dir, file };
}

/** One burhan process in `cwd`, started now; resolves when it ends. */
const run = (cwd: string, args: string[]): Promise<{ code: number; out: string; err: string }> => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [CLI, ...args], { cwd });
  let out = ''; let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.on('error', reject);
  child.on('close', (code) => resolve({ code: code ?? -1, out, err }));
});

test('a refused rename leaves the old bytes and no temp file or lock', () => {
  const { dir, file } = scratch();
  const rename = (): void => { throw Object.assign(new Error('boom'), { code: 'EIO' }); };
  assert.throws(() => editStateFile(file, appendX, { rename }), (e: unknown) => e instanceof ReplaceFailed && /could not replace PROGRESS\.md \(EIO\): the old file is unchanged/.test(e.message));
  assert.equal(readFileSync(file, 'utf8'), 'a\nb\n');
  assert.deepEqual(names(dir), ['PROGRESS.md']);
});

test('a rename that is refused for a moment (EPERM) is tried again', () => {
  const { dir, file } = scratch();
  let tries = 0;
  const rename = (from: string, to: string): void => { if (++tries < 3) throw Object.assign(new Error('busy'), { code: 'EPERM' }); renameSync(from, to); };
  assert.equal(editStateFile(file, appendX, { rename }), 'written');
  assert.equal(tries, 3);
  assert.equal(readFileSync(file, 'utf8'), 'a\nb\nx\n');
  assert.deepEqual(names(dir), ['PROGRESS.md']);
});

test('an old lock is taken over', () => {
  const { dir, file } = scratch();
  const lock = `${file}.lock`;
  writeFileSync(lock, '1 1 dead\n');
  const old = Date.now() / 1000 - 60;
  utimesSync(lock, old, old);
  assert.equal(editStateFile(file, appendX), 'written');
  assert.equal(readFileSync(file, 'utf8'), 'a\nb\nx\n');
  assert.deepEqual(names(dir), ['PROGRESS.md']);
});

test('a fresh lock makes the writer refuse after the wait, naming the lock file', () => {
  const { dir, file } = scratch();
  const lock = join(realpathSync(dir), 'PROGRESS.md.lock');
  writeFileSync(lock, '1 1 live\n');
  const started = Date.now();
  assert.throws(() => editStateFile(file, appendX, { waitMs: 150 }), (e: unknown) => e instanceof BurhanError && e.message.includes(lock) && /locked by another writer/.test(e.message));
  const waited = Date.now() - started;
  assert.ok(waited >= 140 && waited < 3000, `waited ${waited} ms`);
  assert.equal(readFileSync(file, 'utf8'), 'a\nb\n');
  assert.ok(existsSync(lock), 'a lock that is not this writer\'s stays');
});

test('a change between the temp file and the rename makes the edit run again', () => {
  const { dir, file } = scratch();
  let calls = 0; let hooked = 0;
  const beforeRename = (): void => { if (hooked++ === 0) writeFileSync(file, 'a\nb\nother\n'); };
  assert.equal(editStateFile(file, (t) => { calls++; return appendX(t); }, { beforeRename }), 'written');
  assert.equal(calls, 2);
  assert.equal(readFileSync(file, 'utf8'), 'a\nb\nother\nx\n');
  assert.deepEqual(names(dir), ['PROGRESS.md']);
});

test('a file that keeps changing is refused after three tries, and nothing of this writer is left', () => {
  const { dir, file } = scratch();
  let calls = 0; let n = 0;
  const beforeRename = (): void => { writeFileSync(file, `hand edit ${++n}\n`); };
  assert.throws(() => editStateFile(file, (t) => { calls++; return appendX(t); }, { beforeRename }), /kept changing while it was being written: nothing was written/);
  assert.equal(calls, 3);
  assert.equal(readFileSync(file, 'utf8'), 'hand edit 3\n');
  assert.deepEqual(names(dir), ['PROGRESS.md']);
});

test('CRLF lines and every untouched byte stay', () => {
  const { file } = scratch('# s\r\n## Now\r\n### a\r\n- one\r\n\r\n### b\r\n- two\r\n');
  assert.equal(editStateFile(file, (t) => t.replace('- one', '- ONE')), 'written');
  assert.equal(readFileSync(file, 'utf8'), '# s\r\n## Now\r\n### a\r\n- ONE\r\n\r\n### b\r\n- two\r\n');
});

test('a file that is not valid UTF-8 is refused and left as it was', () => {
  const bytes = Buffer.from([0x61, 0xff, 0x0a]);
  const { dir, file } = scratch(bytes);
  assert.throws(() => editStateFile(file, appendX), /PROGRESS\.md is not valid UTF-8: nothing was written/);
  assert.ok(readFileSync(file).equals(bytes));
  assert.deepEqual(names(dir), ['PROGRESS.md']);
});

test('the file mode is kept', { skip: posixOnly }, () => {
  const { file } = scratch();
  chmodSync(file, 0o640);
  editStateFile(file, appendX);
  assert.equal(statSync(file).mode & 0o777, 0o640);
});

test('a symlinked state file stays a link, the target is written, and nothing is left in either folder', { skip: symlinkSkip }, () => {
  const away = tmpDir('burhan-sw-away-'); const here = tmpDir('burhan-sw-here-');
  writeFileSync(join(away, 'real.md'), 'a\n');
  symlinkSync(join(away, 'real.md'), join(here, 'PROGRESS.md'));
  assert.equal(editStateFile(join(here, 'PROGRESS.md'), appendX), 'written');
  assert.ok(lstatSync(join(here, 'PROGRESS.md')).isSymbolicLink());
  assert.equal(readFileSync(join(away, 'real.md'), 'utf8'), 'a\nx\n');
  assert.deepEqual(names(here), ['PROGRESS.md']);
  assert.deepEqual(names(away), ['real.md']);
});

test('a read-only state file is refused, as before the writer', { skip: posixOnly || (isRoot ? 'root ignores file modes' : false) }, () => {
  const { dir, file } = scratch();
  chmodSync(file, 0o444);
  try {
    assert.throws(() => editStateFile(file, appendX), /not writable: nothing was written/);
  } finally { chmodSync(file, 0o644); }
  assert.equal(readFileSync(file, 'utf8'), 'a\nb\n');
  assert.deepEqual(names(dir), ['PROGRESS.md']);
});

test('a state file that is not there is refused', () => {
  const dir = tmpDir('burhan-sw-');
  assert.throws(() => editStateFile(join(dir, 'PROGRESS.md'), appendX), /cannot read PROGRESS\.md/);
  assert.deepEqual(names(dir), []);
});

test('an edit that returns null writes nothing and frees the lock', () => {
  const { dir, file } = scratch();
  assert.equal(editStateFile(file, () => null), 'unchanged');
  assert.equal(readFileSync(file, 'utf8'), 'a\nb\n');
  assert.deepEqual(names(dir), ['PROGRESS.md']);
});

test('six processes adding six items at once leave every block', async () => {
  const dir = project();
  const slugs = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'];
  const results = await Promise.all(slugs.map((slug) => run(dir, ['item', 'new', slug, '--type', 'change', '--scope', 'bounded'])));
  for (const r of results) assert.equal(r.code, 0, r.err);
  const text = readFileSync(join(dir, STATE), 'utf8');
  const heads = text.split('\n').filter((l) => l.startsWith('### '));
  for (const slug of slugs) assert.equal(heads.filter((h) => h.endsWith(`-${slug}`)).length, 1, `${slug} once`);
  assert.deepEqual(heads.map((h) => h.slice(4, 7)).sort(), ['001', '002', '003', '004', '005', '006']); // six numbers, none twice (the docs-folder lock)
  assert.match(text, /## Waiting on you\n- nothing\n/);
  assert.deepEqual(names(join(dir, '.burhan', 'local')), ['PROGRESS.md']);
});

test('a block added by another writer while this one waits for the lock is still there', async () => {
  const dir = project();
  const state = join(dir, STATE);
  const before = readFileSync(state, 'utf8');
  writeFileSync(`${state}.lock`, `${process.pid} ${Date.now()} held\n`);
  const child = run(dir, ['item', 'new', 'late', '--type', 'change', '--scope', 'bounded']);
  await new Promise((resolve) => setTimeout(resolve, 500)); // the child is now waiting for the lock
  writeFileSync(state, before.replace('## Now\n', '## Now\n\n### other\n- written by hand while the child waited\n'));
  unlinkSync(`${state}.lock`);
  const r = await child;
  assert.equal(r.code, 0, r.err);
  const text = readFileSync(state, 'utf8');
  assert.match(text, /### other\n- written by hand while the child waited\n/);
  assert.match(text, /### 001-late\n/);
});

test('item new and state compact do not write the state path with putFile', () => {
  const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
  for (const p of ['src/lib/item-new.ts', 'src/lib/state-compact.ts']) {
    assert.doesNotMatch(read(p), /(?:putFile|put)\(statePath/, p);
    assert.match(read(p), /editStateFile\(/, p);
  }
});

test('a token write that fails leaves no lock behind, and the next writer goes at once', () => {
  const { dir, file } = scratch();
  const writeToken = (): void => { throw Object.assign(new Error('no space'), { code: 'ENOSPC' }); };
  assert.throws(() => editStateFile(file, appendX, { writeToken }), (e: unknown) => e instanceof BurhanError && /cannot create the lock .*\(ENOSPC\): nothing was written/.test(e.message));
  assert.equal(readFileSync(file, 'utf8'), 'a\nb\n');
  assert.deepEqual(names(dir), ['PROGRESS.md']);
  const started = Date.now();
  assert.equal(editStateFile(file, appendX, { waitMs: 1000 }), 'written');
  assert.ok(Date.now() - started < 1000, 'the next writer did not wait for a lock left by the failed write');
  assert.equal(readFileSync(file, 'utf8'), 'a\nb\nx\n');
  assert.deepEqual(names(dir), ['PROGRESS.md']);
});

test('withLock runs the function under the lock, removes the lock after it (also when the function throws), and refuses while another holds it, naming what it guards', () => {
  const { dir } = scratch();
  const lock = join(dir, 'x.lock');
  assert.equal(withLock(lock, 'the thing', () => { assert.equal(existsSync(lock), true); return 7; }), 7);
  assert.equal(existsSync(lock), false);
  assert.throws(() => withLock(lock, 'the thing', () => { throw new Error('boom'); }), /boom/);
  assert.equal(existsSync(lock), false);
  writeFileSync(lock, `${process.pid} ${Date.now()} held\n`);
  assert.throws(() => withLock(lock, 'the docs folder', () => 1, { waitMs: 150 }), (e: unknown) => e instanceof BurhanError && /^the docs folder is locked by another writer/.test(e.message) && e.message.includes(lock));
  assert.equal(existsSync(lock), true); // the holder's lock is untouched
});
