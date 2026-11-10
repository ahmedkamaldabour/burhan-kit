import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { checkText } from '../src/hooks/core/item-contract.mjs';
import { cli, planFile, projectWithItem, read, write } from './item-fixture.js';

const unit = (n: number, why: string | null = 'A3'): string =>
  `### Sub-unit ${n} — u${n} · 🟡 Approved\n- **Covers:** AC-01\n${why === null ? '' : `- **Why separate:** ${why}\n`}`;
const units = (count: number): string => Array.from({ length: count }, (_, i) => unit(i + 1)).join('');
const plan = (breakdown: string): string =>
  `# T — Implementation Plan\n- **Route:** refactor / bounded\n- **Overall status:** In progress\n- **Contract:** 1\n\n## Gate checklist\n- [x] Plan approved\n\n## 5. Sub-unit breakdown\n${breakdown}\n## 9. Executor rules\n1. Follow the plan.\n\n## 10. Deviations\n| # | Sub-unit | What | Where | Output | Status | Decision |\n|---|----------|------|-------|--------|--------|----------|\n`;
const faults = (text: string): Array<{ code: string; message: string }> => checkText('plan', text).filter((f) => f.code.startsWith('plan-subunit-'));
const CAP_LINE = '- **More than 6 because:** the A-reason of each extra sub-unit\n';

test('a sub-unit with no Why separate line is named by its number', () => {
  assert.deepEqual(checkText('plan', plan(units(2))), []);
  const found = faults(plan(unit(1) + unit(2, null) + unit(3)));
  assert.deepEqual(found.map((f) => f.code), ['plan-subunit-why']);
  assert.match(found[0]!.message, /Sub-unit 2 has no "- \*\*Why separate:\*\*/);
});

test('a Why separate value outside A1, A2, A3 is named; a list is accepted', () => {
  for (const bad of ['A4', '', 'none', 'A1 A3', 'A1, B2', 'a1']) {
    const found = faults(plan(unit(1, bad)));
    assert.deepEqual(found.map((f) => f.code), ['plan-subunit-why'], `value "${bad}"`);
    assert.match(found[0]!.message, /Sub-unit 1/);
  }
  for (const good of ['A1', 'A2', 'A3', 'A1, A3', 'A2,A3', 'A1, A2, A3']) assert.deepEqual(faults(plan(unit(1, good))), [], `value "${good}"`);
  // a template placeholder is left to approve, which refuses every placeholder
  assert.deepEqual(faults(plan(unit(1, '<A1 | A2 | A3, one or more: what makes it its own sub-unit>'))), []);
});

test('more than 6 sub-units need the More than 6 because line; exactly 6 do not', () => {
  assert.deepEqual(faults(plan(units(6))), []);
  const seven = faults(plan(units(7)));
  assert.deepEqual(seven.map((f) => f.code), ['plan-subunit-cap']);
  assert.match(seven[0]!.message, /7 sub-units/);
  assert.deepEqual(faults(plan(CAP_LINE + units(7))), []);
  assert.deepEqual(faults(plan(units(7) + CAP_LINE)), []);
  assert.deepEqual(faults(plan('- **More than 6 because:**\n' + units(7))).map((f) => f.code), ['plan-subunit-cap']);
});

test('no line and 7 sub-units give every fault; a plan without the Contract line gets them as advice', async () => {
  const mixed = unit(1, null) + unit(2, 'A4') + unit(3) + unit(4) + unit(5) + unit(6) + unit(7);
  assert.deepEqual(faults(plan(mixed)).map((f) => f.code), ['plan-subunit-why', 'plan-subunit-why', 'plan-subunit-cap']);
  const dir = await projectWithItem();
  const text = read(planFile(dir));
  write(planFile(dir), text.replace(/^- \*\*Contract:\*\* 1\n/m, '').replace('- **Why separate:** A3\n', ''));
  const r = await cli(dir, ['item', 'check', 'foo']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /plan-subunit-why: Sub-unit 1 has no/);
});

test('item new writes the Why separate placeholder and no marker line', async () => {
  const dir = await projectWithItem({ raw: true });
  const text = read(planFile(dir));
  assert.match(text, /^- \*\*Why separate:\*\* <A1 \| A2 \| A3/m);
  assert.doesNotMatch(text, /Findings gate|Rule version|Sub-unit rule|Sub-unit cap/);
  const r = await cli(dir, ['item', 'check', 'foo']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.doesNotMatch(r.out, /Why separate/);
});

test('a filled item passes item check and approves; a placeholder left in Why separate stops approve plan', async () => {
  const dir = await projectWithItem();
  const r = await cli(dir, ['item', 'check', 'foo']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.doesNotMatch(r.out, /Why separate/);
  assert.equal((await cli(dir, ['approve', 'story', 'foo', '--by', 'dev-dabour'])).code, 0);
  const placeholder = read(join(dir, '.burhan', 'templates', 'plan.md')).split('\n').find((l) => l.startsWith('- **Why separate:**'));
  assert.ok(placeholder !== undefined, 'the template has the Why separate line');
  const filled = read(planFile(dir));
  assert.match(filled, /^- \*\*Why separate:\*\* A3$/m);
  write(planFile(dir), filled.replace('- **Why separate:** A3', placeholder!));
  const refused = await cli(dir, ['approve', 'plan', 'foo', '--by', 'dev-dabour']);
  assert.notEqual(refused.code, 0);
  assert.match(refused.err, /placeholder/);
  assert.match(refused.err, /Why separate/);
  write(planFile(dir), filled);
  assert.equal((await cli(dir, ['approve', 'plan', 'foo', '--by', 'dev-dabour'])).code, 0);
});
