import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUTCOMES, parseClosedLine } from '../src/hooks/core/state-lines.mjs';
import { cli, itemDir, planFile, projectWithItem, read, setPlanStatus, STATE, storyFile, write } from './item-fixture.js';

const BY = ['--by', 'Sam Owner'];
const REASON = 'the guide already prints the stage, see src/lib/guide.ts:42';
const OK = ['--already-satisfied', REASON, ...BY];
const CLOSED = '- foo · feature / architectural · Already satisfied · uncommitted · .burhan/work/foo';
const close = (dir: string, ...extra: string[]) => cli(dir, ['item', 'close', 'foo', ...extra]);
const reasonFile = (dir: string): string => join(itemDir(dir), 'foo-already-satisfied.md');
/** An item with a story and no plan: the fixture's plan is removed. */
async function storyOnly(): Promise<string> {
  const dir = await projectWithItem();
  rmSync(planFile(dir));
  return dir;
}

test('the owner closes a story-only item: a reason file, the index state and the closed line', async () => {
  const dir = await storyOnly();
  const r = await close(dir, ...OK);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /item close: foo closed as already satisfied by Sam Owner/);
  assert.match(r.out, /state close: foo is now one line/);
  const text = read(reasonFile(dir));
  assert.match(text, /^- \*\*Closed by:\*\* Sam Owner · \d{4}-\d{2}-\d{2}$/m);
  assert.ok(text.includes(`- **Reason:** ${REASON}`), text);
  assert.match((await cli(dir, ['status'])).out, /\| \[foo\]\(foo\/\) \|[^\n]*\| Already satisfied \|/);
  const state = read(join(dir, STATE));
  assert.ok(state.split('\n').includes(CLOSED), state);
  assert.ok(!state.includes('### foo'), 'the block is gone');
});

test('a Draft or Approved plan may still be closed this way', async () => {
  for (const status of ['Draft', 'Approved']) {
    const dir = await projectWithItem();
    setPlanStatus(dir, status);
    const r = await close(dir, ...OK);
    assert.equal(r.code, 0, `${status}: ${r.err}`);
    assert.match((await cli(dir, ['status'])).out, /\| Already satisfied \|/, status);
    assert.ok(read(planFile(dir)).includes(`**Overall status:** ${status}`), 'the plan is left as it was');
  }
});

test('refusals exit 2 and write nothing', async () => {
  const none = (): void => {};
  const cases: Array<[string, string[], RegExp, (dir: string) => void]> = [
    ['no reason flag', [...BY], /needs --already-satisfied/, none],
    ['an empty reason', ['--already-satisfied', '', ...BY], /reason is empty/, none],
    ['a blank reason', ['--already-satisfied', '   ', ...BY], /reason is empty/, none],
    ['a line break in the reason', ['--already-satisfied', 'one\ntwo', ...BY], /one line/, none],
    ['no --by', ['--already-satisfied', REASON], /--by is needed/, none],
    ['an agent name', ['--already-satisfied', REASON, '--by', 'Claude'], /not an agent/, none],
    ['a model word in the name', ['--already-satisfied', REASON, '--by', 'Ahmed Claude'], /not an agent/, none],
    ['a plan In progress', OK, /plan of "foo" is In progress/, (d) => setPlanStatus(d, 'In progress')],
    ['a plan Completed', OK, /plan of "foo" is Completed/, (d) => setPlanStatus(d, 'Completed')],
    ['a plan Paused', OK, /plan of "foo" is Paused/, (d) => setPlanStatus(d, 'Paused')],
    ['a plan Superseded', OK, /plan of "foo" is Superseded/, (d) => setPlanStatus(d, 'Superseded')],
    ['no story', OK, /has no story/, (d) => rmSync(storyFile(d))],
  ];
  for (const [name, args, message, prep] of cases) {
    const dir = await projectWithItem();
    prep(dir);
    const state = read(join(dir, STATE));
    const r = await close(dir, ...args);
    assert.equal(r.code, 2, `${name}: ${r.out}`);
    assert.match(r.err, message, name);
    assert.equal(existsSync(reasonFile(dir)), false, `${name}: no reason file`);
    assert.equal(read(join(dir, STATE)), state, `${name}: the state file is untouched`);
  }
});

test('a second close is refused and changes nothing', async () => {
  const dir = await storyOnly();
  assert.equal((await close(dir, ...OK)).code, 0);
  const file = read(reasonFile(dir));
  const state = read(join(dir, STATE));
  const again = await close(dir, '--already-satisfied', 'another reason entirely', ...BY);
  assert.equal(again.code, 2);
  assert.match(again.err, /already has .*foo-already-satisfied\.md/);
  assert.equal(read(reasonFile(dir)), file);
  assert.equal(read(join(dir, STATE)), state);
});

test('with no block in the state file the close still writes the reason and says so', async () => {
  const dir = await storyOnly();
  const empty = '# State\n\n## Now\n\n## Waiting on you\n- nothing\n';
  writeFileSync(join(dir, STATE), empty);
  const r = await close(dir, ...OK);
  assert.equal(r.code, 0, r.err);
  assert.equal(existsSync(reasonFile(dir)), true);
  assert.match(r.out, /no "### foo" block under Now/);
  assert.equal(read(join(dir, STATE)), empty);
});

test('the plan is never touched by the close: its Close-out box stays open', async () => {
  const dir = await projectWithItem();
  const before = read(planFile(dir));
  assert.match(before, /- \[ \] Close-out in the state file/);
  assert.equal((await close(dir, ...OK)).code, 0);
  assert.equal(read(planFile(dir)), before);
});

test('state close cannot say Already satisfied without the reason file', async () => {
  const dir = await storyOnly();
  const state = read(join(dir, STATE));
  const r = await cli(dir, ['state', 'close', 'foo', '--outcome', 'Already satisfied', '--commit', 'uncommitted', '--folder', '.burhan/work/foo']);
  assert.equal(r.code, 2);
  assert.match(r.err, /is "Draft", not "Already satisfied"/);
  assert.equal(read(join(dir, STATE)), state);
  const bad = await cli(dir, ['state', 'close', 'foo', '--outcome', 'Nope', '--commit', 'uncommitted', '--folder', 'f']);
  assert.match(bad.err, /Superseded, Already satisfied/);
});

test('guide names the closed stage and authorizes nothing', async () => {
  const dir = await storyOnly();
  assert.equal((await close(dir, ...OK)).code, 0);
  const g = await cli(dir, ['guide', 'foo']);
  assert.equal(g.code, 0, g.err);
  assert.match(g.out, /^stage: already satisfied$/m);
  assert.match(g.out, /^code edits: NOT authorized — the item was closed as already satisfied/m);
  assert.match(g.out, /^next: nothing to build/m);
  assert.doesNotMatch(g.out, /^skill: /m);
});

test('the readers: the closed line, the outcome list, a malformed reason file, a plan that is In progress', async () => {
  assert.deepEqual([...OUTCOMES], ['QC PASS', 'Done (no QC)', 'Paused', 'Superseded', 'Already satisfied']);
  assert.equal(parseClosedLine(CLOSED)?.outcome, 'Already satisfied');
  const dir = await storyOnly();
  const status = async (): Promise<string> => (await cli(dir, ['status'])).out;
  write(reasonFile(dir), '- **Closed by:** Sam\n- **Reason:** words\n'); // no date: not the form
  assert.doesNotMatch(await status(), /\| Already satisfied \|/);
  write(reasonFile(dir), '- **Closed by:** Sam Owner · 2026-11-16\n- **Reason:**\n'); // no words
  assert.doesNotMatch(await status(), /\| Already satisfied \|/);
  write(reasonFile(dir), '- **Closed by:** Sam Owner · 2026-11-16\n- **Reason:** words\n');
  assert.match(await status(), /\| Already satisfied \|/);
  const built = await projectWithItem();
  write(reasonFile(built), '- **Closed by:** Sam Owner · 2026-11-16\n- **Reason:** words\n');
  setPlanStatus(built, 'In progress');
  assert.doesNotMatch((await cli(built, ['status'])).out, /\| Already satisfied \|/, 'the build wins');
});

test('state compact writes the closed line of an Already satisfied item', async () => {
  const dir = await storyOnly();
  writeFileSync(join(dir, STATE), '# State\n\n## Now\n\n## Waiting on you\n- nothing\n');
  assert.equal((await close(dir, ...OK)).code, 0);
  writeFileSync(join(dir, STATE), '# State\n\n## Now\n\n- foo · closed, nothing to build\n\n## Waiting on you\n- nothing\n');
  const r = await cli(dir, ['state', 'compact', '--apply']);
  assert.equal(r.code, 0, r.err);
  assert.ok(read(join(dir, STATE)).split('\n').includes(CLOSED), read(join(dir, STATE)));
});

test('item close has its own usage', async () => {
  const dir = await storyOnly();
  const r = await cli(dir, ['item', 'close', '--help']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^ {2}item close <slug> --already-satisfied <reason> --by <owner name>/);
});
