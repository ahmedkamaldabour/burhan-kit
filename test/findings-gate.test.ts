import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cli, planFile, projectWithItem, read, storyFile, specFile, write } from './item-fixture.js';
import { addFinding, addGateLine, BY, OWNER, reviewFile, stripGateLine } from './findings-fixture.js';

/** An item that is finished except for its findings: plan In progress, both sub-units Reviewed (each with a review section written by `review add`), every box ticked.
 *  No hook ledger and no record: the finish is asked with --evidence, which only states a proof. */
async function ready(): Promise<string> {
  const dir = await projectWithItem();
  for (const n of [1, 2]) assert.equal((await cli(dir, ['review', 'add', 'foo', '--kind', 'review', '--unit', String(n), '--by', BY, '--text', 'checked the diff'])).code, 0);
  write(planFile(dir), read(planFile(dir)).replace(/^- \*\*Overall status:\*\* .*$/m, '- **Overall status:** In progress').replace(/· ⬜ Draft$/gm, '· ✅ Reviewed').replace(/- \[ \]/g, '- [x]'));
  return dir;
}
const finish = (dir: string) => cli(dir, ['item', 'finish', 'foo', '--evidence', 'ran the proof by hand']);
const none = async (dir: string): Promise<void> => { for (const n of [1, 2]) await cli(dir, ['finding', 'add', 'foo', '--in', `review:${n}`, '--none']); };

test('item new writes no Findings gate line: the plan has the Overall status and Contract lines only, and the new item checks (AC-02)', async () => {
  const dir = await projectWithItem();
  assert.match(read(planFile(dir)), /^- \*\*Overall status:\*\* Draft\n- \*\*Contract:\*\* 1\n(?!- \*\*Findings gate)/m);
  for (const f of [planFile(dir), storyFile(dir), specFile(dir)]) assert.doesNotMatch(read(f), /Findings gate/);
  assert.equal((await cli(dir, ['item', 'check', 'foo'])).code, 0);
});

test('item finish refuses a new item whose reviewed sub-units have no findings table or "No findings.", and names the command (AC-01, AC-02)', async () => {
  const dir = await ready();
  const r = await finish(dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /cannot finish foo: findings are not all decided: /);
  assert.match(r.err, /review Sub-unit 1 \(reviews\/foo-review\.md\) has neither a findings table nor "No findings\."/);
  assert.match(r.err, /review Sub-unit 2 /);
  assert.match(r.err, /burhan finding list foo puts the question to the owner; the owner decides, never --evidence/);
  assert.match(read(planFile(dir)), /Overall status:\*\* In progress/);
});

test('with "No findings." in every section the item finishes (AC-01, AC-02)', async () => {
  const dir = await ready();
  await none(dir);
  const r = await finish(dir);
  assert.equal(r.code, 0, r.err);
  assert.match(read(planFile(dir)), /Overall status:\*\* Completed/);
});

test('an undecided finding of any severity refuses the finish, and --evidence does not clear it (AC-02)', async () => {
  for (const severity of ['Minor', 'Important', 'Critical']) {
    const dir = await ready();
    await none(dir);
    await cli(dir, ['finding', 'add', 'foo', '--in', 'review:1', '--none']);
    await cli(dir, ['review', 'add', 'foo', '--kind', 'review', '--unit', '2', '--by', BY]); // a re-review: its own, later section
    await addFinding(dir, 'review:2', severity, 'src/a.ts:1 something');
    const r = await finish(dir);
    assert.equal(r.code, 2, severity);
    assert.match(r.err, new RegExp(`1 without a decision \\(#1 ${severity}\\)`), severity);
  }
});

test('each decision of the owner clears its finding: fixed, discovery, accepted (AC-02, AC-03)', async () => {
  const dir = await ready();
  mkdirSync(join(dir, '.burhan', 'discovery'), { recursive: true });
  writeFileSync(join(dir, '.burhan', 'discovery', 'd.md'), '# d\n');
  await addFinding(dir, 'review:1', 'Minor', 'src/a.ts:1 a');
  await addFinding(dir, 'review:1', 'Minor', 'src/a.ts:2 b');
  await addFinding(dir, 'review:1', 'Important', 'src/a.ts:3 c');
  await cli(dir, ['finding', 'add', 'foo', '--in', 'review:2', '--none']);
  assert.match((await finish(dir)).err, /3 without a decision \(#1 Minor, #2 Minor, #3 Important\)/);
  await cli(dir, ['finding', 'decide', 'foo', '1', '--fixed', 'unit:1', '--by', OWNER]);
  assert.match((await finish(dir)).err, /2 without a decision \(#2 Minor, #3 Important\)/);
  await cli(dir, ['finding', 'decide', 'foo', '2', '--discovery', 'd.md', '--by', OWNER]);
  await cli(dir, ['finding', 'decide', 'foo', '3', '--accepted', 'the repeated check is on purpose, for the audit', '--by', OWNER]);
  const r = await finish(dir);
  assert.equal(r.code, 0, r.err);
});

test('a malformed row refuses the finish with its file and line; item check names it too (AC-10)', async () => {
  const dir = await ready();
  await none(dir);
  write(reviewFile(dir), read(reviewFile(dir)).replace('No findings.', '| # | Severity | Finding (file:line) | Decision | Pointer or reason | Decided by |\n|---|---|---|---|---|---|\n| 1 | Minor | src/a.ts:1 x | fixed |  |  |'));
  const line = read(reviewFile(dir)).split('\n').findIndex((l) => l.startsWith('| 1 | Minor')) + 1;
  const r = await finish(dir);
  assert.equal(r.code, 2);
  assert.match(r.err, new RegExp(`malformed row reviews/foo-review\\.md:${line} \\(finding 1: the decision fixed has no pointer or reason\\)`));
  const check = await cli(dir, ['item', 'check', 'foo']);
  assert.equal(check.code, 1);
  assert.match(check.out, new RegExp(`finding-row: line ${line}: finding 1: the decision fixed has no pointer or reason`));
});

test('a Reviewed sub-unit with no review section stops the finish; an earlier section of a re-reviewed sub-unit does not (AC-01)', async () => {
  const dir = await ready();
  write(reviewFile(dir), read(reviewFile(dir)).replace(/\n## Sub-unit 2 — review[\s\S]*$/, '\n'));
  assert.match((await finish(dir)).err, /Sub-unit 2 has no review section/);
  const again = await ready();
  await cli(again, ['review', 'add', 'foo', '--kind', 'review', '--unit', '1', '--by', BY]); // a second section for Sub-unit 1; the first is superseded
  await cli(again, ['finding', 'add', 'foo', '--in', 'review:1', '--none']);
  await cli(again, ['finding', 'add', 'foo', '--in', 'review:2', '--none']);
  assert.equal((await finish(again)).code, 0);
});

test('a plan with no Findings gate line is gated like any other: item finish refuses a Reviewed sub-unit with no table, and a malformed row is an item check fault (AC-01)', async () => {
  const dir = await ready();
  stripGateLine(dir);
  assert.doesNotMatch(read(planFile(dir)), /Findings gate/);
  const r = await finish(dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /cannot finish foo: findings are not all decided: /);
  assert.match(r.err, /review Sub-unit 1 \(reviews\/foo-review\.md\) has neither a findings table nor "No findings\."/);
  await none(dir);
  write(reviewFile(dir), read(reviewFile(dir)).replace('No findings.', '| # | Severity | Finding (file:line) | Decision | Pointer or reason | Decided by |\n|---|---|---|---|---|---|\n| 1 | Minor | src/a.ts:1 x | fixed |  |  |'));
  const line = read(reviewFile(dir)).split('\n').findIndex((l) => l.startsWith('| 1 | Minor')) + 1;
  const check = await cli(dir, ['item', 'check', 'foo']);
  assert.equal(check.code, 1);
  assert.match(check.out, new RegExp(`finding-row: line ${line}: finding 1: the decision fixed has no pointer or reason`));
});

test('a plan that still has the old line "- **Findings gate:** on" is harmless: it behaves like a plan without it, and item check does not fault it (AC-04)', async () => {
  const plain = await ready();
  stripGateLine(plain);
  const old = await ready();
  addGateLine(old);
  assert.match(read(planFile(old)), /^- \*\*Findings gate:\*\* on$/m);
  const a = await finish(plain);
  const b = await finish(old);
  assert.equal(a.code, 2);
  assert.equal(b.code, 2);
  assert.equal(b.err, a.err);
  await none(plain);
  await none(old);
  assert.equal((await finish(plain)).code, 0);
  assert.equal((await finish(old)).code, 0);
  const fresh = await projectWithItem();
  addGateLine(fresh);
  const check = await cli(fresh, ['item', 'check', 'foo']);
  assert.equal(check.code, 0, check.out);
  assert.doesNotMatch(check.out, /Findings gate/);
});

test('finding list says nothing about a gate being on or off, with no finding and with one (AC-05)', async () => {
  const dir = await ready();
  stripGateLine(dir);
  const empty = await cli(dir, ['finding', 'list', 'foo']);
  assert.equal(empty.code, 0, empty.err);
  assert.match(empty.out, /^finding list: foo — 0 findings, 0 without a decision\n/);
  assert.doesNotMatch(empty.out, /Findings gate|gate is (on|off)/);
  await addFinding(dir, 'review:1', 'Minor', 'src/a.ts:1 small');
  const one = await cli(dir, ['finding', 'list', 'foo']);
  assert.match(one.out, /^finding list: foo — 1 finding, 1 without a decision\n/);
  assert.doesNotMatch(one.out, /Findings gate|gate is (on|off)/);
});

test('the gate is the CLI\'s: no hook source reads the findings (AC-12)', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../../src/hooks/', import.meta.url));
  const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]));
  const sources = files(root).filter((f) => f.endsWith('.mjs') || f.endsWith('.mts'));
  assert.ok(sources.length > 10);
  for (const f of sources) assert.doesNotMatch(readFileSync(f, 'utf8'), /findings\.js|Findings gate/, f);
});
