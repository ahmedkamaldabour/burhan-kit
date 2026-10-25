import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { run } from '../../src/hooks/main.mjs';
import { linkItem, projectKey, rememberPhaseSkills, rememberedPhaseSkills } from '../../src/hooks/core/store.mjs';
import { tmpDir } from '../helpers.js';

// The skill check before a write and the one after it read the same memory (item skills-gates-align): a skill run in an earlier
// turn counts, also one run before any item existed. History only answers "was the skill invoked" (never "was the work done").
const D = 'AI_SPEC/docs';
const BRAIN = 'superpowers:brainstorming';
const PLANS = 'superpowers:writing-plans';
const REVIEW = 'superpowers:requesting-code-review';
const VERIFY = 'superpowers:verification-before-completion';

interface Scene { project: string; store: string; env: NodeJS.ProcessEnv; story: string; plan: string; review: string }
/** A scratch project with Superpowers on. `item`: the state file has a block `foo` and the session is linked to it; null: no block, no item. */
function scene(item: 'foo' | null, extra: string[] = []): Scene {
  const project = tmpDir('burhan-align-project-');
  const store = tmpDir('burhan-align-store-');
  mkdirSync(join(project, '.burhan/local'), { recursive: true });
  writeFileSync(join(project, '.burhan/workflow.config'), [`WF_DOCS_DIR=${D}`, 'WF_DISCOVERY_DIR=AI_SPEC/discovery', 'WF_STATE_FILE=.burhan/local/PROGRESS.md', 'WF_SKILLS=superpowers', `WF_EVIDENCE_DIR='${store}'`, ...extra].join('\n') + '\n');
  writeFileSync(join(project, '.burhan/local/PROGRESS.md'), item === null ? '# s\n## Now\n## Waiting on you\n' : '# s\n## Now\n### foo\n- **Route:** change / bounded\n## Waiting on you\n');
  const env = { ...process.env, WF_EVIDENCE_DIR: store };
  if (item !== null) { const link = join(store, projectKey(project), 'S', 'item'); mkdirSync(dirname(link), { recursive: true }); writeFileSync(link, 'foo\n'); }
  return { project, store, env, story: join(project, `${D}/foo/foo-story.md`), plan: join(project, `${D}/foo/foo-implementation-plan.md`), review: join(project, `${D}/foo/reviews/foo-review.md`) };
}
const call = async (s: Scene, check: string, event: Record<string, unknown>): Promise<string> =>
  (await run(['core', check], JSON.stringify({ project_dir: s.project, session: 'S', ...event }), s.env)).stdout;
const turn = (skills: string[], over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ skills_used: skills, assistant_text: 'ok', files_created: [], files_edited: [], shell_commands: [], steps: [], ...over });
/** One finished turn that used `skills` and wrote nothing. */
const used = (s: Scene, skills: string[]) => call(s, 'turn-audit', { event: 'turn_end', turn: turn(skills) });
/** The pre-write check for a new file (the file is not on disk yet). */
const before = (s: Scene, file: string) => call(s, 'pre-edit-skill', { event: 'pre_edit', file, turn: { skills_used: [], assistant_text: '' } });
const createdOnly = (s: Scene, file: string, skills: string[] = [], text = 'written') => {
  mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, '**Status:** Draft\n');
  return call(s, 'turn-audit', { event: 'turn_end', turn: turn(skills, { files_created: [file], assistant_text: text }) });
};

// ---- the memory: a skill run before any item exists is kept for the session (AC-03) ----
test('a phase skill run with no item is remembered and returned for an item of the same session', () => {
  const { project, env } = scene(null);
  rememberPhaseSkills(project, 'S', '', [BRAIN, 'superpowers:not-a-phase-skill'], env);
  assert.deepEqual(rememberedPhaseSkills(project, 'S', 'foo', env), [BRAIN]);
  assert.deepEqual(rememberedPhaseSkills(project, 'S', '', env), [BRAIN]);
});
test('the item\'s own skills and the no-item skills are returned together, and another session sees neither', () => {
  const { project, env } = scene(null);
  rememberPhaseSkills(project, 'S', '', [BRAIN], env);
  rememberPhaseSkills(project, 'S', 'foo', [PLANS], env);
  assert.deepEqual(rememberedPhaseSkills(project, 'S', 'foo', env).sort(), [BRAIN, PLANS].sort());
  assert.deepEqual(rememberedPhaseSkills(project, 'OTHER', 'foo', env), []);
});
test('an unsafe item id still remembers nothing', () => {
  const { project, env } = scene(null);
  rememberPhaseSkills(project, 'S', '../x', [BRAIN], env);
  assert.deepEqual(rememberedPhaseSkills(project, 'S', 'foo', env), []);
});

// ---- pre-write: no reminder for a skill already used (AC-01 pre-write half, AC-03) ----
test('no item: brainstorming used in an earlier turn → no pre-write line for the first story', async () => {
  const s = scene(null);
  await used(s, [BRAIN]);
  assert.equal(await before(s, s.story), '');
});
test('no item: a skill that never ran is still reminded, once', async () => {
  const s = scene(null);
  await used(s, [BRAIN]);
  assert.match(await before(s, s.plan), /Skill \(plan\): invoke superpowers:writing-plans/u, 'brainstorming does not stand in for writing-plans');
  assert.equal(await before(s, s.plan), '', 'shown once per session and item');
});
test('with an item: brainstorming used in an earlier turn → no pre-write line for the story', async () => {
  const s = scene('foo');
  await used(s, [BRAIN]);
  assert.equal(await before(s, s.story), '');
});
test('with an item: nothing used → the story line is printed (wording unchanged)', async () => {
  const s = scene('foo');
  assert.match(await before(s, s.story), /Skill \(story\): invoke superpowers:brainstorming and read its instructions before you start/u);
});
test('no item: requesting-code-review used earlier → no pre-write line for a review file', async () => {
  const s = scene(null);
  await used(s, [REVIEW]);
  assert.equal(await before(s, s.review), '');
});

test('an unsafe item id also reads nothing', () => {
  const { project, env } = scene(null);
  rememberPhaseSkills(project, 'S', '', [BRAIN], env);
  assert.deepEqual(rememberedPhaseSkills(project, 'S', '../x', env), []);
});

// ---- turn-end: a skill run in an earlier turn counts (AC-01, AC-03; h1 is the first case) ----
const gates = (out: string): string => (out.match(/⚠ [A-Z][A-Z\- ]*GATE( \([a-z]+\))?/gu) ?? []).join(' | ');
test('h1: brainstorming in turn 1, the story written in turn 2 → no SKILL GATE (story)', async () => {
  const s = scene('foo');
  await used(s, [BRAIN]);
  const out = await createdOnly(s, s.story);
  assert.doesNotMatch(out, /SKILL GATE/u, gates(out));
});
test('writing-plans in an earlier turn, the plan written later → no SKILL GATE (plan)', async () => {
  const s = scene('foo');
  await used(s, [PLANS]);
  assert.doesNotMatch(await createdOnly(s, s.plan), /SKILL GATE/u);
});
test('requesting-code-review in an earlier turn, a review written later → no review SKILL GATE', async () => {
  const s = scene('foo');
  await used(s, [REVIEW]);
  assert.doesNotMatch(await createdOnly(s, s.review), /SKILL GATE/u);
});
test('no item: brainstorming before any item existed, the first story written later → no SKILL GATE (story)', async () => {
  const s = scene(null);
  await used(s, [BRAIN]);
  assert.doesNotMatch(await createdOnly(s, s.story), /SKILL GATE/u);
});

// ---- the skill never ran: the warning is unchanged (AC-02) ----
test('nothing used: the story, plan and review warnings keep their wording', async () => {
  for (const item of ['foo', null] as const) {
    const s = scene(item);
    assert.match(await createdOnly(s, s.story), /⚠ SKILL GATE \(story\): a story was CREATED this turn without superpowers:brainstorming\. Invoke it now if it was skipped, or say when it ran\./u);
    const p = scene(item);
    assert.match(await createdOnly(p, p.plan), /⚠ SKILL GATE \(plan\): a plan was CREATED this turn without superpowers:writing-plans\./u);
    const r = scene(item);
    assert.match(await createdOnly(r, r.review), /⚠ SKILL GATE: a review file was written this turn without superpowers:requesting-code-review\./u);
  }
});
test('a different phase skill earlier does not stand in: brainstorming earlier, the plan still warns', async () => {
  const s = scene('foo');
  await used(s, [BRAIN]);
  assert.match(await createdOnly(s, s.plan), /SKILL GATE \(plan\)/u);
});

// ---- the two checks agree on the same history (AC-04) ----
for (const [name, history, phase, shown] of [
  ['story, nothing used', [], 'story', true], ['story, brainstorming earlier', [BRAIN], 'story', false],
  ['plan, nothing used', [], 'plan', true], ['plan, writing-plans earlier', [PLANS], 'plan', false], ['plan, brainstorming earlier', [BRAIN], 'plan', true],
  ['review, nothing used', [], 'review', true], ['review, requesting-code-review earlier', [REVIEW], 'review', false],
] as const) {
  for (const item of ['foo', null] as const) {
    test(`parity (${item ?? 'no item'}): ${name} → the pre-write line and the turn-end warning are ${shown ? 'both shown' : 'both silent'}`, async () => {
      const a = scene(item); const b = scene(item);
      if (history.length > 0) { await used(a, [...history]); await used(b, [...history]); }
      const file = (s: Scene): string => (phase === 'story' ? s.story : phase === 'plan' ? s.plan : s.review);
      const pre = await before(a, file(a));
      const post = await createdOnly(b, file(b));
      assert.equal(pre !== '', shown, `pre-write: ${pre}`);
      assert.equal(/SKILL GATE/u.test(post), shown, `turn-end: ${gates(post)}`);
    });
  }
}

// ---- history is not proof of work (AC-05, AC-08, Q-1 constraints) ----
test('verification used in an earlier turn does not silence SKILL GATE (verify) for a claim after work', async () => {
  const s = scene('foo');
  await used(s, [VERIFY]);
  const out = await createdOnly(s, join(s.project, `${D}/foo/foo-notes.md`), [BRAIN, PLANS], 'done, all tests pass');
  assert.match(out, /SKILL GATE \(verify\)/u, gates(out));
});
test('verification in the same turn still silences it', async () => {
  const s = scene('foo');
  assert.doesNotMatch(await createdOnly(s, join(s.project, `${D}/foo/foo-notes.md`), [VERIFY], 'done, all tests pass'), /SKILL GATE \(verify\)/u);
});
test('an earlier skill does not hide the VERIFICATION GATE for code with a claim and no evidence', async () => {
  const s = scene('foo', ["WF_CODE_REGEX='\\.ts$'"]);
  await used(s, [BRAIN, VERIFY, 'superpowers:test-driven-development']);
  const out = await createdOnly(s, join(s.project, 'src/app.ts'), [], 'done and passing');
  assert.match(out, /VERIFICATION GATE/u, gates(out));
});
test('an earlier skill does not hide the state-transition or stale-status warnings', async () => {
  const s = scene('foo');
  await used(s, [BRAIN, PLANS, REVIEW]);
  mkdirSync(dirname(s.story), { recursive: true });
  writeFileSync(s.story, '**Status:** Draft\n✅ Reviewed\n');
  const out = await call(s, 'turn-audit', { event: 'turn_end', turn: turn([], { files_edited: [s.story] }) });
  assert.match(out, /STATE-TRANSITION GATE/u);
  assert.match(out, /STALE-STATUS GATE/u);
});
test('an earlier skill does not hide the baseline gate on a story in a project without a decided baseline', async () => {
  const s = scene('foo', ["WF_CODE_REGEX='\\.ts$'"]);
  for (let i = 0; i < 12; i++) { mkdirSync(join(s.project, 'src'), { recursive: true }); writeFileSync(join(s.project, `src/m${i}.ts`), 'export {};\n'); }
  await used(s, [BRAIN]);
  assert.match(await createdOnly(s, s.story), /BASELINE GATE/u);
});
