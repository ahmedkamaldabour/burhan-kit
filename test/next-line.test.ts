import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cli, project, projectWithItem } from './item-fixture.js';

const BY = ['--by', 'dev-dabour'];

test('item new, approve and item set print a next: step', async () => {
  const made = await cli(project(), ['item', 'new', 'foo', '--type', 'feature', '--scope', 'architectural']);
  assert.equal(made.code, 0, made.err);
  assert.match(made.out, /^next: /m);
  const dir = await projectWithItem();
  const story = await cli(dir, ['approve', 'story', 'foo', ...BY]);
  assert.equal(story.code, 0, story.err);
  assert.match(story.out, /^next: /m);
  const plan = await cli(dir, ['approve', 'plan', 'foo', ...BY]);
  assert.equal(plan.code, 0, plan.err);
  assert.match(plan.out, /^next: /m);
  const unit = await cli(dir, ['item', 'set', 'foo', 'unit', '1', 'in-progress']);
  assert.equal(unit.code, 0, unit.err);
  assert.match(unit.out, /^next: /m);
});

test('all five item-changing commands go through the wrapper that prints the next step', () => {
  const main = readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)), 'utf8');
  for (const call of ['advise(itemSet(', 'advise(itemFinish(', 'advise(itemNew(', 'advise(approve(', 'advise(deviationResolve(']) {
    assert.ok(main.includes(call), `${call} is wrapped in advise()`);
  }
});

test('a command that fails prints no next: step', async () => {
  const r = await cli(project(), ['approve', 'story', 'nope', ...BY]);
  assert.notEqual(r.code, 0);
  assert.doesNotMatch(r.out, /^next: /m);
});

test('item new and approve print exactly one next: line (item new keeps its own)', async () => {
  const count = (text: string): number => (text.match(/^next: /gm) ?? []).length;
  const made = await cli(project(), ['item', 'new', 'foo', '--type', 'feature', '--scope', 'architectural']);
  assert.equal(count(made.out), 1);
  assert.match(made.out, /^next: fill the files/m);
  const story = await cli(await projectWithItem(), ['approve', 'story', 'foo', ...BY]);
  assert.equal(count(story.out), 1);
});
