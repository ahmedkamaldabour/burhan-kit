import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli, planFile, projectWithItem, read, setPlanStatus, write } from './item-fixture.js';
import { stageOf } from '../src/hooks/core/item-stage.mjs';
import { deviations } from '../src/hooks/core/item-model.mjs';

// Tests run from .test-build/test, so the repository root is two levels up.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const kit = (name: string): string => readFileSync(join(ROOT, 'kit', name), 'utf8');

/** A project whose plan is approved and being built (the state a deviation can happen in). */
async function building(): Promise<string> {
  const dir = await projectWithItem();
  await cli(dir, ['approve', 'story', 'foo', '--by', 'dev-dabour']);
  await cli(dir, ['approve', 'plan', 'foo', '--by', 'dev-dabour']);
  return dir;
}
const add = (dir: string, ...args: string[]) => cli(dir, ['deviation', 'add', 'foo', '--unit', '1', '--what', 'RED passed', '--where', 'src/a.ts:10', '--output', 'pass 1', ...args]);
const resolve = (dir: string, ...rest: string[]) => cli(dir, ['deviation', 'resolve', 'foo', ...rest]);
const rows = (dir: string) => deviations(read(planFile(dir)));

test('deviation add writes an open row to the Deviations table, numbered from 1', async () => {
  const dir = await building();
  const r = await add(dir);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(rows(dir).map((x) => [x.n, x.unit, x.status]), [[1, 1, 'open']]);
  assert.equal(rows(dir)[0]!.what, 'RED passed');
  await add(dir);
  assert.deepEqual(rows(dir).map((x) => x.n), [1, 2]);
  assert.match(r.out, /STOP/);
});

test('a row stays one table row: a pipe is escaped, a line break becomes one line, and nothing is limited in length', async () => {
  const dir = await building();
  const out = `line one | with a pipe\nline two\n${'x'.repeat(5000)}`;
  const r = await cli(dir, ['deviation', 'add', 'foo', '--unit', '1', '--what', 'a | b', '--where', 'src/a.ts', '--output', out]);
  assert.equal(r.code, 0, r.err);
  const row = rows(dir)[0]!;
  assert.equal(row.what, 'a | b'); // the escaped pipe reads back as the pipe it was
  assert.ok(row.output.length > 5000);
  assert.equal(read(planFile(dir)).split('\n').filter((l) => /^\| 1 \|/.test(l)).length, 1);
  assert.equal((await cli(dir, ['item', 'check', 'foo'])).out.includes('deviation-status'), false);
});

test('deviation add refuses what makes no sense: no unit, an unknown unit, a missing field, a plan that is not being built', async () => {
  const dir = await building();
  for (const args of [['--what', 'x', '--where', 'y', '--output', 'z'], ['--unit', '9', '--what', 'x', '--where', 'y', '--output', 'z'], ['--unit', '1', '--where', 'y', '--output', 'z'], ['--unit', '1', '--what', 'x', '--output', 'z'], ['--unit', '1', '--what', 'x', '--where', 'y']]) {
    const r = await cli(dir, ['deviation', 'add', 'foo', ...args]);
    assert.equal(r.code, 2, args.join(' '));
  }
  assert.deepEqual(rows(dir), []);
  const draft = await projectWithItem();
  const r = await add(draft);
  assert.equal(r.code, 2);
  assert.match(r.err, /Approved or In progress/);
});

test('burhan item check lists an open deviation, and a closed one is quiet', async () => {
  const dir = await building();
  await add(dir);
  const open = await cli(dir, ['item', 'check', 'foo']);
  assert.equal(open.code, 1);
  assert.match(open.out, /deviation-open/);
  assert.match(open.out, /RED passed/);
  await resolve(dir, '1', '--approved', '--by', 'dev-dabour');
  assert.equal((await cli(dir, ['item', 'check', 'foo'])).code, 0);
});

test('a Deviations row with a status that is not open, approved or rejected, or with an empty field, is named', async () => {
  const dir = await building();
  await add(dir);
  write(planFile(dir), read(planFile(dir)).replace('| open |', '| maybe |'));
  assert.match((await cli(dir, ['item', 'check', 'foo'])).out, /deviation-status/);
  write(planFile(dir), read(planFile(dir)).replace('| maybe |', '| approved |').replace('| src/a.ts:10 |', '|  |'));
  assert.match((await cli(dir, ['item', 'check', 'foo'])).out, /deviation-incomplete/);
});

test('deviation resolve closes an open row for the owner: approved or rejected, with the name and the date', async () => {
  const dir = await building();
  await add(dir);
  const ok = await resolve(dir, '1', '--approved', '--by', 'dev-dabour', '--decision', 'update the spec first');
  assert.equal(ok.code, 0, ok.err);
  const row = rows(dir)[0]!;
  assert.equal(row.status, 'approved');
  assert.match(row.decision, /dev-dabour · \d{4}-\d{2}-\d{2} — update the spec first/);
  assert.match(ok.out, /agent-run|run from the shell/);
  assert.equal((await resolve(dir, '1', '--rejected', '--by', 'dev-dabour')).code, 2); // it is not open any more
});

test('deviation resolve refuses an agent name, no name, neither or both of approved and rejected, and an unknown row', async () => {
  const dir = await building();
  await add(dir);
  for (const args of [['1', '--approved', '--by', 'Claude'], ['1', '--approved'], ['1', '--by', 'dev'], ['1', '--approved', '--rejected', '--by', 'dev'], ['7', '--approved', '--by', 'dev']]) {
    const r = await resolve(dir, ...args);
    assert.equal(r.code, 2, args.join(' '));
  }
  assert.equal(rows(dir)[0]!.status, 'open');
});

test('guide says STOP and authorizes no code while a deviation is open, and says what to do', async () => {
  const dir = await building();
  assert.match((await cli(dir, ['guide', 'foo'])).out, /code edits: AUTHORIZED/);
  await add(dir);
  const g = await cli(dir, ['guide', 'foo']);
  assert.match(g.out, /code edits: NOT authorized — .*deviation/i);
  assert.match(g.out, /next: STOP/);
  assert.match(g.out, /ask the owner/);
  await resolve(dir, '1', '--approved', '--by', 'dev-dabour');
  assert.match((await cli(dir, ['guide', 'foo'])).out, /code edits: AUTHORIZED/);
});

test('the gate "No open deviation" is ticked only when none is open, and item finish refuses while one is', async () => {
  const dir = await building();
  await add(dir);
  const refused = await cli(dir, ['gate', 'tick', 'foo', 'No open deviation']);
  assert.equal(refused.code, 2);
  assert.match(refused.err, /deviation/);
  await resolve(dir, '1', '--rejected', '--by', 'dev-dabour');
  assert.equal((await cli(dir, ['gate', 'tick', 'foo', 'No open deviation'])).code, 0);
  // finish: put the plan where it would finish, then open a deviation again
  setPlanStatus(dir, 'In progress');
  write(planFile(dir), read(planFile(dir)).replace(/· 🟡 Approved$/gm, '· ✅ Reviewed').replace(/- \[ \]/g, '- [x]'));
  await add(dir);
  const fin = await cli(dir, ['item', 'finish', 'foo', '--evidence', 'x']);
  assert.equal(fin.code, 2);
  assert.match(fin.err, /deviation/);
});

test('stageOf: an open deviation stops an approved plan, a closed one does not, and a Completed plan is not changed by it', () => {
  const deviationTable = (status: string): string => `\n## 10. Deviations\n| # | Sub-unit | What | Where | Output | Status | Decision |\n|---|----------|------|-------|--------|--------|----------|\n| 1 | 1 | RED passed | src/a.ts | pass | ${status} | |\n`;
  const plan = (status: string, dev: string): string => `# P\n- **Route:** feature / bounded\n- **Overall status:** ${status}\n- **Contract:** 1\n\n## 5. Sub-unit breakdown\n### Sub-unit 1 — a · 🔵 In progress\n- **Covers:** AC-01\n${dev}`;
  const story = '# S\n- **Route:** feature / bounded\n- **Status:** Approved — dev · 2026-10-27\n\n| AC-01 | x | y |\n';
  const at = (p: string) => stageOf({ slug: 'foo', route: 'feature / bounded', story, plan: p, findings: null, qc: null, spec: '# spec' });
  const open = at(plan('In progress', deviationTable('open')));
  assert.equal(open.authorized, false);
  assert.match(open.stage, /deviation open/);
  assert.match(open.next, /STOP/);
  assert.equal(at(plan('In progress', deviationTable('approved'))).authorized, true);
  assert.equal(at(plan('In progress', deviationTable('rejected'))).authorized, true);
});

test('the next step after a sub-unit says what to run: its test files and the fast check, the full suite later', () => {
  const plan = '# P\n- **Route:** feature / bounded\n- **Overall status:** In progress\n- **Contract:** 1\n\n## 5. Sub-unit breakdown\n### Sub-unit 1 — a · 🔵 In progress\n- **Covers:** AC-01\n';
  const story = '# S\n- **Route:** feature / bounded\n- **Status:** Approved — dev · 2026-10-27\n\n| AC-01 | x | y |\n';
  const s = stageOf({ slug: 'foo', route: 'feature / bounded', story, plan, findings: null, qc: null, spec: '# spec' });
  assert.match(s.next, /only its test files/);
  assert.match(s.next, /full suite at QC, before a commit/);
});

test('the kit tells an executor to follow the plan exactly and to stop on a deviation: the plan template, the build stage file and the builder agent', () => {
  const plan = kit('templates/plan.md');
  assert.match(plan, /^## \d+\. Executor rules$/m);
  assert.match(plan, /exactly: the same files, the same code, the same order, the same commands/);
  assert.match(plan, /means STOP/);
  assert.match(plan, /^## \d+\. Deviations$/m);
  for (const file of ['phases/stage-build.md', 'agents/claude/burhan-builder.md']) {
    const text = kit(file);
    assert.match(text, /exactly/i, file);
    assert.match(text, /Deviations/, file);
    assert.match(text, /STOP/, file);
  }
  assert.match(kit('phases/stage-build.md'), /only its test files/);
});

// ---- review round 1 (SU12): an unreadable row stops the work, and a long run of spaces is not slow ----
test('a Deviations row that is not readable as approved or rejected stops the work (it fails closed)', async () => {
  for (const [from, to] of [['| open |', '| maybe |'], ['| open |', '| **open** |'], ['| open |', '| open ✅ |'], ['| open |', '|  |'], ['| 1 |', '| #1 |'], ['| 1 |', '| 1. |'], ['## 10. Deviations', '## 10. deviations']]) {
    const dir = await building();
    await add(dir);
    write(planFile(dir), read(planFile(dir)).replace(from!, to!));
    const g = await cli(dir, ['guide', 'foo']);
    assert.match(g.out, /code edits: NOT authorized/, `${from} → ${to}`);
    assert.equal((await cli(dir, ['gate', 'tick', 'foo', 'No open deviation'])).code, 2, `${from} → ${to}`);
  }
});

test('a long run of spaces in --what is one cell and is fast', async () => {
  const dir = await building();
  const start = Date.now();
  const r = await cli(dir, ['deviation', 'add', 'foo', '--unit', '1', '--what', `a${' '.repeat(100_000)}b`, '--where', 'y', '--output', 'z']);
  assert.equal(r.code, 0, r.err);
  assert.ok(Date.now() - start < 3000, `took ${Date.now() - start} ms`);
});
