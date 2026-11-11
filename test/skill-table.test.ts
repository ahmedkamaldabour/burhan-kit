import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASES, SKILLS, invokeText, phaseSkillRe, skillAlternation, skillName } from '../src/hooks/core/skill-table.mjs';
import { skillFor, type Stage } from '../src/hooks/core/item-stage.mjs';
import { skillLineText } from '../src/hooks/core/skill-line.mjs';

// Tests run from .test-build/test, so the repository root is two levels up.
const root = fileURLToPath(new URL('../../', import.meta.url));
const walk = (dir: string, keep: (name: string) => boolean): string[] =>
  readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p, keep) : keep(n) ? [p] : []; });

test('the table names six burhan skills, each with a kit folder', () => {
  assert.deepEqual(PHASES, ['story', 'plan', 'build', 'debug', 'review', 'done']);
  assert.deepEqual(PHASES.map(skillName), ['burhan-story', 'burhan-plan', 'burhan-build', 'burhan-debug', 'burhan-review', 'burhan-done']);
  for (const p of PHASES) {
    assert.ok(existsSync(join(root, 'kit/skills/shared', SKILLS[p].name, 'SKILL.md')), SKILLS[p].name);
    assert.ok(SKILLS[p].why.length > 0, `${p} has a reason`);
  }
});

test('a skill id matches with or without a plugin prefix, and only for the phases asked', () => {
  const re = phaseSkillRe('build', 'debug');
  assert.ok(re.test('burhan-build') && re.test('burhan-debug') && re.test('some-plugin:burhan-build'));
  assert.ok(!re.test('burhan-story') && !re.test('my-burhan-build') && !re.test('burhan-build-extra'));
  assert.equal(skillAlternation('story', 'plan'), 'burhan-story|burhan-plan');
});

test('the invoke text and the skill line name the skill and its file', () => {
  assert.equal(invokeText('burhan-story'), 'burhan-story (the Skill tool, or read .burhan/skills/burhan-story/SKILL.md)');
  assert.equal(skillLineText({ label: 'story', skill: 'burhan-story' }), '⚑ Skill (story): invoke burhan-story (the Skill tool, or read .burhan/skills/burhan-story/SKILL.md) before you start.');
});

test('every stage maps to a burhan skill, and the stages with none stay silent', () => {
  const s = (stage: string, route = 'feature / bounded'): string | null => skillFor({ stage } as Pick<Stage, 'stage'>, route)?.skill ?? null;
  assert.equal(s('no item files'), 'burhan-story');
  assert.equal(s('no story'), 'burhan-story');
  assert.equal(s('story draft'), 'burhan-story');
  assert.equal(s('story approved, no plan'), 'burhan-plan');
  assert.equal(s('plan draft'), 'burhan-plan');
  assert.equal(s('build spec missing'), 'burhan-plan');
  assert.equal(s('Sub-unit 2 to start'), 'burhan-build');
  assert.equal(s('Sub-unit 2 in progress'), 'burhan-build');
  assert.equal(s('Sub-unit 2 implemented'), 'burhan-review');
  assert.equal(s('all sub-units reviewed'), 'burhan-done');
  assert.equal(s('plan completed'), 'burhan-done');
  assert.equal(s('QC failed'), 'burhan-debug');
  assert.equal(s('Sub-unit 1 in progress', 'bug / bounded'), 'burhan-debug');
  assert.equal(s('plan Paused'), null);
  assert.equal(s('no story', 'feature / patch'), null);
});

test('no hook source names a Superpowers skill or reads WF_SKILLS', () => {
  const files = [...walk(join(root, 'src/hooks'), (n) => /\.mts$/.test(n)), join(root, 'src/lib/skill-advice.ts'), join(root, 'src/lib/guide.ts'), ...walk(join(root, 'src/lib/setup'), (n) => /\.ts$/.test(n)), join(root, 'src/main.ts')];
  const hits = files.filter((f) => /superpowers|WF_SKILLS/i.test(readFileSync(f, 'utf8'))).map((f) => f.slice(root.length));
  assert.deepEqual(hits, []);
});

test('the SKILL FIRST line of gates.txt names exactly the skills of the table, in its order', () => {
  const line = readFileSync(join(root, 'kit/hooks/core/gates.txt'), 'utf8').split('\n').find((l) => l.startsWith('• SKILL FIRST')) ?? '';
  const named = line.match(/burhan-[a-z]+/g) ?? [];
  assert.deepEqual(named, PHASES.map(skillName), line);
});
