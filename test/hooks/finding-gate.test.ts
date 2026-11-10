import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../src/hooks/main.mjs';
import { projectWithItem } from '../item-fixture.js';
import { tmpDir } from '../helpers.js';

const SESSION = 'S1';
async function setup(): Promise<{ dir: string; store: string }> {
  const dir = await projectWithItem();
  const store = tmpDir('burhan-finding-gate-store-');
  writeFileSync(join(dir, '.burhan/workflow.config'), ['WF_DOCS_DIR=.burhan/work', 'WF_STATE_FILE=.burhan/local/PROGRESS.md', `WF_EVIDENCE_DIR='${store}'`, "WF_CODE_REGEX='[.]ts$'", 'WF_ITEM_CONTRACT=on', ''].join('\n'));
  return { dir, store };
}
const env = (store: string): NodeJS.ProcessEnv => ({ ...process.env, WF_EVIDENCE_DIR: store });
const audit = async (c: { dir: string; store: string }, shell: string[]): Promise<string> =>
  (await run(['core', 'turn-audit'], JSON.stringify({ event: 'turn_end', session: SESSION, project_dir: c.dir, turn: { files_created: [], files_edited: [], shell_commands: shell, skills_used: [], assistant_text: 'saved', steps: [] } }), env(c.store))).stdout;
const prompt = async (c: { dir: string; store: string }, text: string): Promise<void> => {
  await run(['core', 'prompt-router'], JSON.stringify({ event: 'prompt', session: SESSION, project_dir: c.dir, prompt: text }), env(c.store));
};
const DECIDE = 'node dist/cli.js finding decide foo 3 --fixed unit:1 --by dev-dabour';
const DISCOVER = 'node dist/cli.js finding discover foo --by dev-dabour';

test('a finding decide run in a turn whose message had no decision wording is flagged, and it names the finding (AC-04, AC-12)', async () => {
  const c = await setup();
  await prompt(c, 'continue with the build');
  const out = await audit(c, [DECIDE]);
  assert.match(out, /FINDING DECISION GATE/);
  assert.match(out, /ran finding decide foo 3 this turn but the owner's message had no decision wording/);
  assert.doesNotMatch(out, /APPROVAL/);
});

test('with decision wording in the owner\'s message the decision is still reported, as a line to confirm; the wording is spent by the report', async () => {
  const c = await setup();
  await prompt(c, 'اصلح الأول واقبل التاني');
  assert.match(await audit(c, [DECIDE]), /ℹ FINDING DECISION: .*had decision wording/);
  assert.match(await audit(c, [DECIDE]), /FINDING DECISION GATE/);
  await prompt(c, 'fix 1 and accept 2, leave the rest to a discovery');
  const out = await audit(c, [DISCOVER]);
  assert.match(out, /ℹ FINDING DECISION: the agent ran finding discover foo this turn/);
});

test('approve wording is not decision wording and the other way round: each report spends its own', async () => {
  const c = await setup();
  await prompt(c, 'yes');
  const both = await audit(c, ['node dist/cli.js approve plan foo --by dev-dabour', DECIDE]);
  assert.match(both, /ℹ APPROVAL: /);
  assert.match(both, /ℹ FINDING DECISION: /);
  await prompt(c, 'accept it');
  const mixed = await audit(c, ['node dist/cli.js approve plan foo --by dev-dabour', DECIDE]);
  assert.match(mixed, /⚠ APPROVAL GATE: .*no approval wording/);
  assert.match(mixed, /ℹ FINDING DECISION: /);
});

test('the other finding commands are no decision, and the old approval forms are reported as before', async () => {
  const c = await setup();
  await prompt(c, 'continue');
  for (const cmd of ['node dist/cli.js finding list foo', 'node dist/cli.js finding add foo --in review:1 --none', 'echo "burhan finding decide foo 3 --fixed unit:1"', 'burhan finding decide', 'grep -r "finding discover foo" docs']) {
    assert.doesNotMatch(await audit(c, [cmd]), /FINDING DECISION|APPROVAL/, cmd);
  }
  for (const cmd of ['burhan finding decide foo 3 --accepted "ok" --by dev', 'npx burhan-kit finding discover foo --by dev', 'cd x && node ../dist/cli.js finding decide foo 2 --fixed unit:1 --by dev']) {
    assert.match(await audit(c, [cmd]), /FINDING DECISION GATE/, cmd);
  }
  assert.match(await audit(c, ['burhan deviation resolve foo 1 --approved --by dev']), /APPROVAL GATE: the agent ran deviation resolve foo 1 /);
  assert.match(await audit(c, ['burhan approve qc foo --by dev']), /APPROVAL GATE: the agent ran approve qc foo /);
});

test('the owner\'s usual decision wording is decision wording, Arabic with the shadda too (Deviation 8, review Important)', async () => {
  const c = await setup();
  for (const said of ['صلّح كل شي', 'قبول', 'قبلت', 'نعم', 'امشي بالتوصيات', 'fixing it', 'proceed with the recommendations']) {
    await prompt(c, said);
    const out = await audit(c, [DECIDE]);
    assert.match(out, /ℹ FINDING DECISION: /, said);
    assert.doesNotMatch(out, /FINDING DECISION GATE/, said);
  }
});

test('a negated phrase is no decision wording, and a decision that stays in the same message still counts (Deviation 8, review Minor)', async () => {
  const c = await setup();
  for (const said of ['مش موافق', "don't fix it", 'no accept']) {
    await prompt(c, said);
    assert.match(await audit(c, [DECIDE]), /FINDING DECISION GATE/, said);
  }
  await prompt(c, 'مش هنقبل الأولى بس صلّح التانية');
  assert.match(await audit(c, [DECIDE]), /ℹ FINDING DECISION: /);
});

test('the words "finding decide foo 3" inside a quoted argument of another command are no decision (Deviation 8, review Minor)', async () => {
  const c = await setup();
  await prompt(c, 'continue');
  const cmd = 'burhan finding add foo --in review:1 --severity Minor --text "then finding decide foo 3"';
  assert.doesNotMatch(await audit(c, [cmd]), /FINDING DECISION/);
});

test('the launcher forms with a version, an npx flag, npm exec or a quoted path are seen (Deviation 10, re-review Minor)', async () => {
  const c = await setup();
  for (const cmd of [
    'burhan-kit@0.8.1 finding decide foo 3 --fixed unit:1 --by dev',
    'npx -y burhan-kit@latest finding decide foo 3 --fixed unit:1 --by dev',
    'npm exec burhan-kit -- finding discover foo --by dev',
    'node "/x/dist/cli.js" finding decide foo 3 --fixed unit:1 --by dev',
  ]) {
    await prompt(c, 'continue');
    assert.match(await audit(c, [cmd]), /FINDING DECISION GATE/, cmd);
  }
});

test('a session id with unsafe characters still gets the decision-wording memory (Deviation 20, review Minor 25)', async () => {
  const c = await setup();
  const UNSAFE = 'a/b..c';
  const promptAs = async (text: string): Promise<void> => { await run(['core', 'prompt-router'], JSON.stringify({ event: 'prompt', session: UNSAFE, project_dir: c.dir, prompt: text }), env(c.store)); };
  const auditAs = async (shell: string[]): Promise<string> =>
    (await run(['core', 'turn-audit'], JSON.stringify({ event: 'turn_end', session: UNSAFE, project_dir: c.dir, turn: { files_created: [], files_edited: [], shell_commands: shell, skills_used: [], assistant_text: 'saved', steps: [] } }), env(c.store))).stdout;
  await promptAs('fix it');
  const said = await auditAs([DECIDE]);
  assert.match(said, /ℹ FINDING DECISION: /);
  assert.doesNotMatch(said, /FINDING DECISION GATE/);
  await promptAs('continue');
  assert.match(await auditAs([DECIDE]), /FINDING DECISION GATE/);
});

test('a very long session id still gets the decision-wording memory (Deviation 22, re-review Minor 2)', async () => {
  const c = await setup();
  const LONG = 'x'.repeat(300);
  const promptAs = async (text: string): Promise<void> => { await run(['core', 'prompt-router'], JSON.stringify({ event: 'prompt', session: LONG, project_dir: c.dir, prompt: text }), env(c.store)); };
  const auditAs = async (shell: string[]): Promise<string> =>
    (await run(['core', 'turn-audit'], JSON.stringify({ event: 'turn_end', session: LONG, project_dir: c.dir, turn: { files_created: [], files_edited: [], shell_commands: shell, skills_used: [], assistant_text: 'saved', steps: [] } }), env(c.store))).stdout;
  await promptAs('fix it');
  assert.doesNotMatch(await auditAs([DECIDE]), /FINDING DECISION GATE/);
});
