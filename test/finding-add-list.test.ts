import { test } from 'node:test';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { cli, read } from './item-fixture.js';
import { addFinding, addQc, qcFile, reviewFile, withReviews } from './findings-fixture.js';

test('finding add writes a Findings table under the sub-unit section and numbers the rows of the item (AC-01, AC-10)', async () => {
  const dir = await withReviews([1, 2]);
  const a = await addFinding(dir, 'review:1', 'Minor', 'src/a.ts:3 a helper repeats a check');
  assert.equal(a.code, 0, a.err);
  assert.match(a.out, /finding add: #1 Minor recorded under review Sub-unit 1 in reviews\/foo-review\.md; it has no decision yet/);
  assert.equal((await addFinding(dir, 'review:1', 'important', 'src/b.ts:9 a | pipe')).code, 0);
  assert.equal((await addFinding(dir, 'review:2', 'Critical', 'src/c.ts:1 c')).code, 0);
  const text = read(reviewFile(dir));
  assert.match(text, /## Sub-unit 1 — review\n[\s\S]*### Findings\n\n\| # \| Severity \| Finding \(file:line\) \| Decision \| Pointer or reason \| Decided by \|\n\|---[^\n]*\n\| 1 \| Minor \| src\/a\.ts:3 a helper repeats a check \|  \|  \|  \|\n\| 2 \| Important \| src\/b\.ts:9 a \\\| pipe \|  \|  \|  \|\n\n## Sub-unit 2 — review/);
  assert.match(text, /## Sub-unit 2 — review\n[\s\S]*\| 3 \| Critical \| src\/c\.ts:1 c \|/);
  assert.equal((await cli(dir, ['item', 'check', 'foo'])).code, 0);
});

test('finding add --none writes the line "No findings."; it is refused beside findings, and a later row replaces the line (AC-01)', async () => {
  const dir = await withReviews([1, 2]);
  const none = await cli(dir, ['finding', 'add', 'foo', '--in', 'review:1', '--none']);
  assert.equal(none.code, 0, none.err);
  assert.match(read(reviewFile(dir)), /### Findings\n\nNo findings\.\n/);
  assert.match((await cli(dir, ['finding', 'add', 'foo', '--in', 'review:1', '--none'])).out, /already says "No findings\."/);
  assert.equal((await addFinding(dir, 'review:1', 'Minor', 'src/a.ts:1 x')).code, 0);
  assert.doesNotMatch(read(reviewFile(dir)), /^No findings\.$/m);
  const refused = await cli(dir, ['finding', 'add', 'foo', '--in', 'review:1', '--none']);
  assert.equal(refused.code, 2);
  assert.match(refused.err, /already has findings/);
  const both = await cli(dir, ['finding', 'add', 'foo', '--in', 'review:2', '--none', '--text', 'x']);
  assert.equal(both.code, 2);
  assert.match(both.err, /--none stands alone/);
});

test('finding add refuses what it cannot place, and writes nothing (AC-10)', async () => {
  const dir = await withReviews([1]);
  const before = read(reviewFile(dir));
  const bad: Array<[string[], RegExp]> = [
    [['--in', 'nowhere', '--severity', 'Minor', '--text', 'x'], /--in is review:<unit> or qc\[:<round>\]/],
    [['--in', 'review:7', '--severity', 'Minor', '--text', 'x'], /no section for Sub-unit 7/],
    [['--in', 'review:1', '--severity', 'Huge', '--text', 'x'], /--severity is Critical, Important or Minor/],
    [['--in', 'review:1', '--severity', 'Minor'], /--text is needed/],
    [['--in', 'review:1', '--severity', 'Minor', '--text', 'two\nlines'], /one line/],
    [['--in', 'qc', '--severity', 'Minor', '--text', 'x'], /no QC report yet/],
    [['--in', 'qc:2', '--severity', 'Minor', '--text', 'x'], /no QC round 2 yet/],
  ];
  for (const [args, why] of bad) {
    const r = await cli(dir, ['finding', 'add', 'foo', ...args]);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.err, why, args.join(' '));
  }
  assert.equal(read(reviewFile(dir)), before);
  const fresh = await cli((await withReviews([])), ['finding', 'add', 'foo', '--in', 'review:1', '--severity', 'Minor', '--text', 'x']);
  assert.equal(fresh.code, 2);
  assert.match(fresh.err, /no review file yet/);
});

test('finding add writes into the latest QC report, or the round it names, and the numbering goes on across files (AC-01, AC-09)', async () => {
  const dir = await withReviews([1]);
  await addFinding(dir, 'review:1', 'Minor', 'src/a.ts:1 x');
  await addQc(dir, 'FAIL — 1 issue');
  const first = await addFinding(dir, 'qc', 'Important', 'src/b.ts:2 y');
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /#2 Important recorded under QC in reviews\/foo-qc\.md/);
  assert.match(read(qcFile(dir)), /\n\n## Findings\n\n\| # /);
  await addQc(dir, 'PASS', 2);
  assert.match((await addFinding(dir, 'qc', 'Minor', 'src/c.ts:3 z')).out, /#3 Minor recorded under QC round 2 in reviews\/foo-qc-r2\.md/);
  assert.match((await addFinding(dir, 'qc:1', 'Minor', 'src/d.ts:4 w')).out, /#4 Minor recorded under QC in reviews\/foo-qc\.md/);
  assert.equal((await cli(dir, ['item', 'check', 'foo'])).code, 0);
});

test('finding list shows the grouped question: each finding, the three ready commands, a recommendation, and no accepted for a Critical (AC-05 text, AC-08)', async () => {
  const dir = await withReviews([1, 2]);
  await addFinding(dir, 'review:1', 'Minor', 'src/a.ts:1 small');
  await addFinding(dir, 'review:2', 'Critical', 'src/b.ts:2 big');
  const r = await cli(dir, ['finding', 'list', 'foo']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /finding list: foo — 2 findings, 2 without a decision; the Findings gate is off/);
  assert.match(r.out, /QUESTION FOR THE OWNER — 2 findings have no decision\. Put them to the owner as ONE question and wait for the answer/);
  assert.match(r.out, /#1 Minor · review Sub-unit 1 · src\/a\.ts:1 small\n/);
  assert.match(r.out, /burhan finding decide foo 1 --fixed unit:1 --by <owner name>/);
  assert.match(r.out, /burhan finding decide foo 1 --discovery <discovery file> --by <owner name>\n/);
  assert.match(r.out, /burhan finding decide foo 1 --accepted "<the owner's reason>" --by <owner name>/);
  assert.match(r.out, /#2 Critical · review Sub-unit 2 · src\/b\.ts:2 big/);
  assert.match(r.out, /burhan finding decide foo 2 --discovery <discovery file> --by <owner name> --outside "<why this code is outside the item>"/);
  assert.doesNotMatch(r.out, /finding decide foo 2 --accepted/);
  assert.match(r.out, /recommendation: fix it now when it is in the files this item changed/);
  assert.match(r.out, /burhan finding discover foo --by <owner name>/);
});

test('finding list with nothing open prints no question; a malformed row and a section with no table are named', async () => {
  const dir = await withReviews([1, 2]);
  const clean = await cli(dir, ['finding', 'list', 'foo']);
  assert.match(clean.out, /0 findings, 0 without a decision/);
  assert.match(clean.out, /review Sub-unit 1 \(reviews\/foo-review\.md\) has neither a findings table nor "No findings\."/);
  assert.doesNotMatch(clean.out, /QUESTION FOR THE OWNER/);
  await cli(dir, ['finding', 'add', 'foo', '--in', 'review:1', '--none']);
  await cli(dir, ['finding', 'add', 'foo', '--in', 'review:2', '--none']);
  assert.doesNotMatch((await cli(dir, ['finding', 'list', 'foo'])).out, /neither a findings table|QUESTION/);
});

test('finding add refuses a number past 999999 (Deviation 3, Minor 5)', async () => {
  const dir = await withReviews([1]);
  assert.equal((await addFinding(dir, 'review:1', 'Minor', 'src/a.ts:1 a')).code, 0);
  writeFileSync(reviewFile(dir), read(reviewFile(dir)).replace('| 1 | Minor |', '| 999999 | Minor |'));
  const r = await addFinding(dir, 'review:1', 'Minor', 'src/a.ts:2 b');
  assert.equal(r.code, 2);
  assert.match(r.err, /999999/);
});

test('finding add never writes through a review file that is a link leaving the project (Deviation 3, Minor 7)', { skip: process.platform === 'win32' }, async () => {
  const dir = await withReviews([1]);
  const outside = join(mkdtempSync(join(tmpdir(), 'finding-out-')), 'outside.md');
  const original = read(reviewFile(dir));
  writeFileSync(outside, original);
  rmSync(reviewFile(dir));
  symlinkSync(outside, reviewFile(dir));
  const r = await addFinding(dir, 'review:1', 'Minor', 'src/a.ts:1 a');
  assert.notEqual(r.code, 0);
  assert.equal(read(outside), original, 'the file outside the project is untouched');
});

test('finding add says a review file that is a link is a link, not that it is missing (Deviation 18, review Minor 6)', { skip: process.platform === 'win32' }, async () => {
  const dir = await withReviews([1]);
  const outside = join(mkdtempSync(join(tmpdir(), 'finding-link-')), 'outside.md');
  writeFileSync(outside, read(reviewFile(dir)));
  rmSync(reviewFile(dir));
  symlinkSync(outside, reviewFile(dir));
  const r = await addFinding(dir, 'review:1', 'Minor', 'src/a.ts:1 a');
  assert.equal(r.code, 2);
  assert.match(r.err, /is a link/);
  assert.doesNotMatch(r.err, /no review file yet/);
});
test('finding add refuses a QC report that is already accepted (Deviation 19, review Minor 20)', async () => {
  const dir = await withReviews([1]);
  assert.equal((await addQc(dir, 'PASS')).code, 0);
  writeFileSync(qcFile(dir), read(qcFile(dir)).replace(/^(- \*\*Verdict:\*\*.*)$/m, '$1\n- **Accepted by:** dev-dabour · 2026-11-08'));
  const r = await addFinding(dir, 'qc', 'Minor', 'src/a.ts:1 late');
  assert.equal(r.code, 2);
  assert.match(r.err, /already accepted/);
});

test('finding add treats a QC as accepted only when its Accepted by line has the exact form (Deviation 22, re-review Minor 1)', async () => {
  const dir = await withReviews([1]);
  assert.equal((await addQc(dir, 'PASS')).code, 0);
  writeFileSync(qcFile(dir), read(qcFile(dir)).replace(/^(- \*\*Verdict:\*\*.*)$/m, '$1\n- **Accepted by:** <name · YYYY-MM-DD>'));
  assert.equal((await addFinding(dir, 'qc', 'Minor', 'src/a.ts:1 a')).code, 0);
});

test('finding list names a review file that is a link instead of printing no finding (Deviation 22, re-review Minor 3)', { skip: process.platform === 'win32' }, async () => {
  const dir = await withReviews([1]);
  assert.equal((await addFinding(dir, 'review:1', 'Minor', 'src/a.ts:1 a')).code, 0);
  const outside = join(mkdtempSync(join(tmpdir(), 'list-link-')), 'outside.md');
  writeFileSync(outside, read(reviewFile(dir)));
  rmSync(reviewFile(dir));
  symlinkSync(outside, reviewFile(dir));
  const r = await cli(dir, ['finding', 'list', 'foo']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /reviews\/foo-review\.md is a link and is not read/);
});

test('finding add does not reuse the number of a malformed row (QC Minor 1)', async () => {
  const dir = await withReviews([1]);
  assert.equal((await addFinding(dir, 'review:1', 'Minor', 'src/a.ts:1 a')).code, 0);
  writeFileSync(reviewFile(dir), read(reviewFile(dir)).replace('| 1 | Minor |', '| 5 | Majr |'));
  const r = await addFinding(dir, 'review:1', 'Minor', 'src/a.ts:2 b');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /#6 Minor recorded/);
  assert.doesNotMatch((await cli(dir, ['finding', 'list', 'foo'])).out, /used twice/);
});
