import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { verifyFile } from '../src/lib/verify.js';
import { cli, itemDir, planFile, project, projectWithItem, setPlanStatus } from './item-fixture.js';

const NODE = process.execPath;
const BY = ['--by', 'Sam Owner'];
const verify = (dir: string, slug = 'foo') => cli(dir, ['verify', slug, '--', NODE, '-e', 'process.exit(0)']);
const recorded = (dir: string, slug = 'foo'): boolean => existsSync(verifyFile(itemDir(dir, slug), slug));

async function refused(dir: string, stage: RegExp): Promise<void> {
  const r = await verify(dir);
  assert.equal(r.code, 2, r.out);
  assert.match(r.err, stage);
  assert.equal(r.out, '', 'nothing was run or printed');
  assert.equal(recorded(dir), false, 'nothing was recorded');
}

test('verify refuses an item whose plan is Draft: exit 2, the stage named, nothing recorded', async () => {
  await refused(await projectWithItem(), /item "foo" is before build \(plan draft\)/);
});

test('verify refuses an item whose plan is Approved', async () => {
  const dir = await projectWithItem();
  setPlanStatus(dir, 'Approved');
  await refused(dir, /is before build \(plan approved, nothing started\)/);
});

test('verify refuses an item with a story and no plan, draft or approved', async () => {
  const draft = await projectWithItem();
  rmSync(planFile(draft));
  await refused(draft, /is before build \(story draft\)/);
  const approved = await projectWithItem();
  assert.equal((await cli(approved, ['approve', 'story', 'foo', ...BY])).code, 0);
  rmSync(planFile(approved));
  await refused(approved, /is before build \(story approved, no plan\)/);
});

test('verify is unchanged for a plan In progress or Completed', async () => {
  for (const status of ['In progress', 'Completed']) {
    const dir = await projectWithItem();
    setPlanStatus(dir, status);
    const r = await verify(dir);
    assert.equal(r.code, 0, `${status}: ${r.err}`);
    assert.match(r.out, /verify: passed — exit 0/);
    assert.equal(recorded(dir), true, status);
  }
});

test('verify is unchanged for a route with no plan and for a folder that has no files', async () => {
  const dir = project();
  assert.equal((await cli(dir, ['item', 'new', 'inv', '--type', 'investigation', '--scope', 'bounded'])).code, 0);
  assert.equal((await verify(dir, 'inv')).code, 0);
  assert.equal(recorded(dir, 'inv'), true);
  mkdirSync(join(dir, '.burhan', 'work', 'bare'), { recursive: true });
  assert.equal((await verify(dir, 'bare')).code, 0);
  assert.equal(recorded(dir, 'bare'), true);
});

test('a missing command is still reported first', async () => {
  const dir = await projectWithItem();
  const r = await cli(dir, ['verify', 'foo']);
  assert.equal(r.code, 2);
  assert.match(r.err, /needs a command after --/);
});

test('a refused run leaves no record for evidence, guide or item finish to count', async () => {
  const dir = await projectWithItem();
  assert.equal((await cli(dir, ['approve', 'story', 'foo', ...BY])).code, 0);
  assert.equal((await cli(dir, ['approve', 'plan', 'foo', ...BY])).code, 0);
  assert.equal((await verify(dir)).code, 2);
  assert.equal(recorded(dir), false);
  const evidence = await cli(dir, ['evidence', '--item', 'foo']);
  assert.equal(evidence.code, 0, evidence.err);
  assert.doesNotMatch(evidence.out, /verify records:/);
  const last = (await cli(dir, ['guide', 'foo'])).out.trimEnd().split('\n').pop() ?? '';
  assert.match(last, /^full run:/);
  assert.doesNotMatch(last, /by burhan verify record/);
  const finish = await cli(dir, ['item', 'finish', 'foo']);
  assert.equal(finish.code, 2);
  assert.match(finish.err, /item finish needs it In progress/);
  assert.equal((await cli(dir, ['item', 'set', 'foo', 'unit', '1', 'in-progress'])).code, 0);
  assert.equal((await verify(dir)).code, 0);
  assert.equal(readFileSync(verifyFile(itemDir(dir), 'foo'), 'utf8').trim().split('\n').length, 1, 'only the run after the build started is recorded');
});

test('the advice fits the stage: a plan stage names the first sub-unit command, a story stage says the plan comes first', async () => {
  const plan = await projectWithItem();
  const planErr = (await verify(plan)).err;
  assert.match(planErr, /burhan item set foo unit 1 in-progress/);
  const story = await projectWithItem();
  rmSync(planFile(story));
  const storyErr = (await verify(story)).err;
  assert.doesNotMatch(storyErr, /unit 1 in-progress/, 'that command fails while there is no plan');
  assert.match(storyErr, /write and approve the plan/);
});
