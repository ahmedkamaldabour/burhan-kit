import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cli, planFile, project, projectWithItem, read } from './item-fixture.js';
import { deviations, rowCells, traceUnit, untracedDeviations, withDeviationResolved, withDeviationRow, withDeviationTrace } from '../src/hooks/core/item-model.mjs';

// Tests run from .test-build/test, so the repository root is two levels up.
const TEMPLATE = readFileSync(fileURLToPath(new URL('../../kit/templates/plan.md', import.meta.url)), 'utf8');
const OWNER = 'dev-dabour';
const HEADER = '| # | Sub-unit | What | Where | Output | Status | Decision | Carried out in |';
const SEP7 = '|---|----------|------|-------|--------|--------|----------|';
const SEP8 = `${SEP7}${'-'.repeat('Carried out in'.length)}|`;

/** A project whose plan is approved and being built (two sub-units): the state a deviation can happen in. */
async function building(): Promise<string> {
  const dir = await projectWithItem();
  await cli(dir, ['approve', 'story', 'foo', '--by', OWNER]);
  await cli(dir, ['approve', 'plan', 'foo', '--by', OWNER]);
  return dir;
}
const add = (dir: string, ...extra: string[]) => cli(dir, ['deviation', 'add', 'foo', '--unit', '1', '--what', 'a choice', '--where', 'src/a.ts:3', '--output', 'two ways', ...extra]);
const resolve = (dir: string, n: number, how: '--approved' | '--rejected') => cli(dir, ['deviation', 'resolve', 'foo', String(n), how, '--by', OWNER]);
const done = (dir: string, ...args: string[]) => cli(dir, ['deviation', 'done', 'foo', ...args]);
const rows = (dir: string) => deviations(read(planFile(dir)));
/** Adds one row and has the owner approve it: it is the last row of the table. */
async function approvedRow(dir: string): Promise<void> {
  await add(dir);
  await resolve(dir, rows(dir).length, '--approved');
}

test('the plan template and a new row have the eighth cell, and a new row reads with an empty trace (AC-01)', async () => {
  const template = TEMPLATE.split('\n');
  assert.ok(template.includes(HEADER));
  assert.ok(template.includes(SEP8));
  const dir = await building();
  await add(dir);
  const text = read(planFile(dir));
  assert.ok(text.split('\n').includes(HEADER)); // the plan made from the template
  const line = text.split('\n').find((l) => l.startsWith('| 1 | 1 |'))!;
  assert.equal(rowCells(line)!.length, 8);
  assert.deepEqual(rows(dir).map((d) => [d.n, d.status, d.trace]), [[1, 'open', '']]);
});

const OLD = [
  '## 10. Deviations',
  '',
  '| # | Sub-unit | What | Where | Output | Status | Decision |',
  SEP7,
  '| 1 | 1 | a count | spec:12 | tests 7 | **approved** | dev · 2026-11-08 — ok |',
  '| 2 | 1 | a choice | src/a.ts:3 | two ways | open | |',
  '',
].join('\n');

test('a row of the old seven-cell shape reads with an empty trace, and every writer keeps the cells it does not change (AC-01)', () => {
  assert.deepEqual(deviations(OLD).map((d) => [d.n, d.status, d.trace]), [[1, 'approved', ''], [2, 'open', '']]);
  const lines = (t: string): string[] => t.split('\n');
  // the trace writer: the header and the separator are widened, the traced row keeps its raw cells, the other row is not touched
  assert.deepEqual(lines(withDeviationTrace(OLD, 1, 2)!), [
    '## 10. Deviations',
    '',
    HEADER,
    SEP8,
    '| 1 | 1 | a count | spec:12 | tests 7 | **approved** | dev · 2026-11-08 — ok | unit:2 |',
    '| 2 | 1 | a choice | src/a.ts:3 | two ways | open | |',
    '',
  ]);
  // the row writer: a new row has eight cells, the others are not touched
  const added = withDeviationRow(OLD, { unit: 1, what: 'x', where: 'y', output: 'z' })!;
  assert.equal(added.n, 3);
  assert.deepEqual(lines(added.text).slice(2), [HEADER, SEP8, '| 1 | 1 | a count | spec:12 | tests 7 | **approved** | dev · 2026-11-08 — ok |', '| 2 | 1 | a choice | src/a.ts:3 | two ways | open | |', '| 3 | 1 | x | y | z | open |  |  |', '']);
  // the resolve writer keeps the trace cell empty and the rest as it was
  const resolved = withDeviationResolved(OLD, 2, 'approved', 'dev · 2026-11-09')!;
  assert.deepEqual(lines(resolved).slice(2), [HEADER, SEP8, '| 1 | 1 | a count | spec:12 | tests 7 | **approved** | dev · 2026-11-08 — ok |', '| 2 | 1 | a choice | src/a.ts:3 | two ways | approved | dev · 2026-11-09 |  |', '']);
  // a CRLF file keeps its line ends
  const crlf = withDeviationTrace(OLD.replace(/\n/g, '\r\n'), 1, 2)!;
  assert.ok(crlf.split('\n').slice(0, -1).every((l) => l.endsWith('\r')));
  assert.equal(deviations(crlf)[0]!.trace, 'unit:2');
  // a row that is not there
  assert.equal(withDeviationTrace(OLD, 9, 1), null);
});

test('deviation done writes the trace of an approved row, prints the row and the trace, and changes no other cell (AC-02)', async () => {
  const dir = await building();
  await approvedRow(dir);
  const before = rows(dir)[0]!;
  const r = await done(dir, '1', '--in', 'unit:2');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /deviation: row 1 \(sub-unit 1: a choice\) is carried out in unit:2/);
  assert.match(r.out, /your own claim/);
  const after = rows(dir)[0]!;
  assert.equal(after.trace, 'unit:2');
  assert.deepEqual({ ...after, trace: '' }, before);
});

test('deviation done refuses an open, a rejected and an applied row and says why (AC-02)', async () => {
  const dir = await building();
  await add(dir); // row 1 stays open
  await add(dir); // row 2 is rejected
  await resolve(dir, 2, '--rejected');
  await add(dir, '--apply', 'the spec counted six tests and the file has seven'); // row 3 is applied
  const before = read(planFile(dir));
  for (const [n, why] of [['1', /is open: the owner decides it first/], ['2', /is rejected: there is nothing to carry out/], ['3', /is applied: it was fixed before it was written/]] as const) {
    const r = await done(dir, n, '--in', 'unit:1');
    assert.equal(r.code, 2, n);
    assert.match(r.err, why);
  }
  assert.equal(read(planFile(dir)), before);
});

test('deviation done refuses a trace that is not unit:<N>, a missing sub-unit or row, and --by (AC-02)', async () => {
  const dir = await building();
  await approvedRow(dir);
  const before = read(planFile(dir));
  for (const bad of ['', 'unit', 'unit:', 'unit:x', 'step:1', 'unit:1 and more', '1', 'UNIT:1']) {
    const r = await done(dir, '1', '--in', bad);
    assert.equal(r.code, 2, `--in "${bad}"`);
    assert.match(r.err, /--in is needed, in the form unit:<N>/);
  }
  assert.match((await done(dir, '1')).err, /--in is needed, in the form unit:<N>/);
  assert.match((await done(dir, '1', '--in', 'unit:9')).err, /the plan has no Sub-unit 9/);
  assert.match((await done(dir, '7', '--in', 'unit:1')).err, /the Deviations table has no row 7/);
  assert.match((await done(dir, 'x', '--in', 'unit:1')).err, /needs the row number/);
  assert.match((await done(dir, '1', '--in', 'unit:1', '--by', OWNER)).err, /carries no owner's name/);
  assert.equal(read(planFile(dir)), before);
});

test('a trace is not overwritten (AC-02)', async () => {
  const dir = await building();
  await approvedRow(dir);
  assert.equal((await done(dir, '1', '--in', 'unit:1')).code, 0);
  const before = read(planFile(dir));
  const again = await done(dir, '1', '--in', 'unit:2');
  assert.equal(again.code, 2);
  assert.match(again.err, /row 1 already has a trace \(unit:1\): a trace is not overwritten/);
  assert.equal(read(planFile(dir)), before);
});

test('--in is only for deviation done; add and resolve write an empty trace (AC-09)', async () => {
  const dir = await building();
  await add(dir);
  const refused = await cli(dir, ['deviation', 'resolve', 'foo', '1', '--approved', '--by', OWNER, '--in', 'unit:1']);
  assert.equal(refused.code, 2);
  assert.match(refused.err, /--in is only for deviation done/);
  assert.equal(rows(dir)[0]!.status, 'open');
  assert.equal((await resolve(dir, 1, '--approved')).code, 0);
  assert.equal(rows(dir)[0]!.trace, '');
  const viaAdd = await cli(dir, ['deviation', 'add', 'foo', '--unit', '1', '--what', 'w', '--where', 'x', '--output', 'y', '--in', 'unit:1']);
  assert.equal(viaAdd.code, 2);
  assert.equal(rows(dir).length, 1);
  assert.match((await cli(dir, ['deviation', 'later', 'foo'])).err, /add, resolve or done, not "later"/);
});

test('burhan --help lists deviation done (AC-08)', async () => {
  const r = await cli(project(), ['--help']);
  assert.equal(r.code, 0);
  assert.match(r.out, /deviation done <slug> <n> --in unit:<N>/);
});

test('untracedDeviations: an approved row with no trace or with a trace that is not a sub-unit of the plan (AC-02, AC-06)', () => {
  const row = (n: number, status: string, trace: string): string => `| ${n} | 1 | w | x | y | ${status} | d | ${trace} |`;
  const plan = ['### Sub-unit 1 — a · ✅ Reviewed', '- **Covers:** AC-01', '', '## 10. Deviations', '', HEADER, SEP8,
    row(1, 'approved', ''), row(2, 'approved', 'unit:1'), row(3, 'approved', 'unit:9'), row(4, 'approved', 'done'), row(5, 'rejected', ''), row(6, 'applied', ''), row(7, 'open', ''), row(8, '**approved**', ''), ''].join('\n');
  assert.deepEqual(untracedDeviations(plan).map((d) => d.n), [1, 3, 4, 8]);
  assert.equal(traceUnit('unit:12'), 12);
  assert.equal(traceUnit('unit:'), null);
  assert.equal(traceUnit('unit:1x'), null);
});
