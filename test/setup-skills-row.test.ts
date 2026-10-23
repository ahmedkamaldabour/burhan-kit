import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applySetup, planSetup, type SetupAnswers } from '../src/lib/setup/engine.js';
import { tmpDir } from './helpers.js';

const answers: SetupAnswers = { agents: ['claude'], mode: 'step', docs: { kind: 'private' }, lang: 'en' };
const bindings = (t: string): string => readFileSync(join(t, '.burhan/bindings.md'), 'utf8');
const row = (t: string): string => bindings(t).split('\n').find((l) => l.startsWith('| **Process skills**')) ?? '';
const homeWith = (): string => { const h = tmpDir('burhan-sk-home-'); mkdirSync(join(h, '.claude/plugins/cache/x/superpowers/1.0'), { recursive: true }); return h; };

test('setup with Superpowers found names it in the Process skills row, with the phase file', () => {
  const t = tmpDir('burhan-sk-');
  applySetup(planSetup(t, answers, homeWith()));
  const r = row(t);
  assert.match(r, /\| \*\*Process skills\*\* \| superpowers — /u);
  assert.match(r, /phases\/skills\.md/u);
  assert.match(r, /\| `WF_SKILLS` \|$/u);
});

test('setup without Superpowers writes none in the row', () => {
  const t = tmpDir('burhan-sk-');
  applySetup(planSetup(t, answers, tmpDir('burhan-sk-empty-')));
  assert.match(row(t), /\| \*\*Process skills\*\* \| none /u);
});

test('a row the person edited is never overwritten, and a second setup changes nothing', () => {
  const t = tmpDir('burhan-sk-');
  applySetup(planSetup(t, answers, homeWith()));
  const edited = bindings(t).replace(/(\| \*\*Process skills\*\* \| ).*?( \| `WF_SKILLS` \|)/u, '$1my own skills$2');
  writeFileSync(join(t, '.burhan/bindings.md'), edited);
  applySetup(planSetup(t, answers, homeWith()));
  assert.equal(bindings(t), edited);
});

test('a person who set WF_SKILLS to none keeps none even when Superpowers is found', () => {
  const t = tmpDir('burhan-sk-');
  mkdirSync(join(t, '.burhan'), { recursive: true });
  writeFileSync(join(t, '.burhan/workflow.config'), "WF_SKILLS='none'\n");
  applySetup(planSetup(t, answers, homeWith()));
  assert.match(row(t), /\| \*\*Process skills\*\* \| none /u);
});

test('an existing install that uses superpowers keeps it in the row even when the home folder has no plugin', () => {
  const t = tmpDir('burhan-sk-');
  mkdirSync(join(t, '.burhan'), { recursive: true });
  writeFileSync(join(t, '.burhan/workflow.config'), "WF_SKILLS='superpowers'\n");
  applySetup(planSetup(t, answers, tmpDir('burhan-sk-empty-')));
  assert.match(row(t), /\| \*\*Process skills\*\* \| superpowers — /u);
});

test('the core text tells the agent to invoke the matching skill ', () => {
  const core = readFileSync(join(import.meta.dirname, '../../kit/WORKFLOW.md'), 'utf8');
  assert.match(core, /WF_SKILLS=superpowers[^\n]*invoke the matching skill before acting/u);
});
