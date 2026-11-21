import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { itemForTurn, itemResolved, parseEvent, turnEditFiles, type Ctx } from '../../src/hooks/core/lib.mjs';

// Item 010-single-block-fallback: with exactly one block and no live link, a turn that wrote only the files of an item with no block is
// filed under no item (the ledger and the skill memory). Everything else keeps `itemResolved`.
const D = '.burhan/work';
const ONE = '### other\n- **Route:** change / bounded\n';
const TWO = `${ONE}### beta\n- **Route:** change / bounded\n`;
const FOO = `${D}/foo/foo-story.md`;
const OTHER = `${D}/other/other-story.md`;

test('AC-01: one block, no link, only the files of an item with no block -> no item', () => {
  assert.equal(itemForTurn(ONE, '', [FOO], D), '');
  assert.equal(itemForTurn(ONE, '', [FOO, `${D}/foo/reviews/foo-review.md`, `${D}/bar/bar-story.md`], D), '', 'several foreign folders');
  assert.equal(itemForTurn(ONE, '', [`${D}/foo/sources/report.md`], D), '', 'a saved source is still work on its item');
});

test('AC-02: one block, no link, the block\'s own files -> the block', () => {
  assert.equal(itemForTurn(ONE, '', [OTHER], D), 'other');
  assert.equal(itemForTurn(ONE, '', [OTHER, `${D}/other/reviews/other-review.md`], D), 'other');
});

test('AC-03: code outside the docs folder, no files at all, or an unknown docs folder -> today\'s fallback', () => {
  assert.equal(itemForTurn(ONE, '', ['src/a.ts'], D), 'other');
  assert.equal(itemForTurn(ONE, '', ['/elsewhere/x.md'], D), 'other');
  assert.equal(itemForTurn(ONE, '', [], D), 'other', 'commands only');
  assert.equal(itemForTurn(ONE, '', [FOO], ''), 'other', 'docs folder not known');
  assert.equal(itemForTurn(ONE, '', [FOO, 'src/a.ts'], D), 'other', 'only the files of another item decide: a code file keeps the fallback');
});

test('Q-3: files of the block and of another item together -> the block', () => {
  assert.equal(itemForTurn(ONE, '', [FOO, OTHER], D), 'other');
  assert.equal(itemForTurn(ONE, '', [OTHER, FOO], D), 'other');
});

test('Q-5: a file directly in the docs folder (the index) is no item folder -> the fallback stays', () => {
  assert.equal(itemForTurn(ONE, '', [`${D}/README.md`], D), 'other');
  assert.equal(itemForTurn(ONE, '', [`${D}/README.md`, FOO], D), 'other');
  assert.equal(itemForTurn(ONE, '', [`${D}-old/foo/x.md`], D), 'other', 'a sibling folder with the same prefix is outside the docs folder');
});

test('AC-04: a live link always wins, whatever the turn wrote', () => {
  assert.equal(itemForTurn(ONE, 'other', [FOO], D), 'other');
  assert.equal(itemForTurn(TWO, 'beta', [FOO], D), 'beta');
  assert.equal(itemForTurn(TWO, 'beta', [OTHER], D), 'beta');
});

test('AC-05: several blocks with no link, a stale link, or no block -> as itemResolved', () => {
  assert.equal(itemForTurn(TWO, '', [FOO], D), '');
  assert.equal(itemForTurn(TWO, '', [OTHER], D), '', 'several blocks: never silently the first');
  assert.equal(itemForTurn(TWO, 'closed', [FOO], D), '');
  assert.equal(itemForTurn('', '', [FOO], D), '', 'no block');
  assert.equal(itemForTurn('## Now\n', '', ['src/a.ts'], D), '');
  // one block and a stale link: the fallback rule decides, with the turn's files
  assert.equal(itemForTurn(ONE, 'closed', [FOO], D), '');
  assert.equal(itemForTurn(ONE, 'closed', ['src/a.ts'], D), 'other');
});

test('a folder names the block as the link rules do: the full id, the number or the plain slug', () => {
  const NUMBERED = '### 012-other\n- **Route:** change / bounded\n';
  assert.equal(itemForTurn(NUMBERED, '', [`${D}/012-other/012-other-story.md`], D), '012-other');
  assert.equal(itemForTurn(NUMBERED, '', [`${D}/other/other-story.md`], D), '012-other', 'the plain slug finds the numbered block');
  assert.equal(itemForTurn(NUMBERED, '', [`${D}/12/x.md`], D), '012-other', 'the number finds it too');
  assert.equal(itemForTurn(NUMBERED, '', [`${D}/013-foo/013-foo-story.md`], D), '', 'another number, another item');
  assert.equal(itemForTurn(ONE, '', [`${D}/012-other/012-other-story.md`], D), '', 'a numbered folder is not the old unnumbered block');
});

test('AC-07: itemResolved is unchanged, and no hook without turn files uses the new helper', () => {
  assert.equal(itemResolved(ONE, ''), 'other', 'one block, no link: still that block');
  assert.equal(itemResolved(ONE, 'closed'), 'other');
  assert.equal(itemResolved(TWO, ''), '');
  const text = (name: string): string => readFileSync(new URL(`../../../src/hooks/core/${name}.mts`, import.meta.url), 'utf8');
  for (const name of ['session-gates', 'understanding', 'skill-line', 'pre-edit-skill', 'prompt-router']) {
    assert.doesNotMatch(text(name), /itemForTurn|turnEditFiles/, `${name} keeps itemResolved`);
  }
});

const ctxOf = (turn: unknown, project = '/p'): Ctx => ({ ev: parseEvent(JSON.stringify({ turn }))!, cfg: {}, project, env: {} });

test('turnEditFiles: the project-relative files of the edit steps, nothing else', () => {
  const steps = [
    { kind: 'edit', file: '/p/.burhan/work/foo/foo-story.md' }, { kind: 'cmd', cmd: 'ls' }, { kind: 'read', file: '/p/z' },
    { kind: 'edit', file: '/elsewhere/x.md' }, { kind: 'edit', file: '' }, { kind: 'edit', file: 'src/./a.ts' }, null, 'x',
  ];
  assert.deepEqual(turnEditFiles(ctxOf({ steps, files_edited: ['/p/ignored.md'] })), ['.burhan/work/foo/foo-story.md', '/elsewhere/x.md', 'src/a.ts']);
  assert.deepEqual(turnEditFiles(ctxOf({ steps: [{ kind: 'cmd', cmd: 'ls' }], files_edited: ['/p/ignored.md'] })), [], 'steps without an edit: no files');
});

test('turnEditFiles: a turn with no steps falls back to its created and edited files; no turn, no files', () => {
  assert.deepEqual(turnEditFiles(ctxOf({ files_created: ['/p/a/b.md'], files_edited: ['/p/c.md'], steps: [] })), ['a/b.md', 'c.md']);
  assert.deepEqual(turnEditFiles(ctxOf({ files_created: ['/p/a/b.md'] })), ['a/b.md'], 'no steps key');
  assert.deepEqual(turnEditFiles(ctxOf(undefined)), []);
  assert.deepEqual(turnEditFiles(ctxOf('text')), []);
});
