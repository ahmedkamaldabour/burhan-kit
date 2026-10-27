import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { planSetup, renderSummary, type SetupAnswers } from '../src/lib/setup/engine.js';
import { notOnWindows, tmpDir } from './helpers.js';

const skip = notOnWindows('symlinks need privileges on Windows');
const home = tmpDir('burhan-owgsum-home-');
const answers: SetupAnswers = { agents: ['claude'], mode: 'step', docs: { kind: 'private' }, lang: 'en' };
const project = (): string => tmpDir('burhan-owgsum-p-');

// outside-writes-guard SU3: a summary never says "nothing outside this project changes" when something would (AC-06).
const EN_CLAIM = /nothing outside this project changes/u;
const AR_CLAIM = 'ومفيش حاجة بتتغيّر بره المشروع ده';

function withOutsideClaudeMd(): { target: string; real: string } {
  const target = project(); const away = tmpDir('burhan-owgsum-away-');
  writeFileSync(join(away, 'CLAUDE.md'), 'mine\n');
  symlinkSync(join(away, 'CLAUDE.md'), join(target, 'CLAUDE.md'));
  return { target, real: join(realpathSync(away), 'CLAUDE.md') };
}

test('a summary with a file that lands outside names it and does not claim that nothing outside changes (English)', { skip }, () => {
  const { target, real } = withOutsideClaudeMd();
  const text = renderSummary(planSetup(target, answers, home), 'en');
  assert.ok(text.includes(real), text);
  assert.match(text, /outside this project/u);
  assert.doesNotMatch(text, EN_CLAIM);
  assert.match(text, /will refuse[^\n]*--allow-outside-links/u);
});

test('the same summary with the allow flag says it will be written because of the flag', { skip }, () => {
  const { target } = withOutsideClaudeMd();
  const text = renderSummary(planSetup(target, answers, home), 'en', undefined, true);
  assert.doesNotMatch(text, EN_CLAIM);
  assert.match(text, /written because of --allow-outside-links/u);
});

test('Arabic: no "nothing changes outside" line either, and the flag is named', { skip }, () => {
  const { target, real } = withOutsideClaudeMd();
  const plan = planSetup(target, answers, home);
  const refused = renderSummary(plan, 'ar');
  assert.ok(refused.includes(real));
  assert.ok(!refused.includes(AR_CLAIM), refused);
  assert.match(refused, /--allow-outside-links/u);
  const allowed = renderSummary(plan, 'ar', undefined, true);
  assert.ok(!allowed.includes(AR_CLAIM));
  assert.match(allowed, /--allow-outside-links/u);
});

test('a linked commands folder is listed once, as the folder', { skip }, () => {
  const target = project(); const away = tmpDir('burhan-owgsum-away-');
  mkdirSync(join(target, '.claude'));
  symlinkSync(away, join(target, '.claude/commands'));
  const text = renderSummary(planSetup(target, answers, home), 'en');
  const warning = text.slice(text.indexOf('Warning: writing these'), text.indexOf('\n\n', text.indexOf('Warning: writing these')));
  assert.equal(warning.split('\n').filter((line) => line.includes('.claude/commands/burhan/')).length, 1, warning);
  assert.doesNotMatch(text, EN_CLAIM);
});

test('a project with no outside link keeps the closing line in both languages', () => {
  const target = project();
  const plan = planSetup(target, answers, home);
  assert.match(renderSummary(plan, 'en'), EN_CLAIM);
  assert.ok(renderSummary(plan, 'ar').includes(AR_CLAIM));
  assert.doesNotMatch(renderSummary(plan, 'en'), /outside this project:/u);
});
