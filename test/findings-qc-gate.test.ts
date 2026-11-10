import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cli, projectWithItem, read } from './item-fixture.js';
import { addFinding, addQc, BY, OWNER, qcFile, reviewFile, stripGateLine } from './findings-fixture.js';

const accept = (dir: string) => cli(dir, ['approve', 'qc', 'foo', '--by', OWNER]);
const accepted = (dir: string): boolean => /^- \*\*Accepted by:\*\* dev-dabour · \d{4}-\d{2}-\d{2}$/m.test(read(qcFile(dir)));

test('approve qc refuses a QC report with no findings table or "No findings.", and accepts it once it says so (AC-01, AC-09)', async () => {
  const dir = await projectWithItem();
  await addQc(dir, 'PASS');
  const r = await accept(dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /cannot accept the QC: findings are not all decided: QC \(reviews\/foo-qc\.md\) has neither a findings table nor "No findings\." \(burhan finding add foo --in qc --none/);
  assert.equal(accepted(dir), false);
  assert.equal((await cli(dir, ['finding', 'add', 'foo', '--in', 'qc', '--none'])).code, 0);
  const ok = await accept(dir);
  assert.equal(ok.code, 0, ok.err);
  assert.equal(accepted(dir), true);
});

test('an undecided QC finding stops the acceptance, of any severity, until the owner decides it; the QC stays "passed, not accepted" (AC-09)', async () => {
  const dir = await projectWithItem();
  await addQc(dir, 'PASS');
  await addFinding(dir, 'qc', 'Minor', 'src/a.ts:1 small');
  await addFinding(dir, 'qc', 'Critical', 'src/b.ts:2 big');
  const r = await accept(dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /2 without a decision \(#1 Minor, #2 Critical\)/);
  assert.equal((await cli(dir, ['finding', 'decide', 'foo', '2', '--accepted', 'a long and honest reason', '--by', OWNER])).code, 2); // a Critical is never accepted
  assert.equal((await accept(dir)).code, 2);
  await cli(dir, ['finding', 'decide', 'foo', '1', '--accepted', 'cosmetic', '--by', OWNER]);
  await cli(dir, ['finding', 'decide', 'foo', '2', '--fixed', 'unit:1', '--by', OWNER]);
  assert.equal((await accept(dir)).code, 0);
});

test('a confirmation round: the findings of the earlier FAIL round are decided too, and a FAIL is still not accepted (AC-09)', async () => {
  const dir = await projectWithItem();
  await addQc(dir, 'FAIL — 1 issue');
  await addFinding(dir, 'qc', 'Important', 'src/a.ts:1 the issue');
  await addQc(dir, 'PASS', 2);
  await cli(dir, ['finding', 'add', 'foo', '--in', 'qc', '--none']);
  const r = await accept(dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /1 without a decision \(#1 Important\)/);
  await cli(dir, ['finding', 'decide', 'foo', '1', '--fixed', 'unit:1', '--by', OWNER]);
  assert.equal((await accept(dir)).code, 0);
  const failed = await projectWithItem();
  await addQc(failed, 'FAIL — 1 issue');
  await cli(failed, ['finding', 'add', 'foo', '--in', 'qc', '--none']);
  assert.match((await accept(failed)).err, /the QC verdict is not PASS/);
});

test('the review\'s findings do not block the QC acceptance (they gate item finish), and a plan with no gate line is gated too (AC-01, AC-09)', async () => {
  const dir = await projectWithItem();
  await cli(dir, ['review', 'add', 'foo', '--kind', 'review', '--unit', '1', '--by', BY]);
  await addFinding(dir, 'review:1', 'Minor', 'src/a.ts:1 open');
  await addQc(dir, 'PASS');
  await cli(dir, ['finding', 'add', 'foo', '--in', 'qc', '--none']);
  assert.match(read(reviewFile(dir)), /\| 1 \| Minor \|/);
  assert.equal((await accept(dir)).code, 0);
  const plain = await projectWithItem();
  stripGateLine(plain);
  await addQc(plain, 'PASS');
  const r = await accept(plain);
  assert.equal(r.code, 2);
  assert.match(r.err, /cannot accept the QC: findings are not all decided/);
  assert.equal(accepted(plain), false);
});
