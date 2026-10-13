import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { kitDir } from '../src/lib/kit.js';
import { runCli } from '../src/main.js';
import { capture, tmpDir } from './helpers.js';

function item(files: Record<string, string>): string {
  const p = tmpDir('burhan-pr-');
  for (const [f, t] of Object.entries(files)) {
    mkdirSync(join(p, 'AI_SPEC/docs/foo', f, '..'), { recursive: true });
    writeFileSync(join(p, 'AI_SPEC/docs/foo', f), t);
  }
  return p;
}
async function body(p: string, ...extra: string[]): Promise<{ rc: number; out: string; err: string }> {
  const { o, io } = capture(p);
  const rc = await runCli(['pr-body', p, '--item', 'foo', ...extra], io);
  return { rc, out: o.out, err: o.err };
}

const STORY = `# Tenant filter on the orders list
- **What changes:** each user sees only their own tenant's orders
- **Route:** feature / bounded
- **Status:** Approved

## Acceptance criteria
| ID | Criterion | Provenance |
|----|-----------|------------|
| AC-01 | A user sees only orders of their tenant | request |
| AC-02 | An admin sees every tenant | Q-1 |
`;
const VERIFICATION = `# Verification — foo
- **Date:** 2026-10-12

## Acceptance criteria outcome
| AC | Outcome | Run # |
|----|---------|-------|
| AC-01 | pass | 1 |

## Limitations
- not run against production data
`;
const QC = `# QC — foo
- **Date:** 2026-10-12 · **Verdict:** PASS
- **Accepted by:** Sam · 2026-10-12
- **Performed by:** codex · gpt-5 · other agent
`;
const REVIEW = `# Review — foo
## Sub-unit 1 — filter · full
- **Date:** 2026-10-12 · **Performed by:** claude · sonnet · fresh subagent
`;

test('a full item: title, route, criteria with outcomes, review, QC with who performed and who accepted, verification, evidence', async () => {
  const p = item({ 'foo-story.md': STORY, 'reviews/foo-verification.md': VERIFICATION, 'reviews/foo-qc.md': QC, 'reviews/foo-review.md': REVIEW });
  const { rc, out } = await body(p);
  assert.equal(rc, 0);
  assert.match(out, /^# Tenant filter on the orders list$/m);
  assert.match(out, /each user sees only their own tenant's orders/);
  assert.match(out, /\*\*Route:\*\* feature \/ bounded/);
  assert.match(out, /\| AC-01 \| A user sees only orders of their tenant \| pass \|/);
  assert.match(out, /\| AC-02 \| An admin sees every tenant \| not verified \|/);
  assert.match(out, /QC.*PASS.*codex · gpt-5 · other agent.*Accepted by Sam · 2026-10-12/s);
  assert.match(out, /claude · sonnet · fresh subagent/);
  assert.match(out, /not run against production data/);
  assert.match(out, /burhan evidence --item foo/);
});

test('missing QC, unaccepted verdict, missing verification: said plainly, never invented', async () => {
  const dash = await body(item({ 'foo-story.md': STORY.replace("each user sees only their own tenant's orders", '—') }));
  assert.doesNotMatch(dash.out, /^—$/m, 'an empty What changes is not printed');
  const noQc = await body(item({ 'foo-story.md': STORY }));
  assert.match(noQc.out, /QC: not run/);
  assert.match(noQc.out, /Verification: not recorded/);
  const proposed = await body(item({ 'foo-story.md': STORY, 'reviews/foo-qc.md': QC.replace('Sam · 2026-10-12', '<exactly "<name> · YYYY-MM-DD">') }));
  assert.match(proposed.out, /PASS \(proposed — not accepted\)/);
  assert.doesNotMatch(proposed.out, /Accepted by/);
});

test('verification outcomes from any AC table in the file; no Runs section → not listed, never "0"', async () => {
  const p = item({ 'foo-story.md': STORY, 'reviews/foo-verification.md': '# Verification — foo\n\n| AC | Result |\n|----|--------|\n| AC-01 | ✅ checked by hand |\n' });
  const { out } = await body(p);
  assert.match(out, /\| AC-01 \| A user sees only orders of their tenant \| ✅ checked by hand \|/);
  assert.match(out, /runs not listed/);
  assert.doesNotMatch(out, /0 recorded runs/);
});

test('table cells: an escaped pipe is part of the text; a row with extra cells or a half placeholder is never printed', async () => {
  const story = STORY.replace('| AC-02 | An admin sees every tenant | Q-1 |', '| AC-02 | a \\| b criterion | Q-1 |\n| AC-03 | ok criterion with | pipe | extra |');
  const ver = '| AC | Outcome | Run # |\n|----|---------|-------|\n| AC-01 | <pass|fail> | 1 |\n';
  const { out } = await body(item({ 'foo-story.md': story, 'reviews/foo-verification.md': ver }));
  assert.match(out, /\| AC-02 \| a \\\| b criterion \|/, 'the escaped pipe survives, still escaped for the table');
  assert.doesNotMatch(out, /AC-03/, 'a row with more cells than its header is malformed: skipped');
  assert.doesNotMatch(out, /<pass/);
  assert.match(out, /\| AC-01 \| A user sees only orders of their tenant \| not verified \|/);
});

test('runs are counted by their number, even when a command has a shell pipe', async () => {
  const ver = '## Runs\n| # | Command | Result | AC |\n|---|---|---|---|\n| 1 | npm test | ok | AC-01 |\n| 2 | ls src | wc -l | ok | AC-01 |\n| 3 | grep -E \'a|b\' f | exit 1 | AC-01 |\n';
  const { out } = await body(item({ 'foo-story.md': STORY, 'reviews/foo-verification.md': ver }));
  assert.match(out, /- 3 recorded runs/);
});

test('a criterion row that cannot be read is said, not dropped silently', async () => {
  const story = STORY.replace('| AC-02 | An admin sees every tenant | Q-1 |', '| AC-02 | a | b | c |');
  const { out } = await body(item({ 'foo-story.md': story }));
  assert.match(out, /1 criterion row could not be read/);
});

test('the latest QC round is used', async () => {
  const p = item({ 'foo-story.md': STORY, 'reviews/foo-qc.md': QC.replace('PASS', 'FAIL — 2 issues'), 'reviews/foo-qc-r2.md': QC });
  assert.match((await body(p)).out, /foo-qc-r2\.md/);
});

test('template placeholders are never printed as facts', async () => {
  const p = tmpDir('burhan-pr-tpl-');
  const d = join(p, 'AI_SPEC/docs/foo');
  mkdirSync(join(d, 'reviews'), { recursive: true });
  const t = join(kitDir(), 'templates');
  cpSync(join(t, 'story.md'), join(d, 'foo-story.md'));
  for (const f of ['qc', 'review', 'verification']) cpSync(join(t, `${f}.md`), join(d, `reviews/foo-${f}.md`));
  assert.ok(readdirSync(join(d, 'reviews')).length === 3);
  const { rc, out } = await body(p);
  assert.equal(rc, 0);
  assert.doesNotMatch(out, /<[^>\n]*>/, out);
  assert.match(out, /^# foo$/m, 'no title → the slug');
  assert.match(out, /Route:\*\* not recorded/);
});

test('an item folder that is a symlink out of the project is refused', async () => {
  const p = item({ 'foo-story.md': STORY });
  const outside = tmpDir('burhan-pr-out-');
  mkdirSync(join(outside, 'x'));
  writeFileSync(join(outside, 'x/x-story.md'), '# secret\n');
  symlinkSync(join(outside, 'x'), join(p, 'AI_SPEC/docs/x'));
  const c = capture(p);
  assert.equal(await runCli(['pr-body', p, '--item', 'x'], c.io), 2);
  assert.match(c.o.err, /outside the project/);
  assert.doesNotMatch(c.o.out, /secret/);
});

test('errors: --item required and must be a slug; an unknown item says so', async () => {
  const p = item({ 'foo-story.md': STORY });
  const a = capture(p);
  assert.equal(await runCli(['pr-body', p], a.io), 2);
  assert.match(a.o.err, /--item/);
  const b = capture(p);
  assert.equal(await runCli(['pr-body', p, '--item', '../x'], b.io), 2);
  const c = capture(p);
  assert.equal(await runCli(['pr-body', p, '--item', 'nope'], c.io), 2);
  assert.match(c.o.err, /no work item/);
});
