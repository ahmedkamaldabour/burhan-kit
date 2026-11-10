import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cli, planFile, projectWithItem, read, setPlanStatus, write } from './item-fixture.js';
import { addFinding, OWNER, reviewFile, withReviews } from './findings-fixture.js';

const WHY = 'the spec counted six tests and the file has seven';
const apply = (dir: string, what = 'a count in the spec') => cli(dir, ['deviation', 'add', 'foo', '--unit', '1', '--what', what, '--where', 'spec:12', '--output', 'tests 7', '--apply', WHY]);
const open = (dir: string) => cli(dir, ['deviation', 'add', 'foo', '--unit', '1', '--what', 'a choice', '--where', 'src/a.ts:3', '--output', 'two ways']);

/** A project whose plan is approved and being built. */
async function building(): Promise<string> {
  const dir = await projectWithItem();
  await cli(dir, ['approve', 'story', 'foo', '--by', OWNER]);
  await cli(dir, ['approve', 'plan', 'foo', '--by', OWNER]);
  return dir;
}

/** The plan where `item finish` can pass: In progress, every sub-unit Reviewed, every gate ticked (the proof is stated with --evidence). */
function readyToFinish(dir: string): void {
  setPlanStatus(dir, 'In progress');
  write(planFile(dir), read(planFile(dir)).replace(/· 🟡 Approved$/gm, '· ✅ Reviewed').replace(/- \[ \]/g, '- [x]'));
}

test('guide lists the rows the agent applied without asking, with where and why, and nothing when there are none (AC-17)', async () => {
  const dir = await building();
  assert.doesNotMatch((await cli(dir, ['guide', 'foo'])).out, /applied by the agent/);
  await apply(dir);
  const g = await cli(dir, ['guide', 'foo']);
  assert.match(g.out, /^deviations: applied by the agent without asking \(1\): row 1, sub-unit 1: a count in the spec — the spec counted six tests and the file has seven$/m);
  assert.match(g.out, /code edits: AUTHORIZED/);
  await apply(dir, `a very long wording ${'x'.repeat(200)}`);
  const two = (await cli(dir, ['guide', 'foo'])).out;
  assert.match(two, /applied by the agent without asking \(2\): row 1, sub-unit 1: a count in the spec — [^;]*; row 2, sub-unit 1: a very long wording x+… — /);
  assert.ok((two.split('\n').find((l) => l.startsWith('deviations:')) ?? '').length < 400);
  assert.match(two.trimEnd().split('\n').pop() ?? '', /^full run:/); // the last line is still the full-run line
});

test('an open row is not listed as applied; guide --json keeps its keys and stays one document (AC-17)', async () => {
  const dir = await building();
  await open(dir);
  const g = await cli(dir, ['guide', 'foo']);
  assert.doesNotMatch(g.out, /applied by the agent/);
  assert.match(g.out, /code edits: NOT authorized/);
  await apply(dir);
  const json = await cli(dir, ['guide', 'foo', '--json']);
  const doc = JSON.parse(json.out) as Record<string, unknown>;
  assert.deepEqual(Object.keys(doc), ['item', 'route', 'stage', 'authorized', 'why', 'next', 'skill', 'fullRun']);
  assert.doesNotMatch(json.out, /applied by the agent/);
});

test('item finish accepts approved, rejected and applied rows, prints the applied ones, and an open row still refuses it (AC-17)', async () => {
  const dir = await building();
  await apply(dir);
  await open(dir);
  await open(dir);
  await cli(dir, ['deviation', 'resolve', 'foo', '2', '--approved', '--by', OWNER]);
  readyToFinish(dir);
  const refused = await cli(dir, ['item', 'finish', 'foo', '--evidence', 'ran by hand']);
  assert.equal(refused.code, 2);
  assert.match(refused.err, /a deviation is open \(Deviations row 3\)/);
  assert.doesNotMatch(refused.err, /Deviations row 1/);
  await cli(dir, ['deviation', 'resolve', 'foo', '3', '--rejected', '--by', OWNER]);
  const done = await cli(dir, ['item', 'finish', 'foo', '--evidence', 'ran by hand']);
  assert.equal(done.code, 0, done.err);
  assert.match(done.out, /^item finish: applied by the agent without asking \(1\): row 1, sub-unit 1: a count in the spec — the spec counted six tests and the file has seven$/m);
  assert.match(read(planFile(dir)), /^- \*\*Overall status:\*\* Completed/m);
});

test('item finish prints no applied line when no row was applied (AC-17)', async () => {
  const dir = await building();
  await open(dir);
  await cli(dir, ['deviation', 'resolve', 'foo', '1', '--approved', '--by', OWNER]);
  readyToFinish(dir);
  const done = await cli(dir, ['item', 'finish', 'foo', '--evidence', 'ran by hand']);
  assert.equal(done.code, 0, done.err);
  assert.doesNotMatch(done.out, /applied by the agent/);
});

test('finding decide --fixed deviation:N takes an applied row as a fix; an open row is still refused (AC-17)', async () => {
  const dir = await withReviews([1]);
  await addFinding(dir, 'review:1', 'Minor', 'src/a.ts:1 minor');
  await addFinding(dir, 'review:1', 'Important', 'src/b.ts:2 important');
  setPlanStatus(dir, 'In progress');
  await apply(dir);
  await open(dir);
  const decide = (n: number, row: number) => cli(dir, ['finding', 'decide', 'foo', String(n), '--fixed', `deviation:${row}`, '--by', OWNER]);
  const refused = await decide(2, 2);
  assert.equal(refused.code, 2);
  assert.match(refused.err, /Deviations row 2 is open: only an approved row is a fix, or an applied one/);
  const ok = await decide(1, 1);
  assert.equal(ok.code, 0, ok.err);
  assert.match(read(reviewFile(dir)), /^\| 1 \| Minor \| src\/a\.ts:1 minor \| fixed \| deviation 1 \| dev-dabour · /m);
});

test('guide shows no control or bidi character of an applied row, and lists at most five rows then says how many more (sub-unit 11 review: Important 1, Minor 2)', async () => {
  const dir = await building();
  const bad = 'x\u001b[2K\u001b[1Ay\r‮z\u0085w';
  assert.equal((await cli(dir, ['deviation', 'add', 'foo', '--unit', '1', '--what', bad, '--where', 'spec:1', '--output', 'o', '--apply', `${bad} for a reason of words`])).code, 0);
  for (let i = 0; i < 6; i++) assert.equal((await apply(dir, `row ${i}`)).code, 0);
  const out = (await cli(dir, ['guide', 'foo'])).out;
  const line = out.split('\n').find((l) => l.startsWith('deviations: applied by the agent'));
  assert.ok(line !== undefined);
  assert.doesNotMatch(line, /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/);
  assert.match(line, /\(7\): /);
  assert.match(line, /and 2 more: see the Deviations table of the plan/);
});
