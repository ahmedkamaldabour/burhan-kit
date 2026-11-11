import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../src/main.js';
import { capture, symlinkSkip } from './helpers.js';
import { project, read, STATE } from './item-fixture.js';

// Item numbered-item-ids: `item new` gives the folder the next number, and every command that takes an item resolves a plain slug, a number or the full id.
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const WORK = join('.burhan', 'work');
const ARGS = ['--type', 'change', '--scope', 'bounded'];

/** runCli as a user types it: `item new` here makes the numbered shape (the fixture's `cli` makes the older one). */
async function run(dir: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
  const c = capture(dir);
  const code = await runCli(args, c.io);
  return { code, ...c.o };
}
const folders = (dir: string): string[] => (existsSync(join(dir, WORK)) ? readdirSync(join(dir, WORK)).filter((n) => !n.startsWith('.')).sort() : []);
const make = async (dir: string, slug: string): Promise<void> => { const r = await run(dir, ['item', 'new', slug, ...ARGS]); assert.equal(r.code, 0, r.err); };
/** A hand-made folder, as a second clone would bring it. */
const hand = (dir: string, id: string): void => { mkdirSync(join(dir, WORK, id), { recursive: true }); };
/** One burhan process in `cwd`, started now; resolves when it ends. */
const spawned = (cwd: string, args: string[]): Promise<{ code: number | null; err: string }> => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [CLI, ...args], { cwd });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  child.on('error', reject);
  child.on('close', (code) => resolve({ code, err }));
});

test('the first item of an empty docs folder is 001-<slug> and each next one takes the highest number + 1', async () => {
  const dir = project();
  await make(dir, 'foo');
  await make(dir, 'bar');
  assert.deepEqual(folders(dir), ['001-foo', '002-bar']);
  assert.deepEqual(readdirSync(join(dir, WORK, '001-foo')).filter((f) => f.endsWith('.md')).sort(), ['001-foo-build-spec.md', '001-foo-implementation-plan.md', '001-foo-story.md']);
  const state = read(join(dir, STATE));
  assert.match(state, /### 001-foo\n/);
  assert.match(state, /### 002-bar\n/);
});

test('a number is never reused: deleting a folder from the middle leaves a gap, and the folders sort in creation order', async () => {
  const dir = project();
  for (const s of ['a', 'b', 'c']) await make(dir, s);
  rmSync(join(dir, WORK, '002-b'), { recursive: true });
  await make(dir, 'd');
  assert.deepEqual(folders(dir), ['001-a', '003-c', '004-d']);
  assert.deepEqual(folders(dir), [...folders(dir)].sort()); // a plain alphabetical listing is the creation order
});

test('older unnumbered folders stay as they are, do not count, and sort after the numbered ones', async () => {
  const dir = project();
  hand(dir, 'old-one');
  hand(dir, 'zeta-old');
  await make(dir, 'foo');
  assert.deepEqual(folders(dir), ['001-foo', 'old-one', 'zeta-old']);
});

test('item new refuses a slug another item already has, with or without its number, and writes nothing', async () => {
  const dir = project();
  await make(dir, 'foo');
  hand(dir, 'plain');
  hand(dir, '013-shared');
  const before = read(join(dir, STATE));
  for (const [slug, named] of [['foo', '001-foo'], ['plain', 'plain'], ['shared', '013-shared']] as const) {
    const r = await run(dir, ['item', 'new', slug, ...ARGS]);
    assert.equal(r.code, 2, slug);
    assert.match(r.err, new RegExp(slug === 'foo' ? 'already has a block in Now' : `already has a folder: .*${named}`), slug); // foo: the state block is found first
  }
  assert.deepEqual(folders(dir), ['001-foo', '013-shared', 'plain']);
  assert.equal(read(join(dir, STATE)), before);
});

test('item new refuses a slug that two folders already have (two clones made 013-a and 014-a) and names both', async () => {
  const dir = project();
  hand(dir, '013-a');
  hand(dir, '014-a');
  const r = await run(dir, ['item', 'new', 'a', ...ARGS]);
  assert.equal(r.code, 2);
  assert.match(r.err, /013-a, 014-a/);
  assert.deepEqual(folders(dir), ['013-a', '014-a']);
});

test('item new refuses a slug that reads as a number, and a slug with a word in it is fine', async () => {
  const dir = project();
  for (const slug of ['12', '012', '2026', '012-x', '999-fix']) {
    const r = await run(dir, ['item', 'new', slug, ...ARGS]);
    assert.equal(r.code, 2, slug);
    assert.match(r.err, /reads as an item number/, slug);
  }
  assert.deepEqual(folders(dir), []);
  await make(dir, 'fix-12');
  await make(dir, '12-x');
  assert.deepEqual(folders(dir), ['001-fix-12', '002-12-x']);
});

test('item new refuses to number past 999', async () => {
  const dir = project();
  hand(dir, '999-last');
  const r = await run(dir, ['item', 'new', 'next', ...ARGS]);
  assert.equal(r.code, 2);
  assert.match(r.err, /no number is left/);
  assert.deepEqual(folders(dir), ['999-last']);
});

test('item new waits for the docs-folder lock, takes its number only after it is released, and leaves no lock behind', async () => {
  const dir = project();
  mkdirSync(join(dir, WORK), { recursive: true });
  const lock = join(dir, WORK, '.item-new.lock');
  writeFileSync(lock, `${process.pid} ${Date.now()} held\n`);
  hand(dir, '004-existing'); // made by another process while this one waits: its number counts
  const child = spawned(dir, ['item', 'new', 'late', ...ARGS]);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.deepEqual(folders(dir), ['004-existing'], 'nothing is made while the lock is held');
  unlinkSync(lock);
  const r = await child;
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(folders(dir), ['004-existing', '005-late']);
  assert.equal(existsSync(lock), false);
});

test('four item new processes at once get four different, consecutive numbers', async () => {
  const dir = project();
  const slugs = ['w1', 'w2', 'w3', 'w4'];
  const results = await Promise.all(slugs.map((s) => spawned(dir, ['item', 'new', s, ...ARGS])));
  for (const r of results) assert.equal(r.code, 0, r.err);
  const numbers = folders(dir).map((n) => n.slice(0, 3));
  assert.deepEqual(numbers, ['001', '002', '003', '004']);
  assert.deepEqual(folders(dir).map((n) => n.slice(4)).sort(), slugs);
  assert.equal(existsSync(join(dir, WORK, '.item-new.lock')), false);
});

test('a plain slug, a number and the full id reach the same item in every command that takes one', async () => {
  const dir = project();
  await make(dir, 'foo');
  for (const arg of ['foo', '1', '001', '001-foo']) {
    const r = await run(dir, ['guide', arg, '--json']);
    assert.equal(r.code, 0, `${arg}: ${r.err}`);
    assert.equal((JSON.parse(r.out) as { item: string }).item, '001-foo', arg);
  }
  for (const arg of ['foo', '1', '001-foo']) assert.equal((await run(dir, ['item', 'check', arg])).code, 0, arg);
  const approve = await run(dir, ['approve', 'story', '1', '--by', 'Owner Name']); // refused: the story is still a template; the message names the full id
  assert.equal(approve.code, 2);
  assert.match(approve.err, /burhan item check 001-foo/);
});

test('a number that matches nothing and a slug that matches nothing are refused', async () => {
  const dir = project();
  await make(dir, 'foo');
  for (const arg of ['2', '002', 'bar', '002-bar']) {
    const r = await run(dir, ['guide', arg]);
    assert.equal(r.code, 2, arg);
    assert.match(r.err, /has no folder/, arg);
  }
});

test('a number or slug that names two items is refused with both candidates; the full id still works', async () => {
  const dir = project();
  for (const id of ['013-a', '013-b', '014-a']) hand(dir, id);
  for (const [arg, listed] of [['13', '013-a, 013-b'], ['013', '013-a, 013-b'], ['a', '013-a, 014-a']] as const) {
    for (const args of [['guide', arg], ['item', 'check', arg], ['finding', 'list', arg]]) {
      const r = await run(dir, args);
      assert.equal(r.code, 2, args.join(' '));
      assert.match(r.err, new RegExp(`more than one item.*${listed}`), args.join(' '));
    }
  }
  assert.equal((await run(dir, ['guide', '14'])).code, 0);
  assert.equal((await run(dir, ['guide', '013-b'])).code, 0);
});

test('item new writes the full id in the files, the plan lines and the block, and shows #001 · foo for reading', async () => {
  const dir = project();
  const r = await run(dir, ['item', 'new', 'foo', '--type', 'feature', '--scope', 'architectural']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^item new: created #001 · foo \(feature \/ architectural, mode /);
  assert.match(r.out, /state: added "### 001-foo" under Now/);
  assert.match(r.out, /next: fill the files, then burhan item check 001-foo\n$/);
  const plan = read(join(dir, WORK, '001-foo', '001-foo-implementation-plan.md'));
  assert.match(plan, /^# 001-foo — Implementation Plan$/m);
  assert.match(plan, /^- \*\*Story:\*\* \.\/001-foo-story\.md$/m);
  assert.match(plan, /burhan changed --item 001-foo/);
  assert.match(plan, /reviews\/001-foo-review\.md/);
  assert.doesNotMatch(plan, /<slug>/);
  assert.equal((await run(dir, ['item', 'check', '001-foo'])).code, 0);
});


test('a folder that is a link to a folder inside the project is an item like any other', { skip: symlinkSkip }, async () => {
  const dir = project();
  mkdirSync(join(dir, 'elsewhere', 'linked-item'), { recursive: true });
  mkdirSync(join(dir, WORK), { recursive: true });
  symlinkSync(join(dir, 'elsewhere', 'linked-item'), join(dir, WORK, 'linked-item'), 'dir');
  const r = await run(dir, ['guide', 'linked-item', '--json']);
  assert.equal(r.code, 0, r.err);
  assert.equal((JSON.parse(r.out) as { item: string }).item, 'linked-item');
});
