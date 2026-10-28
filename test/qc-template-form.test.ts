import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cli, itemDir, planFile, projectWithItem, read, write } from './item-fixture.js';
import { stageOf } from '../src/hooks/core/item-stage.mjs';

// A QC report written the way kit/templates/qc.md and kit/commands/qc.md step 5 give it: the verdict is on the Date line.
const by = 'claude · Sonnet 5.5 · fresh subagent';
async function qcInTemplateForm(verdict: string): Promise<string> {
  const dir = await projectWithItem();
  await cli(dir, ['review', 'add', 'foo', '--kind', 'qc', '--by', by, '--verdict', verdict]);
  const file = join(itemDir(dir), 'reviews', 'foo-qc.md');
  write(file, read(file).replace(/^- \*\*Date:\*\* (.*)$/m, `- **Date:** $1 · **Verdict:** ${verdict}`).replace(/^- \*\*Verdict:\*\*.*\n/m, ''));
  assert.match(read(file), /^- \*\*Date:\*\* .* · \*\*Verdict:\*\* /m);
  assert.doesNotMatch(read(file), /^- \*\*Verdict:\*\*/m);
  return dir;
}

test('approve qc and gate tick QC read a PASS that is on the Date line, as the template gives it', async () => {
  const dir = await qcInTemplateForm('PASS');
  const gate = await cli(dir, ['gate', 'tick', 'foo', 'QC / convergence']);
  assert.equal(gate.code, 0, gate.err);
  const r = await cli(dir, ['approve', 'qc', 'foo', '--by', 'dev-dabour']);
  assert.equal(r.code, 0, r.err);
  assert.match(read(join(itemDir(dir), 'reviews', 'foo-qc.md')), /^- \*\*Accepted by:\*\* dev-dabour · \d{4}-\d{2}-\d{2}$/m);
});

test('a FAIL on the Date line is a failed QC for approve, guide and item set', async () => {
  const dir = await qcInTemplateForm('FAIL — 2 issues');
  assert.equal((await cli(dir, ['approve', 'qc', 'foo', '--by', 'dev-dabour'])).code, 2);
  const plan = '# P\n- **Route:** feature / bounded\n- **Overall status:** Completed\n- **Contract:** 1\n\n## 5. Sub-unit breakdown\n### Sub-unit 1 — a · ✅ Reviewed\n- **Covers:** AC-01\n';
  const story = '# S\n- **Route:** feature / bounded\n- **Status:** Approved — dev · 2026-10-27\n\n| AC-01 | x | y |\n';
  const stage = (qc: string) => stageOf({ slug: 'foo', route: 'feature / bounded', story, plan, findings: null, qc, spec: '# spec' });
  assert.equal(stage('# QC\n- **Date:** 2026-10-27 · **Verdict:** FAIL — 2 issues\n').stage, 'QC failed');
  setPlan(dir, 'Completed');
  assert.equal((await cli(dir, ['item', 'set', 'foo', 'plan', 'in-progress'])).code, 0); // the failed QC reopens it
});

function setPlan(dir: string, status: string): void {
  write(planFile(dir), read(planFile(dir)).replace(/^- \*\*Overall status:\*\* .*$/m, `- **Overall status:** ${status}`));
}

test('guide counts only an exact "Accepted by: <name> · YYYY-MM-DD" as accepted: the template placeholder and a dash are not', () => {
  const plan = '# P\n- **Route:** feature / bounded\n- **Overall status:** Completed\n- **Contract:** 1\n\n## 5. Sub-unit breakdown\n### Sub-unit 1 — a · ✅ Reviewed\n- **Covers:** AC-01\n';
  const story = '# S\n- **Route:** feature / bounded\n- **Status:** Approved — dev · 2026-10-27\n\n| AC-01 | x | y |\n';
  const stage = (accepted: string) => stageOf({ slug: 'foo', route: 'feature / bounded', story, plan, findings: null, qc: `# QC\n- **Date:** 2026-10-27 · **Verdict:** PASS\n- **Accepted by:** ${accepted}\n`, spec: '# spec' }).stage;
  for (const bad of ['<exactly "<name> · YYYY-MM-DD", written only after the human accepts>', '—', '', 'dev', 'dev · 2026-13-45']) assert.equal(stage(bad), 'QC passed, not accepted', bad);
  assert.equal(stage('dev-dabour · 2026-10-27'), 'QC accepted');
});
