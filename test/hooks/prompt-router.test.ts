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
const investigation = '• Investigation → read-only route (WORKFLOW §3): evidence → findings → limitations → conclusion. No application code changes (.burhan/phases/stage-story.md).';
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

const skillNoItem = '⚑ Skill (before a story): invoke superpowers:brainstorming and read its instructions before you start.';
/** The router block followed by the skill line (its own finding, so a blank line between). */
const withSkill = (...lines: string[]): string => JSON.stringify({ message: [heading, ...lines].join('\n') + '\n\n' + skillNoItem }) + '\n';

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
  assert.equal(await router('add end to end tests for the role permissions page'), output(access, '• New/changed behaviour → route it (type + scope + reason), then the gates it requires before any code (.burhan/phases/stage-story.md).'));
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
  assert.equal(await router('the upload is broken', { WF_SKILLS: 'superpowers' }), withSkill(`${bug} Skill: superpowers:systematic-debugging, then superpowers:test-driven-development.`));
  assert.equal(await router('hello there', { WF_SKILLS: 'superpowers' }), withSkill(noMatch));
  assert.equal(await router('hello there'), '');
});

test('prompt-router: explicit auto mode is preserved', async () => {
  assert.equal(await router('go end to end, do not wait for me'), output(modeAuto));
});

// alerts-and-texts SU3 (AC-07): "auto mode" / "step mode" after a bounded verb or preposition.
const modeOf = (out: string): string => out.includes(modeStep) ? 'step' : out.includes(modeAuto) ? 'auto' : '';
test('prompt-router: "auto mode" and "step mode" after a verb or preposition switch the mode; mentions and negations do not', async () => {
  const cases: [string, string][] = [
    ['use auto mode for this item', 'auto'], ['switch to auto mode', 'auto'], ['switch from step mode to auto mode', 'auto'],
    ['run in auto mode', 'auto'], ['mode: auto', 'auto'], ['ب auto mode', 'auto'],
    ['موافق على الـ plan واستخدم auto mode ف الاستوري دي', 'auto'], ['اشتغل ب auto mode وقفل كل شي', 'auto'],
    ['use step mode', 'step'], ['ب step mode', 'step'], ['mode: step', 'step'],
    ['use auto mode but wait for my approval', 'step'], ["don't use step mode, use auto mode", 'auto'], ['use step mode, not auto mode', 'step'],
    ['what is auto mode?', ''], ['explain auto mode', ''], ['اكتب auto mode', ''], ['تعريف auto mode', ''], ['mode auto-detect', ''],
    ["don't use auto mode", ''], ['not in auto mode', ''], ['مش auto mode', ''],
    // A negated mode word cancels only the new phrases; the older ones keep working as before (SU3 review I-1).
    ['wait for my approval, no step mode needed', 'step'], ['no step mode needed, wait for my approval', 'step'],
    ['go end to end, not in auto mode', 'auto'],
  ];
  const got = [];
  for (const [prompt] of cases) got.push([prompt, modeOf(await router(prompt))]);
  assert.deepEqual(got, cases);
});
