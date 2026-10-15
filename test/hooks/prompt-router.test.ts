import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir } from '../helpers.js';
import { run } from '../../src/hooks/main.mjs';

const project = tmpDir('burhan-prompt-router-');
const heading = '⚑ Router — before acting:';
const modeStep = '• Mode switch → write `**Mode:** step` in the story and the state file: stop after every sub-unit for the human.';
const modeAuto = '• Mode switch → write `**Mode:** auto` in the story and the state file: run the sub-units without pausing. Brakes (scope escalator, discovery, plan change, the same test failing twice, an irreversible action) and the commit checkpoint still stop.';
const bug = '• Bug → reproduce and find the root cause with evidence before proposing a fix; then a failing regression test first.';
const access = '• Access/visibility work → record-level visibility is the highest-consequence check: a missing filter returns everything. Test allowed AND denied cases; verify as the affected identity (.burhan/phases/review.md).';
const investigation = '• Investigation → read-only route (WORKFLOW §3): evidence → findings → limitations → conclusion. No application code changes (.burhan/phases/lifecycle.md).';
const noMatch = '• No phase keyword matched — run superpowers:using-superpowers before acting.';

async function router(prompt: string, env: NodeJS.ProcessEnv = {}): Promise<string> {
  const result = await run(
    ['core', 'prompt-router'],
    JSON.stringify({ event: 'prompt', prompt, project_dir: project }),
    { ...process.env, WF_SKILLS: 'none', ...env },
  );
  assert.equal(result.debug, '');
  return result.stdout;
}

function output(...lines: string[]): string {
  return JSON.stringify({ message: [heading, ...lines].join('\n') }) + '\n';
}

test('prompt-router: Arabic words require whitespace or punctuation bounds', async () => {
  for (const prompt of ['ممكن تشرح المعدل ده', 'شكرا يا مخلص']) {
    assert.equal(await router(prompt), '');
  }
  assert.equal(await router('مشكلة،'), output(bug));
  assert.equal(await router('كده خلص؟'), output('• Wrapping up → review (.burhan/phases/review.md), then run the checks and SHOW the output before claiming done; commit only after the (a)/(b)/(c) checkpoint (.burhan/phases/close-out.md).'));
});

test('prompt-router: end to end tests and negated auto phrases do not switch modes', async () => {
  assert.equal(await router('add end to end tests for the role permissions page'), output(access, '• New/changed behaviour → route it (type + scope + reason), then the gates it requires before any code (.burhan/phases/lifecycle.md).'));
  assert.equal(await router("don't go end-to-end yet"), '');
});

test('prompt-router: step wins over auto', async () => {
  assert.equal(await router("don't go end to end, wait for my approval"), output(modeStep));
});

test('prompt-router: keeps the first two suggestions in router order', async () => {
  assert.equal(await router('add a fix for the broken role permission, investigate, then we are done'), output(access, investigation));
});

test('prompt-router: skips system notifications and an empty prompt', async () => {
  for (const prompt of ['', '<task-notification> agent done, broken', 'SYSTEM NOTIFICATION: fix broken', '<local-command-caveat>fix broken</local-command-caveat>']) {
    assert.equal(await router(prompt), '');
  }
});

test('prompt-router: adds skills suffixes and the no-keyword line only when skills are enabled', async () => {
  assert.equal(await router('the upload is broken', { WF_SKILLS: 'superpowers' }), output(`${bug} Skill: superpowers:systematic-debugging, then superpowers:test-driven-development.`));
  assert.equal(await router('hello there', { WF_SKILLS: 'superpowers' }), output(noMatch));
  assert.equal(await router('hello there'), '');
});

test('prompt-router: explicit auto mode is preserved', async () => {
  assert.equal(await router('go end to end, do not wait for me'), output(modeAuto));
});
