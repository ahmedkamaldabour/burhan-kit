import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkText } from '../src/hooks/core/item-contract.mjs';
import { cli, planFile, projectWithItem, read, write } from './item-fixture.js';
import { reviewsDecided } from './findings-fixture.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OWNER = 'dev-dabour';
const WHY = 'the spec counted six tests and the file has seven';
const HEADER = '| # | Sub-unit | What | Where | Output | Status | Decision | Carried out in |';
const SEP8 = `|---|----------|------|-------|--------|--------|----------|${'-'.repeat('Carried out in'.length)}|`;

/** A project whose plan is approved and being built (two sub-units). */
async function building(): Promise<string> {
  const dir = await projectWithItem();
  await cli(dir, ['approve', 'story', 'foo', '--by', OWNER]);
  await cli(dir, ['approve', 'plan', 'foo', '--by', OWNER]);
  return dir;
}
const add = (dir: string, ...extra: string[]) => cli(dir, ['deviation', 'add', 'foo', '--unit', '1', '--what', 'a choice', '--where', 'src/a.ts:3', '--output', 'two ways', ...extra]);
const resolve = (dir: string, n: number, how: '--approved' | '--rejected') => cli(dir, ['deviation', 'resolve', 'foo', String(n), how, '--by', OWNER]);
const done = (dir: string, ...args: string[]) => cli(dir, ['deviation', 'done', 'foo', ...args]);
const finish = (dir: string) => cli(dir, ['item', 'finish', 'foo', '--evidence', 'ran by hand']);
/** Adds one row and has the owner approve it: it is the last row. */
async function approvedRow(dir: string, n: number): Promise<void> {
  await add(dir);
  await resolve(dir, n, '--approved');
}
/** The plan where `item finish` can pass: In progress, every sub-unit Reviewed, every gate ticked, every finding decided. */
async function readyToFinish(dir: string): Promise<void> {
  write(planFile(dir), read(planFile(dir)).replace(/^- \*\*Overall status:\*\* .*$/m, '- **Overall status:** In progress').replace(/· 🟡 Approved$/gm, '· ✅ Reviewed').replace(/- \[ \]/g, '- [x]'));
  await reviewsDecided(dir);
}

test('item finish refuses an approved row with no trace, names each row and the command, and writes nothing; once every row is traced it finishes (AC-03, AC-04)', async () => {
  const dir = await building();
  await approvedRow(dir, 1);
  await approvedRow(dir, 2);
  await readyToFinish(dir);
  const before = read(planFile(dir));
  const refused = await finish(dir);
  assert.equal(refused.code, 2);
  assert.match(refused.err, /cannot finish foo: Deviations row 1 \(sub-unit 1\) is approved and has no trace of where it was carried out: run burhan deviation done foo 1 --in unit:<N>; Deviations row 2 \(sub-unit 1\) is approved and has no trace of where it was carried out: run burhan deviation done foo 2 --in unit:<N>/);
  assert.doesNotMatch(refused.err, /breaks the contract/);
  assert.equal(read(planFile(dir)), before);
  assert.equal((await done(dir, '1', '--in', 'unit:1')).code, 0);
  const one = await finish(dir);
  assert.equal(one.code, 2);
  assert.match(one.err, /Deviations row 2 \(sub-unit 1\) is approved and has no trace/);
  assert.doesNotMatch(one.err, /Deviations row 1/);
  assert.equal((await done(dir, '2', '--in', 'unit:2')).code, 0);
  const ok = await finish(dir);
  assert.equal(ok.code, 0, ok.err);
  assert.match(read(planFile(dir)), /^- \*\*Overall status:\*\* Completed/m);
});

test('a plan with only rejected or applied rows finishes with no trace (AC-04)', async () => {
  const dir = await building();
  await add(dir);
  await resolve(dir, 1, '--rejected');
  await add(dir, '--apply', WHY);
  await readyToFinish(dir);
  const r = await finish(dir);
  assert.equal(r.code, 0, r.err);
  assert.match(read(planFile(dir)), /^- \*\*Overall status:\*\* Completed/m);
});

test('item finish asks for the trace of an approved row even when the plan has no Contract line (AC-03, AC-07)', async () => {
  const dir = await building();
  await approvedRow(dir, 1);
  await readyToFinish(dir);
  write(planFile(dir), read(planFile(dir)).replace(/^- \*\*Contract:\*\* 1\n/m, ''));
  const r = await finish(dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /Deviations row 1 \(sub-unit 1\) is approved and has no trace/);
});

/** A small plan for the pure checks: the overall status, one status per sub-unit, and the rows of the Deviations table. */
const plan = (o: { overall: string; units: string[]; rows: string[] }): string => [
  '# T — Implementation Plan', '- **Route:** change / bounded', `- **Overall status:** ${o.overall}`, '- **Contract:** 1', '',
  '## 5. Sub-unit breakdown', ...o.units.flatMap((u, i) => [`### Sub-unit ${i + 1} — a · ${u}`, '- **Why separate:** A3', '']),
  '## 10. Deviations', '', HEADER, SEP8, ...o.rows, ''].join('\n');
const row = (n: number, status: string, trace: string): string => `| ${n} | 1 | w | x | y | ${status} | d | ${trace} |`;
const untraced = (text: string): string[] => checkText('plan', text).filter((f) => f.code === 'deviation-untraced').map((f) => f.message);

test('the check reports an untraced approved row only once every sub-unit is Reviewed or the plan is Completed (AC-05)', () => {
  const one = [row(1, 'approved', '')];
  assert.deepEqual(untraced(plan({ overall: 'In progress', units: ['🔵 In progress'], rows: one })), []);
  assert.deepEqual(untraced(plan({ overall: 'In progress', units: ['✅ Reviewed', '🟡 Approved'], rows: one })), []);
  assert.deepEqual(untraced(plan({ overall: 'In progress', units: [], rows: one })), []);
  const all = untraced(plan({ overall: 'In progress', units: ['✅ Reviewed', '✅ Reviewed'], rows: one }));
  assert.equal(all.length, 1);
  assert.match(all[0]!, /^Deviations row 1 \(sub-unit 1\) is approved and has no trace of where it was carried out: run burhan deviation done <slug> 1 --in unit:<N>$/);
  assert.equal(untraced(plan({ overall: 'Completed', units: ['🟡 Approved'], rows: one })).length, 1);
  assert.deepEqual(untraced(plan({ overall: 'Paused', units: ['🟡 Approved'], rows: one })), []);
});

test('a traced, a rejected, an applied and an open row give no deviation-untraced; a trace that is not a sub-unit of the plan does (AC-05, AC-06)', () => {
  const text = plan({ overall: 'Completed', units: ['✅ Reviewed', '✅ Reviewed'], rows: [row(1, 'approved', 'unit:2'), row(2, 'rejected', ''), row(3, 'applied', ''), row(4, 'open', ''), row(5, 'approved', 'unit:9'), row(6, 'approved', 'finished')] });
  const found = untraced(text);
  assert.equal(found.length, 2);
  assert.match(found[0]!, /^Deviations row 5 \(sub-unit 1\) is approved and its trace "unit:9" is not unit:<N> of a sub-unit of the plan: correct the Carried out in cell to unit:<N>/);
  assert.match(found[1]!, /^Deviations row 6 \(sub-unit 1\) is approved and its trace "finished" is not unit:<N>/);
  // the check reads the form only: a trace of a sub-unit that exists is accepted, whatever was or was not done
  assert.deepEqual(untraced(plan({ overall: 'Completed', units: ['✅ Reviewed'], rows: [row(1, 'approved', 'unit:1')] })), []);
});

/** The plan with every sub-unit Reviewed and In progress (no review files are needed: `item check` does not ask for them). */
function allReviewed(dir: string): void {
  write(planFile(dir), read(planFile(dir)).replace(/^- \*\*Overall status:\*\* .*$/m, '- **Overall status:** In progress').replace(/· 🟡 Approved$/gm, '· ✅ Reviewed'));
}

test('item check names the untraced row: a fault with the Contract line, advice without it, and deviation done clears it (AC-05, AC-07)', async () => {
  const dir = await building();
  await approvedRow(dir, 1);
  const building_ = await cli(dir, ['item', 'check', 'foo']); // sub-units not Reviewed yet: quiet
  assert.equal(building_.code, 0, building_.out);
  assert.doesNotMatch(building_.out, /deviation-untraced/);
  allReviewed(dir);
  const fault = await cli(dir, ['item', 'check', 'foo']);
  assert.equal(fault.code, 1);
  assert.match(fault.out, /foo-implementation-plan\.md \(plan\)\n(  .*\n)*  deviation-untraced: Deviations row 1 \(sub-unit 1\) is approved and has no trace/);
  assert.match(fault.out, /burhan deviation done <slug> 1 --in unit:<N>/);
  const withLine = read(planFile(dir));
  write(planFile(dir), withLine.replace(/^- \*\*Contract:\*\* 1\n/m, ''));
  const legacy = await cli(dir, ['item', 'check', 'foo']);
  assert.equal(legacy.code, 0, legacy.out);
  assert.match(legacy.out, /foo-implementation-plan\.md \(plan, legacy: no \*\*Contract:\*\* 1, so advice only\)/);
  assert.match(legacy.out, /deviation-untraced/);
  write(planFile(dir), withLine);
  assert.equal((await done(dir, '1', '--in', 'unit:1')).code, 0);
  const clean = await cli(dir, ['item', 'check', 'foo']);
  assert.equal(clean.code, 0, clean.out);
  assert.doesNotMatch(clean.out, /deviation-untraced/);
});

test('the kit text names deviation done, the trace form and who judges that the change was carried out (AC-06, AC-08)', () => {
  const kit = (name: string): string => readFileSync(join(ROOT, 'kit', name), 'utf8').replace(/\s+/g, ' ');
  const stagePlan = kit('phases/stage-plan.md');
  const stageBuild = kit('phases/stage-build.md');
  const template = kit('templates/plan.md');
  assert.ok(stagePlan.includes('`burhan deviation done <slug> <n> --in unit:<N>` writes the sub-unit that carried it out'));
  assert.ok(stagePlan.includes('`burhan item finish` refuses a plan that has an approved row with no trace'));
  assert.ok(stagePlan.includes('whether the change was really carried out is judged by the sub-unit reviewer and by the owner'));
  assert.ok(stageBuild.includes('the trace says where, not whether'));
  assert.ok(template.includes('An approved row also says in `Carried out in` which sub-unit carried it out'));
  assert.ok(template.includes('write where with `burhan deviation done <slug> <n> --in unit:<N>`'));
  // what must not change: the status words and the gate line
  assert.ok(template.includes('Status is open, approved, rejected or applied.'));
  assert.ok(template.includes('- [ ] No open deviation: every row of the Deviations table is approved, rejected or applied (an applied row says why no decision was needed)'));
});
