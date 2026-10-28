import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cli, itemDir, planFile, projectWithItem, read, storyFile, unitLine, write } from './item-fixture.js';
import { storyIsApproved } from '../src/hooks/core/item-contract.mjs';

const approve = (dir: string, what: string, ...args: string[]) => cli(dir, ['approve', what, 'foo', ...args]);
const gate = (dir: string, text: string): string => read(planFile(dir)).split('\n').find((l) => l.includes(text)) ?? '';

test('approve story writes the exact form, ticks "Story approved", and the item still checks', async () => {
  const dir = await projectWithItem();
  const r = await approve(dir, 'story', '--by', 'dev-dabour');
  assert.equal(r.code, 0, r.err);
  assert.equal(storyIsApproved(read(storyFile(dir))), true);
  assert.match(read(storyFile(dir)), /\*\*Status:\*\* Approved — dev-dabour · \d{4}-\d{2}-\d{2}/);
  assert.match(gate(dir, 'Story approved'), /^- \[x\]/);
  assert.match(r.out, /agent-run|run from the shell/);
  assert.equal((await cli(dir, ['item', 'check', 'foo'])).code, 0);
});

test('approve plan needs an approved story, then moves the plan and its sub-units to Approved and ticks the gate', async () => {
  const dir = await projectWithItem();
  const early = await approve(dir, 'plan', '--by', 'dev-dabour');
  assert.equal(early.code, 2);
  assert.match(early.err, /story/);
  await approve(dir, 'story', '--by', 'dev-dabour');
  const ok = await approve(dir, 'plan', '--by', 'dev-dabour');
  assert.equal(ok.code, 0, ok.err);
  assert.match(read(planFile(dir)), /\*\*Overall status:\*\* Approved/);
  assert.match(unitLine(dir, 1), /· 🟡 Approved$/);
  assert.match(unitLine(dir, 2), /· 🟡 Approved$/);
  assert.match(gate(dir, 'Plan approved'), /^- \[x\]/);
  assert.equal((await approve(dir, 'plan', '--by', 'dev-dabour')).code, 0); // again: a note, no change
});

test('approve plan is refused while a material question has no answer', async () => {
  const dir = await projectWithItem();
  await approve(dir, 'story', '--by', 'dev-dabour');
  write(storyFile(dir), read(storyFile(dir)) + '\n| Q-1 | business | yes | Which one? | |\n');
  const r = await approve(dir, 'plan', '--by', 'dev-dabour');
  assert.equal(r.code, 2);
  assert.match(r.err, /Q-1/);
});

test('--by must be a person: agent names, placeholders, separators and nothing are refused', async () => {
  const dir = await projectWithItem();
  for (const by of ['Claude', 'haiku', 'Codex', 'agent', '<name>', 'a · b', '', '12345']) {
    const r = await approve(dir, 'story', ...(by === '' ? [] : ['--by', by]));
    assert.equal(r.code, 2, `"${by}"`);
    assert.match(r.err, /--by/, `"${by}"`);
  }
  assert.equal(storyIsApproved(read(storyFile(dir))), false);
});

test('approve qc needs a PASS report and writes Accepted by', async () => {
  const dir = await projectWithItem();
  assert.equal((await approve(dir, 'qc', '--by', 'dev-dabour')).code, 2); // no report
  await cli(dir, ['review', 'add', 'foo', '--kind', 'qc', '--by', 'Claude · Sonnet 5.5 · fresh subagent', '--verdict', 'FAIL — 1 issue']);
  assert.equal((await approve(dir, 'qc', '--by', 'dev-dabour')).code, 2); // FAIL is not accepted
  await cli(dir, ['review', 'add', 'foo', '--kind', 'qc', '--by', 'Claude · Sonnet 5.5 · fresh subagent', '--verdict', 'PASS', '--round', '2']);
  assert.equal((await approve(dir, 'qc', '--by', 'dev-dabour')).code, 0);
  assert.match(read(join(itemDir(dir), 'reviews', 'foo-qc-r2.md')), /\*\*Accepted by:\*\* dev-dabour · \d{4}-\d{2}-\d{2}/);
});

test('an unknown thing to approve is refused', async () => {
  const dir = await projectWithItem();
  const r = await approve(dir, 'everything', '--by', 'dev-dabour');
  assert.equal(r.code, 2);
  assert.match(r.err, /story, plan or qc/);
});

// ---- review round 1 (SU4) ----
test('a name with $ is written as it is: no replacement pattern is expanded, and the story stays one piece', async () => {
  const dir = await projectWithItem();
  const lines = read(storyFile(dir)).split('\n').length;
  const r = await approve(dir, 'story', '--by', "Amer$'x$&$1");
  assert.equal(r.code, 0, r.err);
  assert.equal(read(storyFile(dir)).split('\n').length, lines);
  assert.match(read(storyFile(dir)), /\*\*Status:\*\* Approved — Amer\$'x\$&\$1 · \d{4}/);
  assert.equal(storyIsApproved(read(storyFile(dir))), true);
  assert.equal((await cli(dir, ['item', 'check', 'foo'])).code, 0);
});

test('the Status that is changed is the real one, not a line shown inside a code fence earlier in the story', async () => {
  const dir = await projectWithItem();
  write(storyFile(dir), read(storyFile(dir)).replace('# foo', '# foo\n```\n- **Status:** Draft\n```'));
  assert.equal((await approve(dir, 'story', '--by', 'dev-dabour')).code, 0);
  const text = read(storyFile(dir));
  assert.match(text, /```\n- \*\*Status:\*\* Draft\n```/); // the example is untouched
  assert.equal(storyIsApproved(text), true);
});

test('approve qc writes Accepted by without expanding $ patterns', async () => {
  const dir = await projectWithItem();
  await cli(dir, ['review', 'add', 'foo', '--kind', 'qc', '--by', 'Claude · Sonnet 5.5 · fresh subagent', '--verdict', 'PASS']);
  assert.equal((await approve(dir, 'qc', '--by', "Amer$'x")).code, 0);
  const qc = read(join(itemDir(dir), 'reviews', 'foo-qc.md'));
  assert.match(qc, /\*\*Accepted by:\*\* Amer\$'x · \d{4}/);
  assert.equal(qc.split('\n').length < 12, true);
});

test('approve plan checks the story even when the plan\'s Route line is not exact', async () => {
  const dir = await projectWithItem();
  write(planFile(dir), read(planFile(dir)).replace(/^- \*\*Route:\*\* .*$/m, '- **Route:** feature architectural'));
  const r = await approve(dir, 'plan', '--by', 'dev-dabour');
  assert.equal(r.code, 2);
  assert.match(r.err, /story/);
  assert.match(read(planFile(dir)), /\*\*Overall status:\*\* Draft/);
});

test('real names are not mistaken for an agent: Meïr, Amer, Aiman, Botros; and more agent names are refused', async () => {
  for (const by of ['Meïr', 'Amer', 'Aiman', 'Botros']) {
    const dir = await projectWithItem();
    assert.equal((await approve(dir, 'story', '--by', by)).code, 0, by);
  }
  for (const by of ['Anthropic', 'Copilot', 'Grok']) {
    const dir = await projectWithItem();
    assert.equal((await approve(dir, 'story', '--by', by)).code, 2, by);
  }
});
