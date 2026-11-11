import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { agentInstructions } from '../src/lib/setup/agent.js';
import { planSetup } from '../src/lib/setup/engine.js';
import type { SetupAnswers } from '../src/lib/setup/answers.js';
import { messages } from '../src/lib/setup/messages.js';
import { renderSummary } from '../src/lib/setup/summary.js';
import { tmpDir } from './helpers.js';

const NAMES = ['burhan-story', 'burhan-plan', 'burhan-build', 'burhan-debug', 'burhan-review', 'burhan-done'];
const repo = (): string => { const t = tmpDir('burhan-sk-line-'); spawnSync('git', ['init', '-q'], { cwd: t }); return t; };
const answers = (lang: 'en' | 'ar'): SetupAnswers => ({ agents: ['claude'], mode: 'step', lang, docs: { kind: 'private' } });

for (const lang of ['en', 'ar'] as const) {
  test(`${lang}: the skills line names the six skills and where they live, in one line, and no plugin or setting`, () => {
    const line = messages(lang).skills();
    for (const n of NAMES) assert.ok(line.includes(n), n);
    assert.ok(line.includes('.burhan/skills/'));
    assert.ok(!line.includes('\n'));
    assert.doesNotMatch(line, /superpowers|WF_SKILLS|plugin/i);
  });

  test(`${lang}: the summary and the --agent instructions carry the line`, () => {
    const t = repo();
    const home = tmpDir('burhan-sk-line-home-');
    const plan = planSetup(t, answers(lang), home);
    assert.ok(renderSummary(plan, lang).includes(messages(lang).skills()));
    assert.ok(agentInstructions(t, lang, home).includes(messages(lang).skills()));
  });
}

test('setup writes no WF_SKILLS, keeps one the person has, and the plan has no skills fields', () => {
  const t = repo();
  const home = tmpDir('burhan-sk-line-home-');
  const fresh = planSetup(t, answers('en'), home);
  assert.doesNotMatch(fresh.config, /WF_SKILLS/);
  assert.equal('skills' in fresh, false);
  assert.equal('superpowersAvailable' in fresh, false);
  assert.equal('superpowersDisabled' in fresh, false);
  mkdirSync(join(t, '.burhan'), { recursive: true });
  writeFileSync(join(t, '.burhan/workflow.config'), "WF_SKILLS='superpowers'\n");
  assert.match(planSetup(t, answers('en'), home).config, /WF_SKILLS='superpowers'/, 'the person\'s line is left for doctor to name');
});
