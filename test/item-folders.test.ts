import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cli, project, STATE, write } from './item-fixture.js';

const DOCS = '.burhan/work'; // the fixture project's docs location (item-fixture.ts: itemDir)
const put = (dir: string, rel: string, text = '# x\n'): void => write(join(dir, DOCS, rel), text);
const rowOf = (out: string, slug: string): boolean => out.split('\n').some((l) => l.startsWith(`| [${slug}](`));

test('status lists a folder only when it holds <slug>-story, -implementation-plan or -findings (AC-01)', async () => {
  const dir = project();
  put(dir, 'a/a-story.md');
  put(dir, 'b/b-implementation-plan.md');
  put(dir, 'c/c-findings.md');
  put(dir, 'notes/x.txt');
  put(dir, 'd/story.md');
  const r = await cli(dir, ['status']);
  assert.equal(r.code, 0, r.err);
  for (const slug of ['a', 'b', 'c']) assert.equal(rowOf(r.out, slug), true, `${slug} is listed`);
  for (const slug of ['notes', 'd']) assert.equal(rowOf(r.out, slug), false, `${slug} is not an item`);
});

test('a folder with only a story file, or a numbered folder, is still listed; the file prefix is the folder name (AC-02)', async () => {
  const dir = project();
  put(dir, 'e/e-story.md');
  put(dir, '012-x/012-x-story.md');
  put(dir, 'f/g-story.md');
  const r = await cli(dir, ['status']);
  assert.equal(r.code, 0, r.err);
  assert.equal(rowOf(r.out, 'e'), true, 'e is listed');
  assert.equal(rowOf(r.out, '#012 · x'), true, 'the numbered folder is listed, shown as #012 · x');
  assert.equal(rowOf(r.out, 'f'), false, 'a file whose prefix is not the folder name does not make an item');
});

test('stats counts the same folders as status (AC-09)', async () => {
  const dir = project();
  put(dir, 'a/a-story.md');
  put(dir, 'b/b-findings.md');
  put(dir, 'notes/x.txt');
  mkdirSync(join(dir, DOCS, 'empty'));
  const r = await cli(dir, ['stats', '--json']);
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(r.out).items, 2);
});

test('state compact does not read a folder with no item file as an item (AC-09)', async () => {
  const dir = project();
  put(dir, 'notes/x.txt');
  writeFileSync(join(dir, STATE), ['# State', '', '## Now', '- notes · see its folder', '', '## Waiting on you', '- nothing', ''].join('\n'));
  const r = await cli(dir, ['state', 'compact']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /left as it is: notes: no folder under \.burhan\/work/);
});
