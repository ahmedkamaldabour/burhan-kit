import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cli, projectWithItem, read, STATE } from './item-fixture.js';

const BY = ['--by', 'Sam Owner'];
const INTAKE = 'Created by `burhan item new`; fill the story next';
const INTAKE_LINE = '- Created by `burhan item new`; fill the story next, then `burhan item check foo`';
const NEXT = '- **Next action:** run `burhan guide foo`: it names the next step';
const ROUTE = '- **Route:** feature / architectural · **Mode:** step · intake 2026-11-12';
const block = async (dir: string): Promise<string> => (await cli(dir, ['state', 'show', 'foo'])).out;
const stateWith = (lines: string[]): string => `# State\n\n## Now\n\n### foo\n${ROUTE}\n${lines.join('\n')}\n\n## Waiting on you\n- nothing\n`;

test('item new keeps its intake line until the story is approved', async () => {
  const dir = await projectWithItem();
  assert.ok((await block(dir)).includes(INTAKE), await block(dir));
});

test('approve story replaces the intake line with a Next action line and keeps the Route line', async () => {
  const dir = await projectWithItem();
  const r = await cli(dir, ['approve', 'story', 'foo', ...BY]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /state: the intake line of "### foo" no longer sits in \.burhan\/local\/PROGRESS\.md/);
  const b = await block(dir);
  assert.ok(!b.includes('Created by'), b);
  assert.match(b, /^- \*\*Route:\*\* feature \/ architectural · \*\*Mode:\*\* step · intake \d{4}-\d{2}-\d{2}$/m);
  assert.ok(b.split('\n').includes(NEXT), b);
});

test('a block that already has a Next action keeps its text; only the intake line goes', async () => {
  const dir = await projectWithItem();
  writeFileSync(join(dir, STATE), stateWith([INTAKE_LINE, '- **Next action:** answer Q-1']));
  assert.equal((await cli(dir, ['approve', 'story', 'foo', ...BY])).code, 0);
  assert.equal(await block(dir), `### foo\n${ROUTE}\n- **Next action:** answer Q-1\n`);
});

test('approve plan and a second approve story leave the block as it is', async () => {
  const dir = await projectWithItem();
  assert.equal((await cli(dir, ['approve', 'story', 'foo', ...BY])).code, 0);
  const afterStory = await block(dir);
  const plan = await cli(dir, ['approve', 'plan', 'foo', ...BY]);
  assert.equal(plan.code, 0, plan.err);
  assert.equal(await block(dir), afterStory);
  const again = await cli(dir, ['approve', 'story', 'foo', ...BY]);
  assert.equal(again.code, 0);
  assert.match(again.out, /already approved/);
  assert.equal(await block(dir), afterStory);
  assert.ok(!(plan.out + again.out).includes('intake line'));
});

test('state set Next action removes the intake line of an older block; another label leaves it', async () => {
  const dir = await projectWithItem();
  writeFileSync(join(dir, STATE), stateWith([INTAKE_LINE, '- **Status:** story approved by the owner; the plan is next']));
  assert.equal((await cli(dir, ['state', 'set', 'foo', 'Branch', 'main'])).code, 0);
  assert.ok((await block(dir)).includes(INTAKE), 'a label other than Next action leaves the intake line');
  const r = await cli(dir, ['state', 'set', 'foo', 'Next action', 'write the plan']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Next action added/);
  assert.match(r.out, /intake line/);
  const b = await block(dir);
  assert.ok(!b.includes('Created by'), b);
  assert.ok(b.includes('- **Status:** story approved by the owner; the plan is next'), b);
  assert.ok(b.split('\n').includes('- **Next action:** write the plan'), b);
});

test('a missing state file, a missing block or a CRLF file never fails the approval', async () => {
  const noFile = await projectWithItem();
  rmSync(join(noFile, STATE));
  const a = await cli(noFile, ['approve', 'story', 'foo', ...BY]);
  assert.equal(a.code, 0, a.err);
  assert.equal(existsSync(join(noFile, STATE)), false, 'no state file is made');
  assert.ok(!a.out.includes('intake line'));
  const noBlock = await projectWithItem();
  const empty = '# State\n\n## Now\n\n## Waiting on you\n- nothing\n';
  writeFileSync(join(noBlock, STATE), empty);
  assert.equal((await cli(noBlock, ['approve', 'story', 'foo', ...BY])).code, 0);
  assert.equal(read(join(noBlock, STATE)), empty);
  const crlf = await projectWithItem();
  writeFileSync(join(crlf, STATE), stateWith([INTAKE_LINE]).replace(/\n/g, '\r\n'));
  assert.equal((await cli(crlf, ['approve', 'story', 'foo', ...BY])).code, 0);
  const text = read(join(crlf, STATE));
  assert.ok(text.includes('- **Next action:**'), text);
  assert.ok(!/(^|[^\r])\n/.test(text), 'every line ending is still CRLF');
});
