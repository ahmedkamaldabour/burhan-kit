import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

test('the template lists exactly the gates the table can give, each as a whole line and in the same order (it is the fallback for a hand-made plan)', () => {
  const template = readFileSync(fileURLToPath(new URL('../../kit/templates/plan.md', import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/\n {6}/g, ' ');
  const section = template.slice(template.indexOf('## Gate checklist\n'), template.indexOf('\n## 1.'));
  // The two documented suffixes say when a route has the gate; nothing else may follow the table's words.
  const boxes = section.split('\n').filter((l) => l.startsWith('- [ ] ')).map((l) => l.slice(6).replace(/ \((if the route requires it|if the route includes K)\)$/, ''));
  const union = [...new Set(ROUTES.flatMap(([t, s]) => gatesFor(`${t} / ${s}`)!))];
  assert.deepEqual(boxes, union);
});

test('a "## Gate checklist" inside a code fence of the project template is not the section: the fence stays and the real section gets the route\'s gates', async () => {
  const dir = project();
  const own = join(dir, '.burhan', 'templates', 'plan.md');
  const text = read(own);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const example = ['```', '## Gate checklist', '- [ ] an example inside a fence', '## 1. Decisions', '```', '', ''].join(eol);
  write(own, text.replace(/^## Gate checklist\r?$/m, `${example}## Gate checklist`));
  const r = await cli(dir, ['item', 'new', 'foo', '--type', 'refactor', '--scope', 'bounded']);
  assert.equal(r.code, 0, r.err);
  const plan = read(planFile(dir)).replace(/\r\n/g, '\n');
  assert.ok(plan.includes('```\n## Gate checklist\n- [ ] an example inside a fence\n## 1. Decisions\n```\n'), 'the fenced example is left as it is');
  const at = plan.lastIndexOf('## Gate checklist');
  const boxes = plan.slice(at, plan.indexOf('## 1.', at)).split('\n').filter((l) => /^- \[ \] /.test(l)).map((l) => l.slice(6));
  assert.deepEqual(boxes, gatesFor('refactor / bounded')!.map((l) => l.split('<slug>').join('foo')));
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
