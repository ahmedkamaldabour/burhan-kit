import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli, planFile, projectWithItem, read, specFile, storyFile, write } from './item-fixture.js';

// Tests run from .test-build/test, so the repository root is two levels up.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FENCE = '`'.repeat(3);
const kit = (rel: string): string => readFileSync(join(ROOT, 'kit', rel), 'utf8').replace(/\r\n/g, '\n');
/** The text with its markup and line breaks squeezed out, so a phrase is found across a wrapped line. */
const flat = (rel: string): string => kit(rel).replace(/[`*]/g, '').replace(/\s+/g, ' ');
const WHY = '- **Why separate:** <A1 | A2 | A3, one or more (their meaning: phases/stage-plan.md · Sub-units)>';

test('AC-01: the plan template shows the Why separate codes alone and points to the stage file for their meaning', () => {
  const lines = kit('templates/plan.md').split('\n').filter((l) => l.startsWith('- **Why separate:**'));
  assert.deepEqual(lines, [WHY]);
  assert.ok(flat('templates/plan.md').includes('The Why separate: line holds the codes alone'));
});

test('AC-01: a code alone, or a list of codes, passes item check; a code with text after it is still named', async () => {
  const dir = await projectWithItem();
  const plan = read(planFile(dir));
  for (const ok of ['A3', 'A1, A3']) {
    write(planFile(dir), plan.replace('- **Why separate:** A3', `- **Why separate:** ${ok}`));
    const r = await cli(dir, ['item', 'check', 'foo']);
    assert.equal(r.code, 0, `${ok}: ${r.out}${r.err}`);
  }
  write(planFile(dir), plan.replace('- **Why separate:** A3', '- **Why separate:** A3 (own test)'));
  assert.match((await cli(dir, ['item', 'check', 'foo'])).out, /plan-subunit-why/);
});

test('AC-02: the build spec template says how a mechanical edit is written', () => {
  const t = flat('templates/build-spec.md');
  for (const p of ['For a purely mechanical edit (a word, a line, a path)', 'change this heading to "### Edit"', 'before and after in one fenced block', 'under a line before:', 'under a line after:', 'No other code is invented', 'need a fenced block']) {
    assert.ok(t.includes(p), p);
  }
});

test('AC-02: item check accepts an Edit part with its text before and after in a fenced block and names one with no fence', async () => {
  const dir = await projectWithItem();
  const spec = read(specFile(dir));
  const part = new RegExp(`### Implementation\\n[\\s\\S]*?${FENCE}\\n[\\s\\S]*?${FENCE}\\n`);
  assert.match(spec, part);
  write(specFile(dir), spec.replace(part, `### Edit\n${FENCE}\nbefore: a\nafter: b\n${FENCE}\n`));
  const fenced = await cli(dir, ['item', 'check', 'foo']);
  assert.equal(fenced.code, 0, fenced.out + fenced.err);
  write(specFile(dir), spec.replace(part, '### Edit\nbefore: a\nafter: b\n'));
  assert.match((await cli(dir, ['item', 'check', 'foo'])).out, /spec-code-missing/);
});

test('AC-03: a new plan carries a Knowledge review line that is valid at plan time and says when it is settled', async () => {
  const line = kit('templates/plan.md').split('\n').find((l) => l.startsWith('Knowledge review:'));
  assert.ok(line !== undefined && line.startsWith('Knowledge review: decide at close-out <') && line.includes('leave this line until QC is done'), String(line));
  const dir = await projectWithItem();
  assert.ok(read(planFile(dir)).includes(line!), 'item new writes the line');
  assert.equal((await cli(dir, ['approve', 'story', 'foo', '--by', 'dev-dabour'])).code, 0);
  const r = await cli(dir, ['approve', 'plan', 'foo', '--by', 'dev-dabour']);
  assert.equal(r.code, 0, r.err);
  assert.ok(read(planFile(dir)).includes(line!), 'the line is still there after approval');
  assert.doesNotMatch((await cli(dir, ['item', 'check', 'foo'])).out, /placeholder-left/);
});

test('AC-04: the templates and the Fields table document the none-yet forms', () => {
  assert.ok(flat('templates/plan.md').includes('- Branch: <branch, or none yet while the work has no branch>'));
  assert.ok(flat('templates/story.md').includes('none (no PROJECT.md) when the project has no PROJECT.md yet'));
  assert.ok(flat('phases/files.md').includes('n/a (greenfield) or none (no PROJECT.md)'));
});

test('AC-04: a story with Baseline none (no PROJECT.md) and a plan with Branch none yet pass item check and both approvals', async () => {
  const dir = await projectWithItem();
  write(storyFile(dir), read(storyFile(dir)).replace(/^- \*\*Baseline:\*\* .*$/m, '- **Baseline:** none (no PROJECT.md)'));
  write(planFile(dir), read(planFile(dir)).replace(/^- \*\*Branch:\*\* .*$/m, '- **Branch:** none yet'));
  assert.match(read(storyFile(dir)), /^- \*\*Baseline:\*\* none \(no PROJECT\.md\)$/m);
  assert.match(read(planFile(dir)), /^- \*\*Branch:\*\* none yet$/m);
  const check = await cli(dir, ['item', 'check', 'foo']);
  assert.equal(check.code, 0, check.out + check.err);
  for (const kind of ['story', 'plan']) {
    const r = await cli(dir, ['approve', kind, 'foo', '--by', 'dev-dabour']);
    assert.equal(r.code, 0, `${kind}: ${r.err}`);
  }
});

test('AC-05, AC-06: stage-story.md gives routing examples and says who settles an escalator doubt', () => {
  const t = flat('phases/stage-story.md');
  for (const p of ['## Routing examples', 'A one-line feature is bounded, never patch', 'a class its module exports', 'public API', 'It puts one question to the owner, with its recommendation', 'keeps the lighter route provisionally and says so in the story', "the owner's answer settles the route"]) {
    assert.ok(t.includes(p), p);
  }
});

test('AC-05, AC-07: the core points at the examples in two words and stays within 1,600 words', () => {
  const core = kit('WORKFLOW.md').split('\n## الخلاصة')[0]!;
  assert.ok(core.replace(/\s+/g, ' ').includes('any doubt → `bounded` (examples: phases/stage-story.md).'));
  assert.ok(core.split(/\s+/).filter(Boolean).length <= 1600);
});
