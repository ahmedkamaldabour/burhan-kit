import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skillFor } from '../src/hooks/core/item-stage.mjs';

const B = 'superpowers:brainstorming';
const P = 'superpowers:writing-plans';
const T = 'superpowers:test-driven-development';
const R = 'superpowers:requesting-code-review';
const V = 'superpowers:verification-before-completion';
const D = 'superpowers:systematic-debugging';
const FEATURE = 'feature / architectural';
const BUG = 'bug / bounded';
const INV = 'investigation / bounded';

// [stage as stageOf names it, route, the skill to run before the next write (null: none)]
const TABLE: Array<[string, string, string | null]> = [
  ['no item files', FEATURE, B], ['no story', FEATURE, B], ['story draft', FEATURE, B],
  ['story approved, no plan', FEATURE, P], ['no plan', 'refactor / bounded', P], ['plan draft', FEATURE, P], ['build spec missing', FEATURE, P],
  ['Sub-unit 1 to start', FEATURE, T], ['Sub-unit 2 in progress', FEATURE, T], ['Sub-unit 3 has no status', FEATURE, T], ['plan without sub-units', FEATURE, T],
  ['Sub-unit 1 implemented', FEATURE, R],
  ['all sub-units reviewed', FEATURE, V], ['plan completed', 'change / bounded', V], ['awaiting QC', FEATURE, V],
  ['QC failed', FEATURE, D],
  ['QC passed, not accepted', FEATURE, null], ['QC accepted', FEATURE, null], ['deviation open', FEATURE, null],
  ['plan Paused', FEATURE, null], ['plan Superseded', FEATURE, null], ['route not allowed', 'feature / spike', null], ['plan status not recognised', FEATURE, null],
  ['patch lane', 'change / patch', null],
  ['no findings file', INV, D], ['investigating', INV, D], ['findings concluded', INV, null],
  ['story draft', BUG, D], ['story approved, no plan', BUG, D], ['plan draft', BUG, D], ['Sub-unit 1 in progress', BUG, D],
  ['Sub-unit 1 implemented', BUG, R], ['all sub-units reviewed', BUG, V], ['plan completed', BUG, V], ['QC failed', BUG, D],
];

test('the stage → skill table', () => {
  for (const [stage, route, want] of TABLE) assert.equal(skillFor({ stage }, route)?.skill ?? null, want, `${route} · ${stage}`);
});

test('every skill comes with a reason that reads after "run it"', () => {
  for (const [stage, route, want] of TABLE) {
    if (want === null) continue;
    const why = skillFor({ stage }, route)!.why;
    assert.match(why, /^(before|to) /, `${route} · ${stage}: ${why}`);
  }
});
