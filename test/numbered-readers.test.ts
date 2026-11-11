import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { runCli } from '../src/main.js';
import { capture } from './helpers.js';
import { cli, project, read, STATE, write } from './item-fixture.js';

// Item numbered-item-ids, readers: the commands that read or show an item take a number, a plain slug or the full id, and show `#012 · slug` where the text is only for reading.
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

test('the guide shows a numbered item as #001 · foo whether it was asked by slug, number or full id, and an older item by its name', async () => {
  const dir = project();
  await make(dir, 'foo');
  for (const arg of ['foo', '1', '001', '001-foo']) {
    const r = await run(dir, ['guide', arg]);
    assert.equal(r.code, 0, `${arg}: ${r.err}`);
    assert.match(r.out, /^guide: #001 · foo — /, arg);
  }
  const json = await run(dir, ['guide', '1', '--json']);
  assert.equal((JSON.parse(json.out) as { item: string }).item, '001-foo'); // the machine form keeps the full id
});

test('item check names a shared number as a warning and still passes', async () => {
  const dir = project();
  await make(dir, 'a');
  rmSync(join(dir, WORK, '001-a'), { recursive: true });
  for (const id of ['013-a', '013-b']) {
    mkdirSync(join(dir, WORK, id), { recursive: true });
    write(join(dir, WORK, id, `${id}-findings.md`), `# ${id} — Findings\n- **Status:** In progress\n- **Contract:** 1\n- **Route:** investigation / bounded · **Read-only:** yes\n`);
  }
  const check = await run(dir, ['item', 'check', '013-b']);
  assert.match(check.out, /warning: the number 013 is used by more than one item: 013-a, 013-b/);
  assert.equal(check.code, 0);
  const alone = project();
  await make(alone, 'one');
  assert.doesNotMatch((await run(alone, ['item', 'check', '1'])).out, /warning/);
});

test('an older unnumbered item works by its plain slug beside the numbered ones, and the number 1 does not reach it', async () => {
  const dir = project();
  const made = await cli(dir, ['item', 'new', 'legacy', ...ARGS]); // the fixture makes the older shape
  assert.equal(made.code, 0, made.err);
  await make(dir, 'fresh');
  assert.deepEqual(folders(dir), ['001-fresh', 'legacy']);
  assert.match((await run(dir, ['guide', 'legacy'])).out, /^guide: legacy — /);
  assert.match((await run(dir, ['guide', '1'])).out, /^guide: #001 · fresh — /);
  assert.match((await run(dir, ['status'])).out, /\| \[#001 · fresh\]\(001-fresh\/\) \|[\s\S]*\| \[legacy\]\(legacy\/\) \|/);
});

test('state show and state set take a number or a plain slug and name the heading; two headings with one number are refused', async () => {
  const dir = project();
  await make(dir, 'foo');
  const shown = await run(dir, ['state', 'show', '1']);
  assert.equal(shown.code, 0, shown.err);
  assert.match(shown.out, /^### 001-foo\n/);
  const set = await run(dir, ['state', 'set', 'foo', 'Next action', 'fill the story']);
  assert.equal(set.code, 0, set.err);
  assert.match(set.out, /state set: 001-foo · Next action added/);
  assert.match(read(join(dir, STATE)), /### 001-foo\n[\s\S]*- \*\*Next action:\*\* fill the story/);
  write(join(dir, STATE), '# State\n\n## Now\n\n### 013-a\n- x\n\n### 013-b\n- y\n\n## Waiting on you\n');
  const both = await run(dir, ['state', 'set', '13', 'Next action', 'z']);
  assert.equal(both.code, 2);
  assert.match(both.err, /more than one item.*013-a, 013-b/);
  assert.equal((await run(dir, ['state', 'set', '013-b', 'Next action', 'z'])).code, 0);
});

test('use takes a number or a slug that names one block, and refuses one that names two', async () => {
  const dir = project();
  await make(dir, 'foo');
  assert.equal((await run(dir, ['use', '1'])).code, 0);
  assert.equal((await run(dir, ['use', 'foo'])).code, 0);
  write(join(dir, STATE), '# State\n\n## Now\n\n### 013-a\n- x\n\n### 013-b\n- y\n\n## Waiting on you\n');
  const both = await run(dir, ['use', '13']);
  assert.equal(both.code, 2);
  assert.match(both.err, /013-a, 013-b/);
});

test('evidence --item and changed --item take a number: the report names the full id', async () => {
  const dir = project();
  await make(dir, 'foo');
  const ev = await run(dir, ['evidence', '--item', '1']);
  assert.equal(ev.code, 0, ev.err);
  assert.match(ev.out, /item "001-foo"/);
  const changed = await run(dir, ['changed', '--item', '001']);
  assert.match(changed.out, /^001-foo: /);
  const pr = await run(dir, ['pr-body', '--item', '1']);
  assert.doesNotMatch(pr.err, /no work item/);
  // the ledger of an item whose folder is gone stays readable under the name it was written with
  assert.equal((await run(dir, ['evidence', '--item', 'gone-item'])).code, 0);
});

test('changed --item and pr-body --item refuse a number that names two items, listing both', async () => {
  const dir = project();
  for (const id of ['013-a', '013-b']) mkdirSync(join(dir, WORK, id), { recursive: true });
  for (const args of [['changed', '--item', '13'], ['pr-body', '--item', '13']]) {
    const r = await run(dir, args);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.err, /more than one item.*013-a, 013-b/, args.join(' '));
  }
});
