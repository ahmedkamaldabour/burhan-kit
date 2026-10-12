import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { phaseLog, qcIndependence, qcVerdict, readFacts, route } from '../src/lib/facts.js';
import { kitDir } from '../src/lib/kit.js';

const tpl = (n: string) => readFileSync(join(kitDir(), 'templates', n), 'utf8');

test('route normalises "type / scope"; anything else is unknown', () => {
  assert.equal(route('bug / bounded'), 'bug / bounded');
  assert.equal(route('Bug / Bounded'), 'unknown', 'fixed form: exact lowercase values only');
  assert.equal(route('feature / bounded — a reason'), 'unknown', 'fixed form: nothing after the scope');
  assert.equal(route('—'), 'unknown');
});

test('verdict: the field wins; free text (reports written before the field) only when the field is absent; template = unrecorded', () => {
  assert.equal(qcVerdict('- **Verdict:** **PASS**\n'), 'PASS');
  assert.equal(qcVerdict('- **Verdict:** FAIL — 2 issues\n'), 'FAIL');
  assert.equal(qcVerdict(tpl('qc.md')), 'unrecorded');
  assert.equal(qcVerdict('# x — QC review\n\n## 7. Verdict\n\n**PASS** — all AC satisfied\n'), 'PASS');
  assert.equal(qcVerdict('**FAIL — 1 issue (Critical)**, surfaced to the user\n'), 'FAIL');
  assert.equal(qcVerdict('# nothing here\n'), 'unrecorded');
  assert.equal(qcVerdict('- **Verdict:** pass\n'), 'PASS', 'case-insensitive');
  assert.equal(qcVerdict('- **Verdict:**\n\n**FAIL** — 2 issues\n'), 'FAIL', 'empty field -> verdict on a later line');
});

test('independence: Performed by field, else the header of a report written before the Performed by field, else unknown', () => {
  assert.equal(qcIndependence('- **Performed by:** claude · opus · fresh subagent\n'), 'independent');
  assert.equal(qcIndependence('- **Performed by:** codex · gpt · other agent\n'), 'independent');
  assert.equal(qcIndependence('- **Performed by:** claude · sonnet · same session\n'), 'self');
  assert.equal(qcIndependence(tpl('qc.md')), 'unknown');
  assert.equal(qcIndependence('# x — QC review\n\n- **Reviewed:** 2026-09-15, by the implementing agent (user unavailable)\n'), 'self');
  assert.equal(qcIndependence('# x — QC review\n\n- **Reviewed:** 2026-09-16. Adversarial pass performed by the agent (the user\'s choice).\n'), 'self');
  assert.equal(qcIndependence('# x — QC review\n\nNo provenance at all.\n'), 'unknown');
  assert.equal(qcIndependence('- **Performed by:** claude · opus · fresh subagent\n'), 'independent', 'fixed form');
  assert.equal(qcIndependence('- **Performed by:** claude · opus · fresh subagent (not the implementing agent)\n'), 'unknown', 'fixed form: the context is exactly one of four values');
  for (const v of ['fresh subagent', 'same session', 'claude · fresh subagent', '<agent> · <model> · fresh subagent', 'claude · opus · same session · fresh subagent'])
    assert.equal(qcIndependence(`- **Performed by:** ${v}\n`), 'unknown', `exactly <agent> · <model> · <context>: ${v}`);
  assert.equal(qcIndependence('- **Performed by:** **claude · opus · fresh subagent**\n'), 'independent', 'bold around the value is the same form (hook = stats)');
  assert.equal(qcIndependence('- **Performed by:** Sam (human), checking the implementing agent\n'), 'unknown', 'free text in the field: not the fixed form');
  assert.equal(qcIndependence('- **Performed by:** Sam · — · human\n'), 'independent', 'a human reviewer in the fixed form');
  assert.equal(qcIndependence('- **Performed by:** —\n'), 'unknown');
  assert.equal(qcIndependence('# x — QC\n\n- **How:** read-only defect hunt + design-fidelity matrix (subagent) · live pass\n'), 'independent');
  assert.equal(qcIndependence('# x — QC\n\nNote: a subagent read the plaintext JWT_SECRET out of .env while investigating.\n'), 'unknown', 'incident narrative is not provenance');
});

test('phase log: durations in minutes, tokens when numeric; the empty template gives nothing', () => {
  const plan = '# p\n\n## 11. Phase log\n| Phase | Start | End | Tokens |\n|---|---|---|---|\n| Plan | 2026-10-11 09:00 | 2026-10-11 09:45 | 12,000 |\n| build | 2026-10-11 10:00 | | |\n\n## 12. Next\n| x | 1 | 2 | 3 |\n';
  assert.deepEqual(phaseLog(plan), [{ phase: 'plan', minutes: 45, tokens: 12000 }, { phase: 'build', minutes: null, tokens: null }]);
  assert.deepEqual(phaseLog(tpl('plan.md')), []);
  assert.deepEqual(phaseLog('## Phase log\n| Phase | Start | End | Tokens |\n|---|---|---|---|\n| plan | 2026-10-11 | 2026-10-11 | |\n| build | 2026-10-11 | 2026-10-13 | |\n| qc | 2026-10-11 9:05 | 2026-10-11 9:35 | |\n'),
    [{ phase: 'plan', minutes: null, tokens: null }, { phase: 'build', minutes: null, tokens: null }, { phase: 'qc', minutes: 30, tokens: null }],
    'date-only rows have no duration; H:MM is accepted');
  assert.deepEqual(phaseLog('## Phase log\n| Phase | Start | End | Tokens |\n|:---|:---:|---:|---|\n| qc | 2026-10-11 | 2026-10-11 | |\n'), [{ phase: 'qc', minutes: null, tokens: null }], 'alignment rows are not phases');
});

test('readFacts: route, QC, acceptance, reopen and escape fields', () => {
  const d = mkdtempSync(join(tmpdir(), 'burhan-facts-'));
  mkdirSync(join(d, 'fix-x/reviews'), { recursive: true });
  for (const f of ['add-x', 'add-y', 'pay-flow']) mkdirSync(join(d, f)); // escapes name real items only
  writeFileSync(join(d, 'fix-x/fix-x-story.md'), '- **Type / scope:** bug / bounded\n- **Escapes:** add-x\n');
  writeFileSync(join(d, 'fix-x/fix-x-implementation-plan.md'), '- **Overall status:** Completed\n- **Reopened after PASS:** —\n');
  writeFileSync(join(d, 'fix-x/reviews/fix-x-qc.md'), '- **Verdict:** PASS\n- **Accepted by:** Sam · 2026-10-11\n- **Performed by:** claude · opus · fresh subagent\n');
  assert.deepEqual(readFacts(join(d, 'fix-x'), 'fix-x'), {
    slug: 'fix-x', route: 'bug / bounded', qc: 'PASS', qcAccepted: true, qcBy: 'independent',
    reopenedAfterPass: false, escapes: ['add-x'], phases: [], reviewBy: null,
    words: { story: 10, plan: 9, qc: 18, verification: null, review: null },
  });
  writeFileSync(join(d, 'fix-x/fix-x-story.md'), '# T\nfour words of prose\n| a | b |\n|---|---|\n```\ncode here not counted\n```\n');
  assert.equal(readFacts(join(d, 'fix-x'), 'fix-x').words.story, 6, 'tables and code are not counted (caps exclude them)');
  writeFileSync(join(d, 'fix-x/fix-x-story.md'), '- **Type / scope:** bug / bounded\n- **Escapes:** `add-x`, `add-y` (both)\n');
  assert.deepEqual(readFacts(join(d, 'fix-x'), 'fix-x').escapes, ['add-x', 'add-y'], 'backticks and lists are cleaned');
  writeFileSync(join(d, 'fix-x/fix-x-story.md'), '- **Escapes:** `pay-flow` (found in prod by QA)\n');
  assert.deepEqual(readFacts(join(d, 'fix-x'), 'fix-x').escapes, ['pay-flow'], 'explanation words are not slugs');
  writeFileSync(join(d, 'fix-x/fix-x-story.md'), '- **Escapes:** pay-flow found in prod, add-x\n');
  assert.deepEqual(readFacts(join(d, 'fix-x'), 'fix-x').escapes, ['pay-flow', 'add-x']);
  const esc = (v: string): string[] => { writeFileSync(join(d, 'fix-x/fix-x-story.md'), `- **Escapes:** ${v}\n`); return readFacts(join(d, 'fix-x'), 'fix-x').escapes; };
  assert.deepEqual(esc('`pay-flow` — reopened, see QC'), ['pay-flow'], 'r2\'s own example: "see" is no item');
  assert.deepEqual(esc('pay-flow — reopened, see QC'), ['pay-flow'], 'without backticks too');
  assert.deepEqual(esc('pay-flow: found in prod'), ['pay-flow'], 'colon form');
  assert.deepEqual(esc('[pay-flow](../pay-flow/) by QA'), ['pay-flow'], 'markdown link form');
  assert.deepEqual(esc('pay-flow.'), ['pay-flow'], 'trailing period');
  assert.deepEqual(esc('fix-x, ghost-item'), [], 'the item itself and names with no item folder are not escapes');
  mkdirSync(join(d, 'waiting-room'), { recursive: true });
  assert.deepEqual(esc('waiting-room'), ['waiting-room'], 'a slug starting with "waiting-" is an item, not "waiting"');
  assert.deepEqual(esc('waiting for QA'), [], '"waiting …" is still nothing');
  mkdirSync(join(d, 'no-reopen'));
  writeFileSync(join(d, 'no-reopen/no-reopen-implementation-plan.md'), '- **Reopened after PASS:** no\n');
  assert.equal(readFacts(join(d, 'no-reopen'), 'no-reopen').reopenedAfterPass, false, '"no" is not a reopen');
  for (const v of ['not reopened', 'never', '(none)', 'false', '0', 'not reopened (proposed 2026-10-12)']) {
    writeFileSync(join(d, 'no-reopen/no-reopen-implementation-plan.md'), `- **Reopened after PASS:** ${v}\n`);
    assert.equal(readFacts(join(d, 'no-reopen'), 'no-reopen').reopenedAfterPass, false, v);
  }
  writeFileSync(join(d, 'no-reopen/no-reopen-implementation-plan.md'), '- **Reopened after PASS:** 2026-10-12 — a refund bug found in production\n');
  assert.equal(readFacts(join(d, 'no-reopen'), 'no-reopen').reopenedAfterPass, true, 'the template form "YYYY-MM-DD — why"');
  mkdirSync(join(d, 'pending/reviews'), { recursive: true });
  writeFileSync(join(d, 'pending/reviews/pending-qc.md'), '- **Verdict:** FAIL\n- **Accepted by:** — (not accepted; the verdict is the human\'s to accept)\n');
  assert.equal(readFacts(join(d, 'pending'), 'pending').qcAccepted, false, 'a dash plus an explanation is not an acceptance (live run, 2026-10-11)');
  for (const v of ['pending', 'not yet', 'TBD', 'waiting for the human', 'not accepted', 'proposed', '(pending)', 'awaiting the human', 'nobody', 'Sam']) {
    writeFileSync(join(d, 'pending/reviews/pending-qc.md'), `- **Verdict:** PASS\n- **Accepted by:** ${v}\n`);
    assert.equal(readFacts(join(d, 'pending'), 'pending').qcAccepted, false, v);
  }
  writeFileSync(join(d, 'pending/reviews/pending-qc.md'), '- **Verdict:** PASS\n- **Accepted by:** Northside-team lead · 2026-10-12\n');
  assert.equal(readFacts(join(d, 'pending'), 'pending').qcAccepted, true, 'a name that merely starts with "No…" is an acceptance');
  const acc = (v: string): boolean => { writeFileSync(join(d, 'pending/reviews/pending-qc.md'), `- **Verdict:** PASS\n- **Accepted by:** ${v}\n`); return readFacts(join(d, 'pending'), 'pending').qcAccepted; };
  // Fixed form "<name> · YYYY-MM-DD" (user decision 2026-10-12): exactly that, or not accepted. No word lists.
  for (const v of ['Sam · 2026-10-11', 'Noura · 2026-10-12', 'Sam (no changes) · 2026-10-12', 'Northside-team lead · 2026-10-12'])
    assert.equal(acc(v), true, `fixed form: ${v}`);
  for (const v of ['Sam, 2026-10-11', 'Sam · 2026-10-11T09:00', 'Sam · 2026-10-12 · rejected', '2026-10-12 — rejected by Sam',
    'Sam · 2026-13-45', 'Not accepted (proposed 2026-10-11)', '· 2026-10-12', '<name> · 2026-10-12', 'Sam 2026-10-12'])
    assert.equal(acc(v), false, `any other form is not accepted: ${v}`);
  mkdirSync(join(d, 'plain'));
  assert.deepEqual(readFacts(join(d, 'plain'), 'plain'), {
    slug: 'plain', route: 'unknown', qc: null, qcAccepted: false, qcBy: null, reopenedAfterPass: false, escapes: [], phases: [], reviewBy: null,
    words: { story: null, plan: null, qc: null, verification: null, review: null },
  });
});

test('readFacts: the review file\'s provenance and size — the single per-item file, else the old per-sub-unit files', () => {
  const d = mkdtempSync(join(tmpdir(), 'burhan-facts-rv-'));
  mkdirSync(join(d, 'one/reviews'), { recursive: true });
  writeFileSync(join(d, 'one/reviews/one-review.md'), '# Review\n## Sub-unit 1 · short\n- **Date:** x · **Performed by:** claude · sonnet · fresh subagent\n');
  writeFileSync(join(d, 'one/reviews/one-qc.md'), '- **Performed by:** claude · opus · same session\n');
  const one = readFacts(join(d, 'one'), 'one');
  assert.equal(one.reviewBy, 'independent');
  assert.equal(typeof one.words.review, 'number');
  mkdirSync(join(d, 'old/reviews'), { recursive: true });
  writeFileSync(join(d, 'old/reviews/old-task1.md'), '- **Performed by:** claude · opus · fresh subagent\n');
  writeFileSync(join(d, 'old/reviews/old-task2.md'), '- **Performed by:** claude · opus · same session\n');
  assert.equal(readFacts(join(d, 'old'), 'old').reviewBy, 'self', 'old per-sub-unit files: any self-review makes the item self-reviewed');
  mkdirSync(join(d, 'none'));
  assert.equal(readFacts(join(d, 'none'), 'none').reviewBy, null);
});

test('review provenance reads every section, and QC re-runs are not reviews', () => {
  const d = mkdtempSync(join(tmpdir(), 'burhan-facts-rv2-'));
  mkdirSync(join(d, 'two/reviews'), { recursive: true });
  writeFileSync(join(d, 'two/reviews/two-review.md'), '## Sub-unit 1\n- **Performed by:** claude · sonnet · fresh subagent\n## Sub-unit 2\n- **Performed by:** claude · opus · same session\n');
  assert.equal(readFacts(join(d, 'two'), 'two').reviewBy, 'self', 'one same-session section makes the item self-reviewed');
  mkdirSync(join(d, 'rr/reviews'), { recursive: true });
  writeFileSync(join(d, 'rr/reviews/rr-qc-r2.md'), '- **Performed by:** claude · opus · same session\n');
  writeFileSync(join(d, 'rr/reviews/rr-verification-r2.md'), '- **Performed by:** human\n');
  assert.equal(readFacts(join(d, 'rr'), 'rr').reviewBy, null, 'QC and verification re-runs are not review files');
});
