import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cli, planFile, projectWithItem, read, specFile, storyFile, write } from './item-fixture.js';
import { stageOf } from '../src/hooks/core/item-stage.mjs';

const approveStory = (dir: string) => cli(dir, ['approve', 'story', 'foo', '--by', 'dev-dabour']);
const approvePlan = (dir: string) => cli(dir, ['approve', 'plan', 'foo', '--by', 'dev-dabour']);

test('burhan item check names a story AC the plan does not cover', async () => {
  const dir = await projectWithItem();
  write(storyFile(dir), read(storyFile(dir)).replace('| AC-01 |', '| AC-02 | a second one | request |\n| AC-01 |'));
  const r = await cli(dir, ['item', 'check', 'foo']);
  assert.equal(r.code, 1);
  assert.match(r.out, /cover-ac-missing/);
  assert.match(r.out, /AC-02/);
});

test('burhan item check names a plan with no spec file, and a plan sub-unit the spec lacks', async () => {
  const dir = await projectWithItem();
  write(planFile(dir), read(planFile(dir)).replace('### Sub-unit 2', '### Sub-unit 3'));
  const r = await cli(dir, ['item', 'check', 'foo']);
  assert.equal(r.code, 1);
  assert.match(r.out, /cross-unit-no-spec/);
  assert.match(r.out, /cross-spec-no-unit/);
  const gone = await projectWithItem();
  write(specFile(gone), '');
  const missing = await cli(gone, ['item', 'check', 'foo']);
  assert.match(missing.out, /spec-section-missing|spec-no-subunits/);
});

test('approve plan covers the spec: it refuses a missing spec and a spec or coverage the checks fault, and says which', async () => {
  const dir = await projectWithItem();
  await approveStory(dir);
  write(specFile(dir), read(specFile(dir)).replace(/### GREEN[\s\S]*?(?=### Lint)/, ''));
  const broken = await approvePlan(dir);
  assert.equal(broken.code, 2);
  assert.match(broken.err, /spec-part-missing/);
  assert.match(read(planFile(dir)), /\*\*Overall status:\*\* Draft/);
  const gone = await projectWithItem();
  await approveStory(gone);
  const { rmSync } = await import('node:fs');
  rmSync(specFile(gone));
  const none = await approvePlan(gone);
  assert.equal(none.code, 2);
  assert.match(none.err, /build spec/);
});

test('approve plan passes when the plan, the spec and the coverage hold', async () => {
  const dir = await projectWithItem();
  await approveStory(dir);
  const r = await approvePlan(dir);
  assert.equal(r.code, 0, r.err);
  assert.match(read(planFile(dir)), /\*\*Overall status:\*\* Approved/);
});

test('guide on a Draft plan with no spec says to write the build spec', () => {
  const plan = '# P\n- **Route:** feature / bounded\n- **Overall status:** Draft\n\n## 5. Sub-unit breakdown\n### Sub-unit 1 — a · ⬜ Draft\n';
  const story = '# S\n- **Route:** feature / bounded\n- **Status:** Approved — dev · 2026-10-27\n\n| AC-01 | x | y |\n';
  const s = stageOf({ slug: 'foo', route: 'feature / bounded', story, plan, findings: null, qc: null, spec: null });
  assert.equal(s.authorized, false);
  assert.match(s.next, /build spec/);
  assert.match(s.next, /approve plan/);
  const withSpec = stageOf({ slug: 'foo', route: 'feature / bounded', story, plan, findings: null, qc: null, spec: '# spec' });
  assert.doesNotMatch(withSpec.next, /write .*build-spec/);
});

// ---- review round 1 (SU10) ----
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test('with WF_ITEM_CONTRACT=on a plan without the marker cannot be approved while its spec is missing', async () => {
  const dir = await projectWithItem();
  writeFileSync(join(dir, '.burhan', 'workflow.config'), 'WF_ITEM_CONTRACT=on\n');
  await approveStory(dir);
  write(planFile(dir), read(planFile(dir)).replace('- **Contract:** 1\n', ''));
  rmSync(specFile(dir));
  const r = await approvePlan(dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /build spec/);
  assert.match(read(planFile(dir)), /\*\*Overall status:\*\* Draft/);
});

test('guide does not authorize code for an approved plan whose spec is missing', () => {
  const plan = '# P\n- **Route:** feature / bounded\n- **Overall status:** Approved\n- **Contract:** 1\n\n## 5. Sub-unit breakdown\n### Sub-unit 1 — a · 🟡 Approved\n';
  const story = '# S\n- **Route:** feature / bounded\n- **Status:** Approved — dev · 2026-10-27\n\n| AC-01 | x | y |\n';
  const s = stageOf({ slug: 'foo', route: 'feature / bounded', story, plan, findings: null, qc: null, spec: null });
  assert.equal(s.authorized, false);
  assert.match(s.stage, /build spec/);
  assert.equal(stageOf({ slug: 'foo', route: 'feature / bounded', story, plan, findings: null, qc: null, spec: '# spec' }).authorized, true);
  assert.equal(stageOf({ slug: 'foo', route: 'feature / bounded', story, plan: plan.replace('- **Contract:** 1\n', ''), findings: null, qc: null, spec: null }).authorized, true); // an old plan: no spec to ask for
});

test('burhan item check names a marked plan whose spec file is gone', async () => {
  const dir = await projectWithItem();
  rmSync(specFile(dir));
  const r = await cli(dir, ['item', 'check', 'foo']);
  assert.equal(r.code, 1);
  assert.match(r.out, /spec-missing/);
});
