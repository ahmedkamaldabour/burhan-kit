import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applySetup, planSetup, type SetupAnswers } from '../src/lib/setup/engine.js';
import { tmpDir } from './helpers.js';

const answers: SetupAnswers = { agents: ['claude'], mode: 'step', docs: { kind: 'private' }, lang: 'en' };
const bindings = (t: string): string => readFileSync(join(t, '.burhan/bindings.md'), 'utf8');
const row = (t: string): string => bindings(t).split('\n').find((l) => l.startsWith('| **Process skills**')) ?? '';

test('a new bindings.md names burhan\'s own skills in the Process skills row, with no setting', () => {
  const t = tmpDir('burhan-sk-');
  applySetup(planSetup(t, answers, tmpDir('burhan-sk-home-')));
  const r = row(t);
  assert.match(r, /\| \*\*Process skills\*\* \| burhan's own six skills, always on/u);
  assert.match(r, /\.burhan\/skills\//u);
  assert.match(r, /phases\/skills\.md/u);
  assert.match(r, /\| — \|$/u);
  assert.doesNotMatch(r, /WF_SKILLS|superpowers/iu);
});

test('a row the person edited is never overwritten, and a second setup changes nothing', () => {
  const t = tmpDir('burhan-sk-');
  applySetup(planSetup(t, answers, tmpDir('burhan-sk-home-')));
  const edited = bindings(t).replace(/(\| \*\*Process skills\*\* \| ).*?( \| — \|)/u, '$1my own skills$2');
  assert.notEqual(edited, bindings(t));
  writeFileSync(join(t, '.burhan/bindings.md'), edited);
  applySetup(planSetup(t, answers, tmpDir('burhan-sk-home-')));
  assert.equal(bindings(t), edited);
});
