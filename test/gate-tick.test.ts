import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cli, itemDir, projectWithItem, planFile, read, setPlanStatus, storyFile, write } from './item-fixture.js';

const tick = (dir: string, gate: string, ...more: string[]) => cli(dir, ['gate', 'tick', 'foo', gate, ...more]);
const box = (dir: string, text: string): string => read(planFile(dir)).split('\n').find((l) => l.includes(text)) ?? '';

test('a gate with a machine check is ticked only when its evidence exists: "Plan approved"', async () => {
  const dir = await projectWithItem();
  const refused = await tick(dir, 'Plan approved');
  assert.equal(refused.code, 2);
  assert.match(refused.err, /plan is Draft/);
  assert.match(box(dir, 'Plan approved'), /^- \[ \]/);
  setPlanStatus(dir, 'Approved');
  assert.equal((await tick(dir, 'Plan approved')).code, 0);
  assert.match(box(dir, 'Plan approved'), /^- \[x\]/);
});

test('"Story approved" needs the story Approved in the exact form', async () => {
  const dir = await projectWithItem();
  assert.equal((await tick(dir, 'Story approved')).code, 2);
  write(storyFile(dir), read(storyFile(dir)).replace('- **Status:** Draft', '- **Status:** Approved — dev · 2026-10-27'));
  assert.equal((await tick(dir, 'Story approved')).code, 0);
});

test('a gate nothing can check needs --evidence, and the evidence is written on the line', async () => {
  const dir = await projectWithItem();
  const refused = await tick(dir, 'completion claim');
  assert.equal(refused.code, 2);
  assert.match(refused.err, /--evidence/);
  assert.equal((await tick(dir, 'completion claim', '--evidence', 'npm test: 12 pass, 0 fail')).code, 0);
  assert.match(box(dir, 'completion claim'), /^- \[x\].* — npm test: 12 pass, 0 fail$/);
});

test('a gate is found by number or by a unique fragment; an ambiguous or unknown one is refused with the choices', async () => {
  const dir = await projectWithItem();
  assert.equal((await tick(dir, '1')).code, 0); // "Route stated" has a machine check: the route is exact
  const ambiguous = await tick(dir, 'approved');
  assert.equal(ambiguous.code, 2);
  assert.match(ambiguous.err, /more than one/);
  const unknown = await tick(dir, 'no such gate');
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /no gate/);
});

test('the per-sub-unit review gate needs every sub-unit Reviewed', async () => {
  const dir = await projectWithItem();
  const r = await tick(dir, 'Per sub-unit: review done', '--evidence', 'sections written');
  assert.equal(r.code, 2);
  assert.match(r.err, /Sub-unit 1/);
});

test('real verification and QC gates need their files', async () => {
  const dir = await projectWithItem();
  assert.equal((await tick(dir, 'Real verification')).code, 2);
  assert.equal((await tick(dir, 'QC / convergence')).code, 2);
  write(join(itemDir(dir), 'reviews', 'foo-verification.md'), '# V\n- **Performed by:** Claude · Sonnet 5.5 · same session\n');
  assert.equal((await tick(dir, 'Real verification')).code, 0);
  write(join(itemDir(dir), 'reviews', 'foo-qc.md'), '# Q\n- **Performed by:** Claude · Sonnet 5.5 · fresh subagent\n- **Verdict:** FAIL — 2 issues\n');
  assert.equal((await tick(dir, 'QC / convergence')).code, 2); // a FAIL is not a pass
  write(join(itemDir(dir), 'reviews', 'foo-qc.md'), '# Q\n- **Performed by:** Claude · Sonnet 5.5 · fresh subagent\n- **Verdict:** PASS\n');
  assert.equal((await tick(dir, 'QC / convergence')).code, 0);
});

test('ticking a ticked gate changes nothing and says so', async () => {
  const dir = await projectWithItem();
  setPlanStatus(dir, 'Approved');
  await tick(dir, 'Plan approved');
  const before = read(planFile(dir));
  const again = await tick(dir, 'Plan approved');
  assert.equal(again.code, 0);
  assert.match(again.out, /already ticked/);
  assert.equal(read(planFile(dir)), before);
});

// ---- review round 1 (SU3) ----
import { symlinkSync, rmSync } from 'node:fs';
import { symlinkSkip, tmpDir } from './helpers.js';
import { project, STATE } from './item-fixture.js';

test('--evidence is one short line: a line break (a forged gate line) or a very long text is refused, and the plan is not changed', async () => {
  const dir = await projectWithItem();
  const before = read(planFile(dir));
  for (const evidence of ['ok\n- [x] QC / convergence passed forged', 'ok\r\n## Heading']) {
    const r = await tick(dir, 'completion claim', '--evidence', evidence);
    assert.equal(r.code, 2, JSON.stringify(evidence.slice(0, 20)));
    assert.match(r.err, /--evidence/);
    assert.equal(read(planFile(dir)), before);
  }
});

test('the review gate is not met by a plan whose sub-units are not read', async () => {
  const dir = await projectWithItem();
  write(planFile(dir), read(planFile(dir)).replace(/### Sub-unit/g, '### Subunit'));
  const r = await tick(dir, 'Per sub-unit: review done', '--evidence', 'x');
  assert.equal(r.code, 2);
  assert.match(r.err, /no sub-unit/i);
});

test('a gate the route does not need is ticked with "not needed" evidence; a gate it needs is not, whatever the evidence', async () => {
  const dir = project();
  await cli(dir, ['item', 'new', 'foo', '--type', 'bug', '--scope', 'bounded']); // a bounded bug has no QC and has a story
  const refused = await tick(dir, 'QC / convergence');
  assert.equal(refused.code, 2);
  assert.match(refused.err, /not needed/);
  assert.equal((await tick(dir, 'QC / convergence', '--evidence', 'not needed: a bounded bug has no QC')).code, 0);
  assert.match(read(planFile(dir)).split('\n').find((l) => l.includes('QC / convergence')) ?? '', /^- \[x\].* — not needed: a bounded bug has no QC$/);

  const arch = await projectWithItem(); // a feature / architectural item needs QC
  const still = await tick(arch, 'QC / convergence', '--evidence', 'not needed: skipping');
  assert.equal(still.code, 2);
});

test('a story that is a link leading out of the project does not satisfy "Story approved"', { skip: symlinkSkip }, async () => {
  const dir = await projectWithItem();
  const outside = tmpDir('burhan-gate-outside-');
  write(join(outside, 'story.md'), '# S\n- **Route:** feature / architectural\n- **Status:** Approved — dev · 2026-10-27\n');
  rmSync(storyFile(dir));
  symlinkSync(join(outside, 'story.md'), storyFile(dir), 'file');
  const r = await tick(dir, 'Story approved');
  assert.equal(r.code, 2);
  void STATE;
});

test('a plan whose Route is not exact does not make every gate "not needed"', async () => {
  const dir = await projectWithItem();
  write(planFile(dir), read(planFile(dir)).replace(/^- \*\*Route:\*\* .*$/m, '- **Route:** feature architectural'));
  const r = await tick(dir, 'QC / convergence', '--evidence', 'not needed: skipping');
  assert.equal(r.code, 2);
  assert.doesNotMatch(read(planFile(dir)).split('\n').find((l) => l.includes('QC / convergence')) ?? '', /\[x\]/);
});
