import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cli, planFile, projectWithItem, read, write } from './item-fixture.js';
import { addFinding, addQc, BY, OWNER, stripGateLine } from './findings-fixture.js';
import { stageOf } from '../src/hooks/core/item-stage.mjs';

/** Item foo at the stage "all sub-units reviewed": story approved, plan In progress, both sub-units Reviewed (each with a review section). */
async function reviewed(): Promise<string> {
  const dir = await projectWithItem();
  assert.equal((await cli(dir, ['approve', 'story', 'foo', '--by', OWNER])).code, 0);
  for (const n of [1, 2]) await cli(dir, ['review', 'add', 'foo', '--kind', 'review', '--unit', String(n), '--by', BY]);
  write(planFile(dir), read(planFile(dir)).replace(/^- \*\*Overall status:\*\* .*$/m, '- **Overall status:** In progress').replace(/· ⬜ Draft$/gm, '· ✅ Reviewed'));
  return dir;
}
const guide = (dir: string) => cli(dir, ['guide', 'foo']);

test('guide at "all sub-units reviewed" puts the open findings as ONE question with the ready commands, a recommendation, and says the owner answers (AC-05)', async () => {
  const dir = await reviewed();
  await addFinding(dir, 'review:1', 'Minor', 'src/a.ts:1 small');
  await addFinding(dir, 'review:2', 'Important', 'src/b.ts:2 medium');
  const r = await guide(dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^stage: all sub-units reviewed$/m);
  assert.match(r.out, /^next: the findings of the reviews are not all decided \(2 open\): put them to the owner as one question \(burhan finding list foo; the owner answers, not you\), record the answers with burhan finding decide, then tick the remaining gates/m);
  assert.match(r.out, /^QUESTION FOR THE OWNER — 2 findings have no decision\. Put them to the owner as ONE question and wait for the answer: the owner decides, you do not run the commands below for them/m);
  assert.match(r.out, /#1 Minor · review Sub-unit 1 · src\/a\.ts:1 small/);
  assert.match(r.out, /burhan finding decide foo 2 --fixed unit:2 --by <owner name>/);
  assert.match(r.out, /burhan finding decide foo 2 --accepted "<the owner's reason>" --by <owner name>/);
  assert.match(r.out, /recommendation: fix it now when it is in a change this item made/);
  assert.equal((r.out.match(/QUESTION FOR THE OWNER/g) ?? []).length, 1);
  assert.match(r.out.trimEnd().split('\n').pop()!, /^full run: /);
});

test('guide names a section with no table, and says nothing new once every finding has a decision (AC-05)', async () => {
  const dir = await reviewed();
  assert.match((await guide(dir)).out, /review Sub-unit 1 \(reviews\/foo-review\.md\) has neither a findings table nor "No findings\."/);
  await cli(dir, ['finding', 'add', 'foo', '--in', 'review:1', '--none']);
  await addFinding(dir, 'review:2', 'Minor', 'src/b.ts:2 small');
  await cli(dir, ['finding', 'decide', 'foo', '1', '--accepted', 'cosmetic', '--by', OWNER]);
  const done = await guide(dir);
  assert.match(done.out, /^next: tick the remaining gates \(burhan gate tick foo <gate>\), then burhan item finish foo$/m);
  assert.doesNotMatch(done.out, /QUESTION FOR THE OWNER|finding/);
});

test('guide of a plan with no Findings gate line puts the open findings as one question like any other, and the JSON keys are the same (AC-01)', async () => {
  const dir = await reviewed();
  stripGateLine(dir);
  await addFinding(dir, 'review:1', 'Minor', 'src/a.ts:1 small');
  const r = await guide(dir);
  assert.match(r.out, /QUESTION FOR THE OWNER/);
  const keys = Object.keys(JSON.parse((await cli(dir, ['guide', 'foo', '--json'])).out) as object).sort();
  assert.deepEqual(keys, ['authorized', 'fullRun', 'item', 'next', 'route', 'skill', 'stage', 'why']);
});

test('guide at "QC passed, not accepted" asks for the QC findings, and the plain acceptance step returns when they are decided (AC-09)', async () => {
  const dir = await reviewed();
  await cli(dir, ['finding', 'add', 'foo', '--in', 'review:1', '--none']);
  await cli(dir, ['finding', 'add', 'foo', '--in', 'review:2', '--none']);
  write(planFile(dir), read(planFile(dir)).replace(/^- \*\*Overall status:\*\* .*$/m, '- **Overall status:** Completed'));
  await addQc(dir, 'PASS');
  await addFinding(dir, 'qc', 'Minor', 'src/q.ts:7 a QC finding');
  const r = await guide(dir);
  assert.match(r.out, /^stage: QC passed, not accepted$/m);
  assert.match(r.out, /^next: the findings of the QC are not all decided \(1 open\): put them to the owner as one question \(burhan finding list foo; the owner answers, not you\), record the answers with burhan finding decide, then ask the owner to accept the QC: burhan approve qc foo --by <owner name>$/m);
  assert.match(r.out, /#1 Minor · QC · src\/q\.ts:7 a QC finding/);
  assert.match(r.out, /burhan finding decide foo 1 --fixed unit:<N> --by <owner name>/);
  await cli(dir, ['finding', 'decide', 'foo', '1', '--accepted', 'cosmetic', '--by', OWNER]);
  const after = await guide(dir);
  assert.match(after.out, /^next: ask the owner to accept the QC: burhan approve qc foo --by <owner name>$/m);
  assert.doesNotMatch(after.out, /QUESTION/);
});

test('stageOf is pure and the hooks do not pass the count: without it the answer is the old one', () => {
  const plan = '# P\n- **Route:** feature / bounded\n- **Overall status:** In progress\n- **Contract:** 1\n\n## 5. Sub-unit breakdown\n### Sub-unit 1 — a · ✅ Reviewed\n- **Covers:** AC-01\n';
  const story = '# S\n- **Route:** feature / bounded\n- **Status:** Approved — dev · 2026-10-27\n\n| AC-01 | x | y |\n';
  const at = (undecided?: { review: number; qc: number }) => stageOf({ slug: 'foo', route: 'feature / bounded', story, plan, findings: null, qc: null, spec: '# spec', ...(undecided === undefined ? {} : { undecided }) });
  assert.equal(at().next, 'tick the remaining gates (burhan gate tick foo <gate>), then burhan item finish foo');
  assert.equal(at({ review: 0, qc: 0 }).next, at().next);
  assert.match(at({ review: 3, qc: 0 }).next, /^the findings of the reviews are not all decided \(3 open\)/);
  assert.equal(at({ review: 3, qc: 0 }).stage, 'all sub-units reviewed');
  assert.equal(at({ review: 3, qc: 0 }).authorized, true);
});

test('guide names a Reviewed sub-unit that has no review section, with the command that adds it (Deviation 6, review Minor 14)', async () => {
  const dir = await projectWithItem();
  assert.equal((await cli(dir, ['approve', 'story', 'foo', '--by', OWNER])).code, 0);
  await cli(dir, ['review', 'add', 'foo', '--kind', 'review', '--unit', '1', '--by', BY]);
  write(planFile(dir), read(planFile(dir)).replace(/^- \*\*Overall status:\*\* .*$/m, '- **Overall status:** In progress').replace(/· ⬜ Draft$/gm, '· ✅ Reviewed'));
  const out = (await cli(dir, ['guide', 'foo'])).out;
  assert.match(out, /Sub-unit 2 is Reviewed but has no review section: burhan review add foo --kind review --unit 2/);
});

test('guide --json of a gated item with an open finding is one JSON document with no question text (Deviation 6, review Minor 16)', async () => {
  const dir = await reviewed();
  assert.equal((await addFinding(dir, 'review:1', 'Minor', 'src/a.ts:1 a')).code, 0);
  const out = (await cli(dir, ['guide', 'foo', '--json'])).out;
  assert.doesNotThrow(() => JSON.parse(out));
  assert.doesNotMatch(out, /QUESTION FOR THE OWNER/);
});
