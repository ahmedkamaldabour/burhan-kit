import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addNone, addRow, findingsGated, gateOf, gateOpen, gateSentence, qcScope, readItemFindings, reviewScopes, rowLine, withDecision } from '../src/lib/findings.js';
import { tmpDir } from './helpers.js';

const OWNER = 'dev-dabour · 2026-11-08';
const HEAD = '| # | Severity | Finding (file:line) | Decision | Pointer or reason | Decided by |\n|---|----------|---------------------|----------|-------------------|------------|';
const review = (body: string): string => `# Review — foo\n- **Contract:** 1\n\n${body}`;

test('a section with a findings table is read row by row: id, severity, text, decision and its pointer (AC-01)', () => {
  const text = review(`## Sub-unit 1 — review\n- **Performed by:** a · b · human\n\n### Findings\n\n${HEAD}\n| 1 | Minor | src/a.ts:3 a \\| b |  |  |  |\n| 2 | Important | src/b.ts:9 y | fixed | unit 1 | ${OWNER} |\n`);
  const [s] = reviewScopes('reviews/foo-review.md', text);
  assert.equal(s!.state, 'table');
  assert.deepEqual(s!.units, [1]);
  assert.deepEqual(s!.problems, []);
  assert.deepEqual(s!.findings.map((f) => [f.id, f.severity, f.text, f.decision, f.pointer, f.by, f.line]), [
    [1, 'Minor', 'src/a.ts:3 a | b', '', '', '', 11],
    [2, 'Important', 'src/b.ts:9 y', 'fixed', 'unit 1', OWNER, 12],
  ]);
});

test('"No findings." is the one line that says there are none; a header with no row, or no Findings heading, says nothing and is never taken for it (AC-01)', () => {
  const none = reviewScopes('f', review('## Sub-unit 1 — review\n\n### Findings\n\nNo findings.\n'))[0]!;
  assert.equal(none.state, 'none');
  assert.equal(none.findings.length, 0);
  assert.equal(reviewScopes('f', review(`## Sub-unit 1 — review\n\n### Findings\n\n${HEAD}\n`))[0]!.state, 'missing');
  assert.equal(reviewScopes('f', review('## Sub-unit 1 — review\n\nNo findings.\n'))[0]!.state, 'missing');
  assert.equal(reviewScopes('f', review('## Sub-unit 1 — review\n\n### Findings\n\nA sentence that says No findings. is prose.\n'))[0]!.state, 'missing');
  assert.equal(reviewScopes('f', review('## Sub-unit 1 — review\n\n```\n### Findings\nNo findings.\n```\n'))[0]!.state, 'missing');
});

test('an old review (the table "Owner | Resolution", no Findings heading) is not parsed: no finding, no problem (AC-11)', () => {
  const old = review('## Sub-unit 1 — review · short\n\n| # | Severity | Finding (file:line) | Owner | Resolution |\n|---|----|----|----|----|\n| 1 | Minor | src/a.ts:1 x | | |\n');
  const [s] = reviewScopes('f', old);
  assert.equal(s!.state, 'missing');
  assert.deepEqual(s!.findings, []);
  assert.deepEqual(s!.problems, []);
});

test('a malformed row is named with its file and line, never skipped (AC-10)', () => {
  const text = review(`## Sub-unit 1 — review\n\n### Findings\n\n${HEAD}\n| x | Minor | a |  |  |  |\n| 2 | Huge | a |  |  |  |\n| 3 | Minor |  |  |  |  |\n| 4 | Minor | a | maybe |  |  |\n| 5 | Minor | a | fixed |  |  |\n| 6 | Minor | a | fixed | unit 1 | me |\n| 7 | Critical | a | accepted | because | ${OWNER} |\n| 8 | Minor | a |\n`);
  const [s] = reviewScopes('reviews/foo-review.md', text);
  assert.equal(s!.findings.length, 0);
  assert.deepEqual(s!.problems.map((p) => p.line), [10, 11, 12, 13, 14, 15, 16, 17]);
  assert.ok(s!.problems.every((p) => p.file === 'reviews/foo-review.md'));
  assert.match(s!.problems[0]!.message, /not a whole number/);
  assert.match(s!.problems[1]!.message, /severity/);
  assert.match(s!.problems[2]!.message, /no text/);
  assert.match(s!.problems[3]!.message, /fixed, discovery or accepted/);
  assert.match(s!.problems[4]!.message, /no pointer or reason/);
  assert.match(s!.problems[5]!.message, /Decided by/);
  assert.match(s!.problems[6]!.message, /Critical and cannot be accepted/);
  assert.match(s!.problems[7]!.message, /3 cells, not 6/);
  assert.equal(s!.state, 'table');
});

test('a review group is one section for its sub-units, and a later section for the same sub-unit supersedes the earlier one', () => {
  const text = review('## Sub-units 1–2 — review (group A)\n\nbody\n\n## Sub-unit 2 — review\n\n### Findings\n\nNo findings.\n\n## Sub-unit 3 — review\n');
  const s = reviewScopes('f', text);
  assert.deepEqual(s.map((x) => x.units), [[1, 2], [2], [3]]);
  assert.deepEqual(s.map((x) => x.superseded), [true, false, false]);
  assert.deepEqual(s.map((x) => x.state), ['missing', 'none', 'missing']);
  assert.equal(s[0]!.spec, 'review:1');
});

test('a QC report is one section; a table or "No findings." anywhere under a Findings heading counts (AC-01)', () => {
  const q = qcScope('reviews/foo-qc.md', `# QC — foo\n- **Contract:** 1\n\n## 6. Findings\n\n${HEAD}\n| 1 | Minor | x |  |  |  |\n`, 1);
  assert.equal(q.state, 'table');
  assert.equal(q.where, 'QC');
  assert.equal(q.spec, 'qc');
  assert.equal(qcScope('f', '# QC\n\n## Findings\n\nNo findings.\n', 2).where, 'QC round 2');
  assert.equal(qcScope('f', '# QC\n\n## 6. Defects\n\n| # | Severity |\n', 1).state, 'missing');
});

function itemFolder(): string {
  const dir = tmpDir('burhan-findings-');
  mkdirSync(join(dir, 'reviews'), { recursive: true });
  return dir;
}

test('readItemFindings reads the review file and every QC round; a number used twice is a problem, not a second finding', () => {
  const dir = itemFolder();
  writeFileSync(join(dir, 'reviews', 'foo-review.md'), review(`## Sub-unit 1 — review\n\n### Findings\n\n${HEAD}\n| 1 | Minor | a |  |  |  |\n| 2 | Critical | b |  |  |  |\n`));
  writeFileSync(join(dir, 'reviews', 'foo-qc.md'), `# QC\n\n## Findings\n\n${HEAD}\n| 3 | Minor | c | accepted | a reason of a sentence | ${OWNER} |\n`);
  writeFileSync(join(dir, 'reviews', 'foo-qc-r2.md'), `# QC\n\n## Findings\n\n${HEAD}\n| 3 | Minor | again |  |  |  |\n| 4 | Minor | d |  |  |  |\n`);
  writeFileSync(join(dir, 'reviews', 'other-qc.md'), '# not this item\n');
  const all = readItemFindings(dir, 'foo');
  assert.deepEqual(all.scopes.map((s) => s.where), ['review Sub-unit 1', 'QC', 'QC round 2']);
  assert.deepEqual(all.findings.map((f) => f.id), [1, 2, 3, 4]);
  assert.equal(all.maxId, 4);
  assert.equal(all.problems.length, 1);
  assert.match(all.problems[0]!.message, /finding 3: the number is used twice/);
  assert.equal(all.problems[0]!.file, 'reviews/foo-qc-r2.md');
});

test('gateOf: what stops the finish (review) and the QC acceptance (qc), and the one sentence that says it (AC-02, AC-09)', () => {
  const dir = itemFolder();
  writeFileSync(join(dir, 'reviews', 'foo-review.md'), review(`## Sub-unit 1 — review\n\n### Findings\n\n${HEAD}\n| 1 | Minor | a |  |  |  |\n| 2 | Minor | b | accepted | a reason of a sentence | ${OWNER} |\n\n## Sub-unit 2 — review\n\nfree text only\n`));
  writeFileSync(join(dir, 'reviews', 'foo-qc.md'), `# QC\n\n## Findings\n\nNo findings.\n`);
  const all = readItemFindings(dir, 'foo');
  const g = gateOf(all, 'review', [1, 2, 3]);
  assert.deepEqual(g.undecided.map((f) => f.id), [1]);
  assert.deepEqual(g.missing.map((s) => s.spec), ['review:2']);
  assert.deepEqual(g.noSection, [3]);
  assert.equal(gateOpen(g), 3);
  const sentence = gateSentence('foo', g);
  assert.match(sentence, /1 without a decision \(#1 Minor\)/);
  assert.match(sentence, /review Sub-unit 2 \(reviews\/foo-review\.md\) has neither a findings table nor "No findings\."/);
  assert.match(sentence, /Sub-unit 3 has no review section/);
  assert.match(sentence, /burhan finding list foo/);
  assert.equal(gateOpen(gateOf(all, 'qc')), 0);
  // the review's rows never block the QC acceptance, and the other way round
  assert.equal(gateOf(all, 'qc').undecided.length, 0);
});

test('findingsGated: only the plan line "- **Findings gate:** on" counts, not in a code fence (AC-11)', () => {
  assert.equal(findingsGated('# P\n- **Overall status:** Draft\n- **Findings gate:** on\n'), true);
  assert.equal(findingsGated('# P\r\n- **Findings gate:** on\r\n'), true);
  assert.equal(findingsGated('# P\n- **Overall status:** Draft\n'), false);
  assert.equal(findingsGated('# P\n```\n- **Findings gate:** on\n```\n'), false);
  assert.equal(findingsGated('# P\n- **Findings gate:** off\n'), false);
  assert.equal(findingsGated('# P\nthe line - **Findings gate:** on is mentioned\n'), false);
});

test('addRow makes the Findings heading at the end of the section, then adds rows under the table; addNone replaces nothing and a row replaces "No findings."', () => {
  let text = review('## Sub-unit 1 — review\n- **Performed by:** a · b · human\n\nbody\n\n## Sub-unit 2 — review\n- x\n');
  text = addRow(text, reviewScopes('f', text)[0]!, rowLine({ id: 1, severity: 'Minor', text: 'a | b' }));
  assert.match(text, /body\n\n### Findings\n\n\| # \| Severity[^\n]*\n\|---[^\n]*\n\| 1 \| Minor \| a \\\| b \|  \|  \|  \|\n\n## Sub-unit 2/);
  text = addRow(text, reviewScopes('f', text)[0]!, rowLine({ id: 2, severity: 'Critical', text: 'c' }));
  assert.deepEqual(reviewScopes('f', text)[0]!.findings.map((f) => f.id), [1, 2]);
  text = addNone(text, reviewScopes('f', text)[1]!);
  assert.equal(reviewScopes('f', text)[1]!.state, 'none');
  text = addRow(text, reviewScopes('f', text)[1]!, rowLine({ id: 3, severity: 'Minor', text: 'd' }));
  const again = reviewScopes('f', text)[1]!;
  assert.equal(again.state, 'table');
  assert.deepEqual(again.findings.map((f) => f.id), [3]);
  assert.ok(!/^No findings\.$/m.test(text.slice(text.indexOf('## Sub-unit 2'))));
});

test('a QC report gets a level-2 Findings heading; CRLF files keep their line ends', () => {
  const q = '# QC — foo\n- **Verdict:** PASS\n';
  const out = addRow(q, qcScope('f', q, 1), rowLine({ id: 1, severity: 'Minor', text: 'x' }));
  assert.match(out, /\n\n## Findings\n\n\| # /);
  assert.equal(qcScope('f', out, 1).findings.length, 1);
  const crlf = '## Sub-unit 1 — r\r\nx\r\n';
  const w = addRow(crlf, reviewScopes('f', crlf)[0]!, rowLine({ id: 1, severity: 'Minor', text: 't' }));
  assert.ok(!/[^\r]\n/.test(w.replace(/^[^\n]*\n/, '')), 'every line the writer added ends with CRLF');
  assert.equal(reviewScopes('f', w)[0]!.findings.length, 1);
});

test('withDecision rewrites the row on its line and keeps the text, escaping a pipe again', () => {
  let text = review('## Sub-unit 1 — review\n');
  text = addRow(text, reviewScopes('f', text)[0]!, rowLine({ id: 1, severity: 'Important', text: 'a | b' }));
  const f = reviewScopes('f', text)[0]!.findings[0]!;
  text = withDecision(text, f, 'accepted', 'a reason | with a pipe', OWNER);
  const g = reviewScopes('f', text)[0]!.findings[0]!;
  assert.deepEqual([g.id, g.severity, g.text, g.decision, g.pointer, g.by], [1, 'Important', 'a | b', 'accepted', 'a reason | with a pipe', OWNER]);
});

test('the # cell is a whole number from 1 to 999999: 0 and a 20-digit number are named problems (Deviation 1, Minor 1)', () => {
  const text = review(`## Sub-unit 1 — x\n\n### Findings\n\n${HEAD}\n| 0 | Minor | a | | | |\n| 12345678901234567890 | Minor | b | | | |\n| 7 | Minor | c | | | |\n`);
  const s = reviewScopes('f', text)[0]!;
  assert.deepEqual(s.findings.map((f) => f.id), [7]);
  assert.equal(s.problems.length, 2);
  assert.match(s.problems[0]!.message, /not a whole number from 1 to 999999/);
});

test('a Sub-unit heading of level 3 or 4 is a section too, and it ends at the next heading of the same or a higher level (Deviation 1, Minor 4)', () => {
  const text = review(`### Sub-unit 1 — x\n\nbody\n\n#### Findings\n\n${HEAD}\n| 1 | Minor | a | | | |\n\n### Sub-unit 2 — y\n\nbody\n`);
  const scopes = reviewScopes('f', text);
  assert.equal(scopes.length, 2);
  assert.equal(scopes[0]!.state, 'table');
  assert.deepEqual(scopes[0]!.findings.map((f) => f.id), [1]);
  assert.equal(scopes[1]!.state, 'missing');
});

test('the writers make the Findings heading one level below the section heading (Deviation 1, Minor 4)', () => {
  let text = review('### Sub-unit 1 — x\n\nbody\n');
  text = addRow(text, reviewScopes('f', text)[0]!, rowLine({ id: 1, severity: 'Minor', text: 'a' }));
  assert.match(text, /body\n\n#### Findings\n\n\| # \| Severity/);
  assert.deepEqual(reviewScopes('f', text)[0]!.findings.map((f) => f.id), [1]);
  let none = review('#### Sub-unit 1 — x\n\nbody\n');
  none = addNone(none, reviewScopes('f', none)[0]!);
  assert.match(none, /body\n\n##### Findings\n\nNo findings\.\n/);
  assert.equal(reviewScopes('f', none)[0]!.state, 'none');
});
