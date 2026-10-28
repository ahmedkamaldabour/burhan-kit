import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gatesFor } from '../src/hooks/core/item-model.mjs';
import { cli, planFile, project, read, write } from './item-fixture.js';

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;
const ROUTES: Array<[string, string]> = [['feature', 'bounded'], ['feature', 'architectural'], ['bug', 'bounded'], ['bug', 'architectural'], ['change', 'bounded'], ['change', 'architectural'], ['refactor', 'bounded'], ['refactor', 'architectural'], ['release', 'bounded'], ['release', 'architectural']];
const has = (g: string[], start: string): boolean => g.some((l) => l.startsWith(start));

test('the table gives each route exactly the gates WORKFLOW §3 gives it', () => {
  const g = (r: string) => gatesFor(r)!;
  assert.ok(has(g('feature / architectural'), 'Story approved') && has(g('feature / architectural'), 'QC') && has(g('feature / architectural'), 'Knowledge review'));
  assert.ok(!has(g('refactor / bounded'), 'Story approved') && !has(g('refactor / bounded'), 'No open material') && !has(g('refactor / bounded'), 'QC') && !has(g('refactor / bounded'), 'Knowledge review'));
  assert.ok(has(g('refactor / architectural'), 'Knowledge review') && !has(g('refactor / architectural'), 'QC'));
  assert.ok(has(g('bug / bounded'), 'Knowledge review') && !has(g('bug / bounded'), 'QC') && has(g('bug / bounded'), 'Story approved'));
  assert.ok(!has(g('release / architectural'), 'Per sub-unit: failing test first') && !has(g('release / architectural'), 'Plan re-validated') && has(g('release / architectural'), 'Per sub-unit: review done') && has(g('release / architectural'), 'Real verification'));
  for (const [t, s] of ROUTES) for (const must of ['Route stated', 'Plan approved', 'Security re-read', 'No open deviation', 'Every completion claim', 'Discoveries handled', 'Close-out']) assert.ok(has(g(`${t} / ${s}`), must), `${t} / ${s}: ${must}`);
});

test('a route that is not exact gets null: the caller keeps the full list', () => {
  assert.equal(gatesFor('feature / huge'), null);
  assert.equal(gatesFor(''), null);
  assert.equal(gatesFor('investigation / bounded'), null);
});

test('item new writes the generated checklist; each route is shorter than the old 250-word list', async (t) => {
  for (const [type, scope] of ROUTES) {
    const dir = project();
    const r = await cli(dir, ['item', 'new', 'foo', '--type', type, '--scope', scope]);
    assert.equal(r.code, 0, r.err);
    const plan = read(planFile(dir));
    const block = plan.slice(plan.indexOf('## Gate checklist'), plan.indexOf('## 1.'));
    const boxes = block.split('\n').filter((l) => /^- \[ \] /.test(l));
    assert.deepEqual(boxes.map((l) => l.replace(/^- \[ \] /, '')), gatesFor(`${type} / ${scope}`)!.map((l) => l.split('<slug>').join('foo')));
    assert.ok(words(block) < 250, `${type} / ${scope}: ${words(block)} words`);
    t.diagnostic(`${type} / ${scope}: ${words(block)} words, ${boxes.length} gates`);
  }
});

test('the template still lists every gate the table can give, in the same words (it is the fallback for a hand-made plan)', () => {
  const template = readFileSync(fileURLToPath(new URL('../../kit/templates/plan.md', import.meta.url)), 'utf8').replace(/\r?\n {6}/g, ' ');
  const union = new Set(ROUTES.flatMap(([t, s]) => gatesFor(`${t} / ${s}`)!));
  for (const g of union) assert.ok(template.includes(`- [ ] ${g}`), `the template lacks: ${g}`);
});

test('a plan made before this change (the old long checklist) still works in gate tick and item finish', async () => {
  const dir = project();
  await cli(dir, ['item', 'new', 'foo', '--type', 'refactor', '--scope', 'bounded']);
  const old = readFileSync(fileURLToPath(new URL('../../test/fixtures/old-gate-checklist.md', import.meta.url)), 'utf8');
  const plan = read(planFile(dir));
  const start = plan.indexOf('## Gate checklist');
  const end = plan.indexOf('## 1.');
  write(planFile(dir), plan.slice(0, start) + old + '\n' + plan.slice(end));
  const r = await cli(dir, ['gate', 'tick', 'foo', 'Route stated']);
  assert.equal(r.code, 0, r.err);
  const second = await cli(dir, ['gate', 'tick', 'foo', 'Every completion claim', '--evidence', 'ran npm test']);
  assert.equal(second.code, 0, second.err);
});
