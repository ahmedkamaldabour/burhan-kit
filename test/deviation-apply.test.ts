import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cli, planFile, projectWithItem, read, write } from './item-fixture.js';
import { stageOf } from '../src/hooks/core/item-stage.mjs';
import { deviations, openDeviations } from '../src/hooks/core/item-model.mjs';

/** A project whose plan is approved and being built (the state a deviation can happen in). */
async function building(): Promise<string> {
  const dir = await projectWithItem();
  await cli(dir, ['approve', 'story', 'foo', '--by', 'dev-dabour']);
  await cli(dir, ['approve', 'plan', 'foo', '--by', 'dev-dabour']);
  return dir;
}
const WHY = 'the spec counted six tests and the file has seven';
const apply = (dir: string, ...args: string[]) => cli(dir, ['deviation', 'add', 'foo', '--unit', '1', '--what', 'a count in the spec', '--where', 'spec:12', '--output', 'tests 7', '--apply', WHY, ...args]);
const open = (dir: string) => cli(dir, ['deviation', 'add', 'foo', '--unit', '1', '--what', 'a choice', '--where', 'src/a.ts:3', '--output', 'two ways']);
const rows = (dir: string) => deviations(read(planFile(dir)));

test('deviation add --apply writes an applied row with the reason and the date, and no owner name (AC-17)', async () => {
  const dir = await building();
  const r = await apply(dir);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(rows(dir).map((x) => [x.n, x.unit, x.status]), [[1, 1, 'applied']]);
  assert.match(rows(dir)[0]!.decision, new RegExp(`^applied by the agent · \\d{4}-\\d{2}-\\d{2} — ${WHY}$`));
  assert.match(r.out, /recorded as applied/);
  assert.match(r.out, /class A/);
  assert.doesNotMatch(r.out, /STOP/);
  assert.equal(openDeviations(read(planFile(dir))).length, 0);
  assert.equal((await cli(dir, ['item', 'check', 'foo'])).code, 0); // an applied row is a closed row: no deviation-open, no deviation-status
});

test('deviation add without --apply is still an open row, and its output is the class B instruction that also names --apply (AC-17)', async () => {
  const dir = await building();
  const r = await open(dir);
  assert.equal(r.code, 0, r.err);
  assert.equal(rows(dir)[0]!.status, 'open');
  assert.match(r.out, /class B/);
  assert.match(r.out, /STOP/);
  assert.match(r.out, /auto mode: stop and wait/);
  assert.match(r.out, /--apply "<why no decision is needed>"/);
});

test('--apply needs a reason of at least a sentence, takes no --by, and a refused call writes nothing (AC-17)', async () => {
  const dir = await building();
  const base = ['deviation', 'add', 'foo', '--unit', '1', '--what', 'x', '--where', 'y', '--output', 'z'];
  for (const args of [['--apply', ''], ['--apply', '  '], ['--apply', 'one'], ['--apply', 'two words'], ['--apply', WHY, '--by', 'dev-dabour']]) {
    const r = await cli(dir, [...base, ...args]);
    assert.equal(r.code, 2, args.join(' '));
  }
  assert.match((await cli(dir, [...base, '--apply', 'one'])).err, /--apply needs the reason no decision is needed/);
  assert.match((await cli(dir, [...base, '--apply', WHY, '--by', 'dev-dabour'])).err, /no owner's name/);
  assert.deepEqual(rows(dir), []);
  const draft = await projectWithItem();
  assert.match((await apply(draft)).err, /Approved or In progress/); // the same rule as an open row
});

test('a pipe and a line break in --apply stay in one cell, and the row reads back whole (AC-17)', async () => {
  const dir = await building();
  const r = await cli(dir, ['deviation', 'add', 'foo', '--unit', '1', '--what', 'x', '--where', 'y', '--output', 'z', '--apply', 'no choice | involved\nin this wording fix']);
  assert.equal(r.code, 0, r.err);
  assert.equal(rows(dir).length, 1);
  assert.match(rows(dir)[0]!.decision, /no choice \| involved in this wording fix$/);
  assert.equal(read(planFile(dir)).split('\n').filter((l) => /^\| 1 \|/.test(l)).length, 1);
});

test('an applied row does not stop guide or the gate; an open row after it still does; resolve is only for an open row (AC-17)', async () => {
  const dir = await building();
  await apply(dir);
  const g = await cli(dir, ['guide', 'foo']);
  assert.match(g.out, /code edits: AUTHORIZED/);
  assert.doesNotMatch(g.out, /stage: deviation open/);
  assert.equal((await cli(dir, ['deviation', 'resolve', 'foo', '1', '--approved', '--by', 'dev-dabour'])).code, 2);
  assert.match((await cli(dir, ['deviation', 'resolve', 'foo', '1', '--approved', '--by', 'dev-dabour'])).err, /row 1 is applied, not open/);
  await open(dir);
  const stopped = await cli(dir, ['guide', 'foo']);
  assert.match(stopped.out, /code edits: NOT authorized/);
  assert.match(stopped.out, /stage: deviation open/);
  assert.match(stopped.out, /Deviations row 2/);
  assert.doesNotMatch(stopped.out, /Deviations row 1[,\n]/);
  const refused = await cli(dir, ['gate', 'tick', 'foo', 'No open deviation']);
  assert.equal(refused.code, 2);
  assert.match(refused.err, /Deviations row 2 is open/);
  assert.equal((await cli(dir, ['deviation', 'resolve', 'foo', '2', '--rejected', '--by', 'dev-dabour'])).code, 0);
  assert.equal((await cli(dir, ['gate', 'tick', 'foo', 'No open deviation'])).code, 0); // approved, rejected and applied rows are all closed
});

test('stageOf: an applied row lets the build go on, an unreadable status still stops it (AC-17)', () => {
  const table = (status: string): string => `\n## 10. Deviations\n| # | Sub-unit | What | Where | Output | Status | Decision |\n|---|----------|------|-------|--------|--------|----------|\n| 1 | 1 | a count | spec | tests 7 | ${status} | applied by the agent · 2026-11-08 — the spec counted wrong |\n`;
  const plan = (dev: string): string => `# P\n- **Route:** feature / bounded\n- **Overall status:** In progress\n- **Contract:** 1\n\n## 5. Sub-unit breakdown\n### Sub-unit 1 — a · 🔵 In progress\n- **Covers:** AC-01\n${dev}`;
  const story = '# S\n- **Route:** feature / bounded\n- **Status:** Approved — dev · 2026-10-27\n\n| AC-01 | x | y |\n';
  const at = (p: string) => stageOf({ slug: 'foo', route: 'feature / bounded', story, plan: p, findings: null, qc: null, spec: '# spec' });
  assert.equal(at(plan(table('applied'))).authorized, true);
  assert.equal(at(plan(table('**applied**'))).authorized, true); // the same reading as approved: stars are not part of the status
  assert.equal(at(plan(table('applied?'))).authorized, false);
  assert.equal(at(plan(table('open'))).authorized, false);
});

test('item check names an applied row with no decision text, and a status that is none of the four (AC-17)', async () => {
  const dir = await building();
  await apply(dir);
  write(planFile(dir), read(planFile(dir)).replace(/\| applied by the agent[^|]*\|/, '|  |'));
  assert.match((await cli(dir, ['item', 'check', 'foo'])).out, /deviation-incomplete/);
  write(planFile(dir), read(planFile(dir)).replace('| applied |', '| maybe |'));
  const named = await cli(dir, ['item', 'check', 'foo']);
  assert.match(named.out, /deviation-status/);
  assert.match(named.out, /not open, approved, rejected or applied/);
});

test('a plan with the old gate wording ("approved or rejected by the owner") still ticks the gate, with an applied row too (AC-17)', async () => {
  const dir = await building();
  const oldLine = '- [ ] No open deviation: every row of the Deviations table is approved or rejected by the owner';
  write(planFile(dir), read(planFile(dir)).replace(/^- \[ \] No open deviation:.*$/m, oldLine));
  assert.equal((await apply(dir)).code, 0);
  assert.equal((await cli(dir, ['gate', 'tick', 'foo', 'No open deviation'])).code, 0);
  assert.match(read(planFile(dir)), /^- \[x\] No open deviation: every row of the Deviations table is approved or rejected by the owner$/m);
  const old = readFileSync(fileURLToPath(new URL('../../test/fixtures/old-gate-checklist.md', import.meta.url)), 'utf8');
  assert.match(old, /No open deviation: every row of the Deviations table is approved or rejected by the owner/);
});

test('a new item writes the new gate line and the template says the same; the row status words are listed in section 10 (AC-17)', async () => {
  const dir = await projectWithItem();
  const NEW = 'No open deviation: every row of the Deviations table is approved, rejected or applied (an applied row says why no decision was needed)';
  assert.ok(read(planFile(dir)).includes(`- [ ] ${NEW}`));
  const template = readFileSync(fileURLToPath(new URL('../../kit/templates/plan.md', import.meta.url)), 'utf8');
  assert.ok(template.includes(`- [ ] ${NEW}`));
  assert.match(template, /Empty until a step deviates\. Status is open, approved, rejected or applied\./);
});
