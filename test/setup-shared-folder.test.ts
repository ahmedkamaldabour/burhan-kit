import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli } from '../src/main.js';
import { parseConfig } from '../src/lib/config.js';
import { agentInstructions, readAnswers } from '../src/lib/setup/agent.js';
import { applySetup, currentAnswers, planSetup, type SetupAnswers } from '../src/lib/setup/engine.js';
import { scriptedPrompter } from '../src/lib/setup/prompter.js';
import { runWizard } from '../src/lib/setup/wizard.js';
import { capture, tmpDir } from './helpers.js';

const home = tmpDir('burhan-folders-home-');
const answersDir = tmpDir('burhan-folders-answers-');
const standardAnswers = (docs: SetupAnswers['docs']): SetupAnswers => ({ agents: ['claude'], mode: 'step', docs, lang: 'en' });
const config = (target: string): Record<string, string> => parseConfig(readFileSync(join(target, '.burhan/workflow.config'), 'utf8')).values;

function files(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files(path, base, out);
    else out[path.slice(base.length)] = readFileSync(path, 'utf8');
  }
  return out;
}

for (const [docs, work, discovery] of [
  [{ kind: 'private' }, '.burhan/work', '.burhan/discovery'],
  [{ kind: 'shared' }, 'docs/burhan/work', 'docs/burhan/discovery'],
  [{ kind: 'custom', path: 'notes/work' }, 'notes/work', 'notes/work-discovery'],
] as const) {
  test(`${docs.kind} paths round-trip without a namespace restriction on custom paths`, () => {
    const target = tmpDir('burhan-folders-');
    const answers = standardAnswers(docs);
    applySetup(planSetup(target, answers, home));
    assert.equal(config(target).WF_DOCS_DIR, work);
    assert.equal(config(target).WF_DISCOVERY_DIR, discovery);
    assert.deepEqual(currentAnswers(target)?.docs, docs);
    const before = files(target);
    applySetup(planSetup(target, answers, home));
    assert.deepEqual(files(target), before);
  });
}

test('unset paths prefill private defaults and unrelated custom files never move', () => {
  const target = tmpDir('burhan-folders-');
  applySetup(planSetup(target, standardAnswers({ kind: 'private' }), home));
  const file = join(target, '.burhan/workflow.config');
  writeFileSync(file, readFileSync(file, 'utf8').replace(/^WF_(DOCS|DISCOVERY)_DIR=.*\n/gm, ''));
  mkdirSync(join(target, 'notes/work'), { recursive: true });
  writeFileSync(join(target, 'notes/work/mine.md'), 'mine\n');
  assert.deepEqual(currentAnswers(target)?.docs, { kind: 'private' });
  applySetup(planSetup(target, standardAnswers({ kind: 'shared' }), home));
  assert.equal(readFileSync(join(target, 'notes/work/mine.md'), 'utf8'), 'mine\n');
  assert.equal(config(target).WF_DOCS_DIR, 'docs/burhan/work');
});

for (const lang of ['en', 'ar'] as const) {
  test(`${lang}: moveDocs is an ordinary unknown field rejected before writes`, async () => {
    for (const moveDocs of ['keep', 'move', 'rename']) {
      const target = tmpDir('burhan-folders-');
      const file = join(answersDir, `${lang}-${moveDocs}.json`);
      writeFileSync(file, JSON.stringify({ agents: 'claude', mode: 'step', docs: 'shared', moveDocs }));
      assert.throws(() => readAnswers(file, lang), /moveDocs/);
      const before = files(target);
      const result = capture(target);
      assert.equal(await runCli(['setup', target, '--lang', lang, '--answers', file, '--apply'], result.io), 2);
      assert.match(result.o.err, /moveDocs/);
      assert.deepEqual(files(target), before);
    }
  });

  test(`${lang}: shared setup has only the four questions and no move prompt`, async () => {
    const target = tmpDir('burhan-folders-');
    applySetup(planSetup(target, standardAnswers({ kind: 'shared' }), home));
    const output = agentInstructions(target, lang, home);
    const protocol = JSON.parse(output.match(/```json\n([\s\S]*?)\n```/)![1]);
    assert.deepEqual(protocol.questions.map((question: { id: string }) => question.id), ['agents', 'mode', 'docs', 'discovery']);
    assert.equal('moveDocs' in protocol.recommended, false);
    const prompter = scriptedPrompter(['use', 'apply']);
    assert.equal(await runWizard(target, capture(target).io, prompter, lang, home), 0);
  });
}
