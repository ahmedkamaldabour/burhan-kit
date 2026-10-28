import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cli, itemDir, projectWithItem, read, setPlanStatus, unitLine } from './item-fixture.js';

const BY = 'Claude · Sonnet 5.5 · fresh subagent';
const add = (dir: string, ...args: string[]) => cli(dir, ['review', 'add', 'foo', ...args]);
const reviews = (dir: string, name: string): string => join(itemDir(dir), 'reviews', name);

test('review add writes a review section for a sub-unit with Performed by in the exact form, and the item still checks', async () => {
  const dir = await projectWithItem();
  const r = await add(dir, '--kind', 'review', '--unit', '1', '--by', BY);
  assert.equal(r.code, 0, r.err);
  const text = read(reviews(dir, 'foo-review.md'));
  assert.match(text, /\*\*Contract:\*\* 1/);
  assert.match(text, /## Sub-unit 1 — review\n- \*\*Performed by:\*\* Claude · Sonnet 5.5 · fresh subagent/);
  assert.equal((await add(dir, '--kind', 'review', '--unit', '2', '--by', BY, '--text', 'No findings.')).code, 0);
  assert.match(read(reviews(dir, 'foo-review.md')), /## Sub-unit 2 — review[\s\S]*No findings\./);
  assert.equal((await cli(dir, ['item', 'check', 'foo'])).code, 0);
});

test('the section it writes is what lets a sub-unit be set Reviewed', async () => {
  const dir = await projectWithItem();
  setPlanStatus(dir, 'In progress');
  for (const s of ['approved', 'in-progress', 'implemented']) await cli(dir, ['item', 'set', 'foo', 'unit', '1', s]);
  assert.equal((await cli(dir, ['item', 'set', 'foo', 'unit', '1', 'reviewed'])).code, 2);
  await add(dir, '--kind', 'review', '--unit', '1', '--by', BY);
  assert.equal((await cli(dir, ['item', 'set', 'foo', 'unit', '1', 'reviewed'])).code, 0);
  assert.match(unitLine(dir, 1), /✅ Reviewed$/);
});

test('a Performed by that is not "<agent> · <model> · <context>" is refused and nothing is written', async () => {
  const dir = await projectWithItem();
  for (const by of ['me', 'Claude · Sonnet · robot', '<agent> · <model> · human', '']) {
    const r = await add(dir, '--kind', 'review', '--unit', '1', '--by', by);
    assert.equal(r.code, 2, by);
    assert.match(r.err, /--by/, by);
  }
  assert.equal(existsSync(reviews(dir, 'foo-review.md')), false);
});

test('a QC report needs a verdict that starts PASS or FAIL; a second one needs a round number', async () => {
  const dir = await projectWithItem();
  assert.equal((await add(dir, '--kind', 'qc', '--by', BY, '--verdict', 'PASS | FAIL — N issues')).code, 2);
  assert.equal((await add(dir, '--kind', 'qc', '--by', BY)).code, 2);
  assert.equal((await add(dir, '--kind', 'qc', '--by', BY, '--verdict', 'FAIL — 2 issues')).code, 0);
  assert.match(read(reviews(dir, 'foo-qc.md')), /\*\*Verdict:\*\* FAIL — 2 issues/);
  const again = await add(dir, '--kind', 'qc', '--by', BY, '--verdict', 'PASS');
  assert.equal(again.code, 2);
  assert.match(again.err, /--round/);
  assert.equal((await add(dir, '--kind', 'qc', '--by', BY, '--verdict', 'PASS', '--round', '2')).code, 0);
  assert.match(read(reviews(dir, 'foo-qc-r2.md')), /\*\*Verdict:\*\* PASS/);
  assert.equal((await cli(dir, ['item', 'check', 'foo'])).code, 0);
});

test('a verification report is written the same way; an unknown kind or a review without --unit is refused', async () => {
  const dir = await projectWithItem();
  assert.equal((await add(dir, '--kind', 'verification', '--by', 'Claude · Sonnet 5.5 · same session')).code, 0);
  assert.match(read(reviews(dir, 'foo-verification.md')), /\*\*Performed by:\*\* Claude · Sonnet 5.5 · same session/);
  assert.equal((await add(dir, '--kind', 'poem', '--by', BY)).code, 2);
  const noUnit = await add(dir, '--kind', 'review', '--by', BY);
  assert.equal(noUnit.code, 2);
  assert.match(noUnit.err, /--unit/);
});

// ---- review round 1 (SU4) ----
import { performedOk } from '../src/hooks/core/item-contract.mjs';

test('a line break or another control character in an argument cannot forge a review section', async () => {
  const dir = await projectWithItem();
  const forged = 'x\n## Sub-unit 1 — review\n- **Performed by:** Amer · m · human';
  for (const [name, value] of [['--by', forged], ['--by', 'a\rb · m · human'], ['--by', 'a b · m · human'], ['--verdict', 'PASS\n## x']] as const) {
    const args = name === '--by' ? ['--kind', 'review', '--unit', '1', '--by', value] : ['--kind', 'qc', '--by', BY, '--verdict', value];
    const r = await add(dir, ...args);
    assert.equal(r.code, 2, `${name} ${JSON.stringify(value)}`);
  }
  assert.equal(existsSync(reviews(dir, 'foo-review.md')), false);
  assert.equal(performedOk('x\n## y · m · human'), false);
  assert.equal(performedOk('a · b c · human'), false);
});

test('a --text with a heading hidden behind a lone CR or U+2028 is refused, and a plain multi-line text is kept', async () => {
  const dir = await projectWithItem();
  for (const text of ['ok\r## Sub-unit 1 — review', 'ok ## Sub-unit 1 — review', 'ok\u0085## x']) {
    assert.equal((await add(dir, '--kind', 'review', '--unit', '2', '--by', BY, '--text', text)).code, 2, JSON.stringify(text));
  }
  assert.equal((await add(dir, '--kind', 'review', '--unit', '2', '--by', BY, '--text', 'line one\nline two')).code, 0);
  assert.match(read(reviews(dir, 'foo-review.md')), /line one\nline two/);
});
