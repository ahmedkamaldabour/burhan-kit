import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from './helpers.js';
import { cli, planFile, storyFile, project, projectWithItem, read, setPlanStatus, write } from './item-fixture.js';

test('item set plan completed does not skip item finish: it is refused and says which command', async () => {
  const dir = await projectWithItem();
  await cli(dir, ['item', 'set', 'foo', 'plan', 'in-progress']).catch(() => undefined);
  setPlanStatus(dir, 'In progress');
  const r = await cli(dir, ['item', 'set', 'foo', 'plan', 'completed']);
  assert.equal(r.code, 2);
  assert.match(r.err, /item finish/);
  assert.match(read(planFile(dir)), /Overall status:\*\* In progress/);
});

test('item new with a state file that is a folder is a plain message, not a stack trace, and leaves nothing behind', async () => {
  const dir = project();
  rmSync(join(dir, '.burhan', 'local', 'PROGRESS.md'), { force: true });
  mkdirSync(join(dir, '.burhan', 'local', 'PROGRESS.md'), { recursive: true });
  const r = await cli(dir, ['item', 'new', 'bar', '--type', 'feature', '--scope', 'bounded']);
  assert.equal(r.code, 2);
  assert.doesNotMatch(r.err, /EISDIR|\n\s+at /);
  assert.match(r.err, /state file/);
});

test('doctor names a WF_ITEM_CONTRACT value that is neither on nor off (it would turn the checks off silently)', async () => {
  const dir = tmpDir('burhan-doctor-');
  await cli(dir, ['init', dir, '--agents', 'claude', '--apply', '--no-bootstrap']);
  const cfg = join(dir, '.burhan', 'workflow.config');
  writeFileSync(cfg, `${existsSync(cfg) ? read(cfg) : ''}\nWF_ITEM_CONTRACT="true"\n`);
  const r = await cli(dir, ['doctor', dir]);
  assert.match(r.out, /WF_ITEM_CONTRACT[^\n]*"true"[^\n]*on or off/);
});

test('a plan with two Deviations rows of the same number is named', async () => {
  const dir = await projectWithItem();
  await cli(dir, ['approve', 'story', 'foo', '--by', 'dev-dabour']);
  setPlanStatus(dir, 'In progress');
  for (let i = 0; i < 2; i++) await cli(dir, ['deviation', 'add', 'foo', '--unit', '1', '--what', 'x', '--where', 'y', '--output', 'z']);
  write(planFile(dir), read(planFile(dir)).replace(/^\| 2 \|/m, '| 1 |'));
  assert.match((await cli(dir, ['item', 'check', 'foo'])).out, /deviation-duplicate/);
});

// ---- placeholders left in the templates (the discovery "approve plan accepts an unfilled template") ----
test('approve story and approve plan refuse files that still carry the template placeholders, and name them', async () => {
  const dir = await projectWithItem({ raw: true });
  const story = await cli(dir, ['approve', 'story', 'foo', '--by', 'dev-dabour']);
  assert.equal(story.code, 2);
  assert.match(story.err, /placeholder/);
  assert.match(story.err, /<one or two lines, as the user will see it>/);
  const plan = await cli(dir, ['approve', 'plan', 'foo', '--by', 'dev-dabour']);
  assert.equal(plan.code, 2);
  assert.match(plan.err, /placeholder|story is not approved/);
});

test('item check names placeholders in the story, plan and spec once they are Approved, and is quiet for a Draft', async () => {
  const dir = await projectWithItem({ raw: true });
  assert.doesNotMatch((await cli(dir, ['item', 'check', 'foo'])).out, /placeholder-left/);
  setPlanStatus(dir, 'Approved');
  const r = await cli(dir, ['item', 'check', 'foo']);
  assert.match(r.out, /placeholder-left/);
  assert.match(r.out, /build-spec/);
});

test('a filled item passes: the placeholder check is exact, not a ban on angle brackets in prose', async () => {
  const dir = await projectWithItem();
  write(planFile(dir), read(planFile(dir)).replace('## 8. Limitations\n', '## 8. Limitations\nThe `Array<string>` type and <html> tags are plain text here.\n'));
  assert.match(read(planFile(dir)), /^Knowledge review: none </m); // the knowledge review comes after QC: an unchanged line is no placeholder at plan time
  assert.equal((await cli(dir, ['approve', 'story', 'foo', '--by', 'dev-dabour'])).code, 0);
  const r = await cli(dir, ['approve', 'plan', 'foo', '--by', 'dev-dabour']);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch((await cli(dir, ['item', 'check', 'foo'])).out, /placeholder-left/);
});

test('the story\'s job-story line is a placeholder until it is written', async () => {
  const dir = await projectWithItem();
  write(storyFile(dir), read(storyFile(dir)).replace(/^> As a developer.*$/m, '> As a <role>, I want to <action>, so that <benefit>.'));
  const r = await cli(dir, ['approve', 'story', 'foo', '--by', 'dev-dabour']);
  assert.equal(r.code, 2);
  assert.match(r.err, /As a <role>/);
});

// ---- the three limits the owner asked about ----
test('a story with an all-empty table row is named, and the check falls back to the kit\'s own templates when the project has none', async () => {
  const dir = await projectWithItem();
  write(storyFile(dir), read(storyFile(dir)).replace('| AC-01 | does a thing | request |', '| AC-01 | does a thing | request |\n|  |  |  |'));
  const r = await cli(dir, ['approve', 'story', 'foo', '--by', 'dev-dabour']);
  assert.equal(r.code, 2);
  assert.match(r.err, /empty table row/);
  // no .burhan/templates in the project: the kit's own are used, so an unfilled story is still refused
  const raw = await projectWithItem({ raw: true });
  rmSync(join(raw, '.burhan', 'templates'), { recursive: true, force: true });
  const again = await cli(raw, ['approve', 'story', 'foo', '--by', 'dev-dabour']);
  assert.equal(again.code, 2);
  assert.match(again.err, /placeholder/);
});

test('a concluded findings file with template placeholders left is named by item check', async () => {
  const dir = project();
  await cli(dir, ['item', 'new', 'inv', '--type', 'investigation', '--scope', 'bounded']);
  const file = join(dir, '.burhan', 'work', 'inv', 'inv-findings.md');
  assert.doesNotMatch((await cli(dir, ['item', 'check', 'inv'])).out, /placeholder-left/);
  write(file, read(file).replace(/^- \*\*Status:\*\*.*$/m, '- **Status:** Concluded'));
  assert.match((await cli(dir, ['item', 'check', 'inv'])).out, /placeholder-left/);
});

// ---- QC round 3: two quadratic readers and the review groups ----
test('the Accepted by readers are linear: a very long line costs milliseconds, in the model and in the item list', async () => {
  const { qcAccepted } = await import('../src/hooks/core/item-model.mjs');
  const { accepted } = await import('../src/lib/items.js');
  const long = `${'a'.repeat(200_000)}`;
  let start = Date.now();
  assert.equal(qcAccepted(`- **Accepted by:** ${long}\n`), false);
  assert.ok(Date.now() - start < 500, `qcAccepted took ${Date.now() - start} ms`);
  start = Date.now();
  assert.equal(accepted(long), false);
  assert.ok(Date.now() - start < 500, `accepted took ${Date.now() - start} ms`);
  assert.equal(qcAccepted('- **Accepted by:** dev-dabour · 2026-10-27\n'), true);
  assert.equal(accepted('Ahmed Kamal · 2026-10-27'), true);
  assert.equal(qcAccepted('- **Accepted by:** a · b · 2026-10-27\n'), false); // a middle dot in the name is not a name
});

test('a review group: review add --unit 1-2 writes one section that both units can be Reviewed on', async () => {
  const dir = await projectWithItem();
  await cli(dir, ['approve', 'story', 'foo', '--by', 'dev-dabour']);
  await cli(dir, ['approve', 'plan', 'foo', '--by', 'dev-dabour']);
  for (const n of ['1', '2']) { await cli(dir, ['item', 'set', 'foo', 'unit', n, 'in-progress']); await cli(dir, ['item', 'set', 'foo', 'unit', n, 'implemented']); }
  const g = await cli(dir, ['review', 'add', 'foo', '--kind', 'review', '--unit', '1-2', '--by', 'claude · Sonnet 5.5 · fresh subagent']);
  assert.equal(g.code, 0, g.err);
  assert.match(read(join(dir, '.burhan', 'work', 'foo', 'reviews', 'foo-review.md')), /^## Sub-units 1–2 — review \(group\)$/m);
  assert.equal((await cli(dir, ['item', 'set', 'foo', 'unit', '1', 'reviewed'])).code, 0);
  assert.equal((await cli(dir, ['item', 'set', 'foo', 'unit', '2', 'reviewed'])).code, 0);
});

test('a group heading written by hand in the template\'s form counts for each unit it names, and not for the others', async () => {
  const { hasReviewSection } = await import('../src/lib/item-files.js');
  const r = '# R\n## Sub-units 1–3 — x · short (group A)\n## Sub-units 5, 7 — y\n## Sub-unit 9 — z\n';
  for (const n of [1, 2, 3, 5, 7, 9]) assert.equal(hasReviewSection(r, n), true, `unit ${n}`);
  for (const n of [4, 6, 8, 10, 19]) assert.equal(hasReviewSection(r, n), false, `unit ${n}`);
});

// ---- QC round 3, the Minors ----
const QC_BY = 'claude · Sonnet 5.5 · fresh subagent';
test('approve qc ticks the QC gate, as approve story and approve plan tick theirs', async () => {
  const dir = await projectWithItem();
  await cli(dir, ['review', 'add', 'foo', '--kind', 'qc', '--by', QC_BY, '--verdict', 'PASS']);
  assert.equal((await cli(dir, ['approve', 'qc', 'foo', '--by', 'dev-dabour'])).code, 0);
  assert.match(read(planFile(dir)), /^- \[x\] QC \/ convergence/m);
});

test('review add refuses a sub-unit the plan does not have, and a QC round that skips one', async () => {
  const dir = await projectWithItem();
  const bad = await cli(dir, ['review', 'add', 'foo', '--kind', 'review', '--unit', '99', '--by', QC_BY]);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /Sub-unit 99/);
  const skip = await cli(dir, ['review', 'add', 'foo', '--kind', 'qc', '--round', '9', '--by', QC_BY, '--verdict', 'FAIL — 1 issue']);
  assert.equal(skip.code, 2);
  assert.match(skip.err, /round/);
});

test('a plan whose QC passed is reopened by a command that records why, and only with that reason', async () => {
  const dir = await projectWithItem();
  setPlanStatus(dir, 'Completed');
  await cli(dir, ['review', 'add', 'foo', '--kind', 'qc', '--by', QC_BY, '--verdict', 'PASS']);
  assert.equal((await cli(dir, ['item', 'set', 'foo', 'plan', 'in-progress'])).code, 2);
  const r = await cli(dir, ['item', 'set', 'foo', 'plan', 'in-progress', '--reopen', 'a defect escaped: the date is off']);
  assert.equal(r.code, 0, r.err);
  assert.match(read(planFile(dir)), /^- \*\*Reopened after PASS:\*\* \d{4}-\d{2}-\d{2} — a defect escaped: the date is off$/m);
  assert.match(read(planFile(dir)), /Overall status:\*\* In progress/);
});

test('a findings file is concluded by a command', async () => {
  const dir = project();
  await cli(dir, ['item', 'new', 'inv', '--type', 'investigation', '--scope', 'bounded']);
  const file = join(dir, '.burhan', 'work', 'inv', 'inv-findings.md');
  write(file, read(file).replace(/^(- \*\*.*|\|.*)$/gm, (l) => l.replace(/<[^<>\n]+>/g, 'ok')));
  const r = await cli(dir, ['item', 'set', 'inv', 'findings', 'concluded']);
  assert.equal(r.code, 0, r.err);
  assert.match(read(join(dir, '.burhan', 'work', 'inv', 'inv-findings.md')), /^- \*\*Status:\*\* Concluded/m);
});

test('the plan item new makes has its slug in the gate lines, not the literal <slug>', async () => {
  const dir = await projectWithItem({ raw: true });
  assert.doesNotMatch(read(planFile(dir)).split('## Gate checklist')[1]!.split('\n## ')[0]!, /<slug>/);
});

test('the kit tells the planner and the verifier the forms the checks read', () => {
  const kit = (f: string): string => readFileSync(new URL(`../../kit/${f}`, import.meta.url), 'utf8');
  assert.match(kit('templates/verification.md'), /Performed by:\*\* <agent> · <model> · <fresh subagent/);
  assert.match(kit('phases/files.md'), /`Performed by` \|[^\n]*review, QC, verification/);
  assert.match(kit('agents/claude/burhan-planner.md'), /burhan item new/);
});

// ---- QC round 4 ----
test('the old verdict readers in facts.ts do not backtrack on a long run of blank lines or spaces', async () => {
  const { qcVerdict } = await import('../src/lib/facts.js');
  for (const text of [`x\n${'\n'.repeat(200_000)}`, `<${'<'.repeat(200_000)}`, `verdict\n${'\n'.repeat(60)}`, `x\n${'  \n'.repeat(60)}`, `${' '.repeat(200_000)}x`, `verdict ${' '.repeat(200_000)}`]) {
    const start = Date.now();
    qcVerdict(text);
    assert.ok(Date.now() - start < 500, `took ${Date.now() - start} ms`);
  }
  assert.equal(qcVerdict('# QC\nVerdict:\n\n  PASS\n'), 'PASS');
  assert.equal(qcVerdict('> **FAIL — 2 issues**\n'), 'FAIL');
  const { filled } = await import('../src/lib/items.js');
  const start = Date.now();
  filled(`<${'<'.repeat(100_000)}`);
  assert.ok(Date.now() - start < 500, `filled took ${Date.now() - start} ms`);
  assert.equal(filled('<a placeholder>'), null);
});

test('a review heading with a very long list of numbers is read in milliseconds', async () => {
  const { reviewHeadingUnits } = await import('../src/lib/item-files.js');
  const start = Date.now();
  reviewHeadingUnits(`## Sub-units 1${',1'.repeat(90_000)} — x`);
  assert.ok(Date.now() - start < 500, `took ${Date.now() - start} ms`);
  assert.deepEqual(reviewHeadingUnits('## Sub-units 2–4 — x'), [2, 3, 4]);
});

test('a findings file that is still the template is not concluded', async () => {
  const dir = project();
  await cli(dir, ['item', 'new', 'inv', '--type', 'investigation', '--scope', 'bounded']);
  const r = await cli(dir, ['item', 'set', 'inv', 'findings', 'concluded']);
  assert.equal(r.code, 2);
  assert.match(r.err, /placeholder/);
});

test('a review group may not name sub-units the plan does not have between its ends, and --verdict is refused where it means nothing', async () => {
  const dir = await projectWithItem();
  write(planFile(dir), read(planFile(dir)).replace('### Sub-unit 2 —', '### Sub-unit 3 —'));
  const g = await cli(dir, ['review', 'add', 'foo', '--kind', 'review', '--unit', '1-3', '--by', QC_BY]);
  assert.equal(g.code, 2);
  assert.match(g.err, /Sub-unit 2/);
  const v = await cli(dir, ['review', 'add', 'foo', '--kind', 'review', '--unit', '1', '--by', QC_BY, '--verdict', 'PASS']);
  assert.equal(v.code, 2);
  assert.match(v.err, /--verdict/);
});

test('an item folder name that starts with a dot is refused (status would not list it)', async () => {
  const dir = project();
  const r = await cli(dir, ['item', 'new', '.hidden', '--type', 'feature', '--scope', 'bounded']);
  assert.equal(r.code, 2);
});

test('a report that quotes the Performed by label inside a finding is not read as having a second, wrong Performed by', async () => {
  const dir = await projectWithItem();
  await cli(dir, ['review', 'add', 'foo', '--kind', 'qc', '--by', QC_BY, '--verdict', 'PASS']);
  const file = join(dir, '.burhan', 'work', 'foo', 'reviews', 'foo-qc.md');
  write(file, `${read(file)}\n| 3 | Minor | the contract reads \`**Performed by:** x\` anywhere, and "Amer · m · human'" is a quote |\n- note: the field **Performed by:** is checked\n`);
  const r = await cli(dir, ['item', 'check', 'foo']);
  assert.doesNotMatch(r.out, /performed-by-form/);
  assert.equal((await cli(dir, ['approve', 'qc', 'foo', '--by', 'dev-dabour'])).code, 0);
  // a real second field line with a wrong form is still named
  write(file, `${read(file)}\n- **Performed by:** nobody\n`);
  assert.match((await cli(dir, ['item', 'check', 'foo'])).out, /performed-by-form/);
});
