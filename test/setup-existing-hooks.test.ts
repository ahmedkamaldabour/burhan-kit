import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as hooksMerge from '../src/lib/hooks-merge.js';
import { BurhanError } from '../src/lib/errors.js';
import { runCli } from '../src/main.js';
import { readAnswers } from '../src/lib/setup/agent.js';
import { applySetup, planSetup, renderSummary, type SetupAnswers } from '../src/lib/setup/engine.js';
import { scriptedPrompter } from '../src/lib/setup/prompter.js';
import { runWizard } from '../src/lib/setup/wizard.js';
import { capture, tmpDir } from './helpers.js';

type ExistingHook = { agent: 'claude' | 'codex'; event: string; command: string };
type ExistingHooksChoice = 'keep' | 'remove-mine';
type ExistingSetupAnswers = SetupAnswers & { existingHooks?: ExistingHooksChoice };

const home = tmpDir('burhan-existing-hooks-home-');
const USER_COMMAND = 'echo my-own-reminder';

const answers = (existingHooks?: ExistingHooksChoice): ExistingSetupAnswers => ({
  agents: ['claude'], mode: 'step', docs: { kind: 'private' }, lang: 'en', ...(existingHooks === undefined ? {} : { existingHooks }),
});

function project(): string {
  return tmpDir('burhan-existing-hooks-');
}

function writeClaudeHooks(target: string, hooks: Record<string, unknown[]>): string {
  const file = join(target, '.claude', 'settings.json');
  mkdirSync(join(target, '.claude'), { recursive: true });
  writeFileSync(file, JSON.stringify({ hooks }, null, 2) + '\n');
  return file;
}

function userEntryBytes(file: string): Buffer {
  const settings = JSON.parse(readFileSync(file, 'utf8')) as { hooks: Record<string, { hooks: { command?: string }[] }[]> };
  const entry = Object.values(settings.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks))
    .find((hook) => hook.command === USER_COMMAND);
  assert.ok(entry, 'the user hook entry remains present');
  return Buffer.from(JSON.stringify(entry), 'utf8');
}

/** The production reader is deliberately loaded dynamically: this Phase 1 test must compile before it exists. */
function readExistingHooks(target: string, agents: readonly ('claude' | 'codex')[]): ExistingHook[] {
  const reader = (hooksMerge as unknown as { readExistingHooks?: (target: string, agents: readonly ('claude' | 'codex')[]) => ExistingHook[] }).readExistingHooks;
  assert.equal(typeof reader, 'function', 'readExistingHooks must be exported from hooks-merge');
  return reader!(target, agents);
}

test('readExistingHooks lists only user commands on events burhan uses, without reading or changing other entries', () => {
  const target = project();
  const file = writeClaudeHooks(target, {
    SessionStart: [{ hooks: [
      { type: 'command', command: USER_COMMAND },
      { type: 'command', command: 'bash ".workflow/hooks/adapters/claude/hook.sh" session-gates' },
    ] }],
    Notification: [{ hooks: [{ type: 'command', command: 'echo not-on-a-burhan-event' }] }],
  });
  const before = readFileSync(file, 'utf8');

  assert.deepEqual(readExistingHooks(target, ['claude']), [
    { agent: 'claude', event: 'SessionStart', command: USER_COMMAND, groupIndex: 0, hookIndex: 0, hookJson: JSON.stringify({ type: 'command', command: USER_COMMAND }) },
  ]);
  assert.equal(readFileSync(file, 'utf8'), before, 'detection is read-only');
});

test('readExistingHooks returns no entries when no settings file exists, and malformed JSON stays on the existing install error path', () => {
  const missing = project();
  assert.deepEqual(readExistingHooks(missing, ['claude']), []);

  const malformed = project();
  mkdirSync(join(malformed, '.claude'));
  writeFileSync(join(malformed, '.claude', 'settings.json'), '{ broken');
  assert.doesNotThrow(() => readExistingHooks(malformed, ['claude']));
  assert.deepEqual(readExistingHooks(malformed, ['claude']), []);
  assert.throws(() => planSetup(malformed, answers(), home), (error: unknown) =>
    error instanceof BurhanError && /expected a JSON object whose "hooks"/.test(error.message));
});

test('readExistingHooks treats a settings symlink whose real path escapes the project as no entries', () => {
  const target = project();
  const outside = tmpDir('burhan-existing-hooks-outside-');
  const outsideFile = writeClaudeHooks(outside, { Stop: [{ hooks: [{ type: 'command', command: USER_COMMAND }] }] });
  const file = join(target, '.claude', 'settings.json');
  mkdirSync(join(target, '.claude'), { recursive: true });
  symlinkSync(outsideFile, file);

  assert.deepEqual(readExistingHooks(target, ['claude']), []);
});

test('readExistingHooks skips a hook group without a hooks array', () => {
  const target = project();
  writeClaudeHooks(target, { Stop: [{}] });

  assert.doesNotThrow(() => readExistingHooks(target, ['claude']));
  assert.deepEqual(readExistingHooks(target, ['claude']), []);
  assert.doesNotThrow(() => planSetup(target, answers(), home));
});

test('the setup summary names each existing command per event in English and Egyptian Arabic, and warns that reminders may repeat', () => {
  const target = project();
  writeClaudeHooks(target, {
    SessionStart: [{ hooks: [{ type: 'command', command: USER_COMMAND }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'echo my-stop-reminder' }] }],
  });
  const plan = planSetup(target, answers(), home);

  const en = renderSummary(plan, 'en');
  assert.match(en, /SessionStart[\s\S]*echo my-own-reminder/);
  assert.match(en, /Stop[\s\S]*echo my-stop-reminder/);
  assert.match(en, /run alongside burhan.?s[\s\S]*reminders may repeat/i);

  const ar = renderSummary(plan, 'ar');
  assert.match(ar, /SessionStart[\s\S]*echo my-own-reminder/);
  assert.match(ar, /Stop[\s\S]*echo my-stop-reminder/);
  assert.match(ar, /[\u0600-\u06ff]/);
});

test('the existing-hooks question appears only when the wizard or setup --agent finds a user hook', async () => {
  const empty = project();
  const emptyPrompter = scriptedPrompter(['use', 'apply']);
  assert.equal(await runWizard(empty, capture(empty).io, emptyPrompter, 'en', home), 0);
  assert.ok(!emptyPrompter.asked.some((question) => /existing hooks|keep both|remove mine/i.test(question)));
  const emptyAgent = capture(empty);
  assert.equal(await runCli(['setup', empty, '--agent'], emptyAgent.io), 0);
  assert.doesNotMatch(emptyAgent.o.out, /existingHooks|keep both|remove-mine/i);

  const target = project();
  writeClaudeHooks(target, { SessionStart: [{ hooks: [{ type: 'command', command: USER_COMMAND }] }] });
  const prompter = scriptedPrompter(['use', 'keep', 'apply']);
  assert.equal(await runWizard(target, capture(target).io, prompter, 'en', home), 0);
  assert.ok(prompter.asked.some((question) => /existing hooks/i.test(question)));
  assert.ok(prompter.shown.some((line) => /keep both/i.test(line)));

  const agent = capture(target);
  assert.equal(await runCli(['setup', target, '--agent'], agent.io), 0);
  assert.match(agent.o.out, /SessionStart[\s\S]*echo my-own-reminder/);
  assert.match(agent.o.out, /existingHooks[\s\S]*keep[\s\S]*remove-mine/);
});

test('keep and remove-mine preserve the user hook entry byte-for-byte after apply, while remove-mine prints the exact entry for the person to remove', async () => {
  for (const choice of ['keep', 'remove-mine'] as const) {
    const target = project();
    const file = writeClaudeHooks(target, { SessionStart: [{ hooks: [{ type: 'command', command: USER_COMMAND }] }] });
    const before = userEntryBytes(file);
    const plan = planSetup(target, answers(choice), home);
    const summary = renderSummary(plan, 'en');
    if (choice === 'remove-mine') assert.match(summary, /echo my-own-reminder/);
    applySetup(plan);
    assert.deepEqual(userEntryBytes(file), before, choice);
  }
});

test('remove-mine names each matching group and prints the exact hook JSON in English and Egyptian Arabic', () => {
  const target = project();
  const first = { type: 'command', command: USER_COMMAND, timeout: 10, note: 'first group' };
  const second = { type: 'command', command: USER_COMMAND, timeout: 30, note: 'second group' };
  writeClaudeHooks(target, { Stop: [
    { matcher: 'first-matcher', hooks: [first] },
    { matcher: 'second-matcher', hooks: [second] },
  ] });
  const plan = planSetup(target, answers('remove-mine'), home);

  assert.deepEqual(plan.existingHooks, [
    { agent: 'claude', event: 'Stop', command: USER_COMMAND, matcher: 'first-matcher', groupIndex: 0, hookIndex: 0, hookJson: JSON.stringify(first) },
    { agent: 'claude', event: 'Stop', command: USER_COMMAND, matcher: 'second-matcher', groupIndex: 1, hookIndex: 0, hookJson: JSON.stringify(second) },
  ]);
  for (const summary of [renderSummary(plan, 'en'), renderSummary(plan, 'ar')]) {
    assert.match(summary, /Stop[\s\S]*first-matcher[\s\S]*\{"type":"command","command":"echo my-own-reminder","timeout":10,"note":"first group"\}/);
    assert.match(summary, /Stop[\s\S]*second-matcher[\s\S]*\{"type":"command","command":"echo my-own-reminder","timeout":30,"note":"second group"\}/);
  }
});

test('answers accept keep or remove-mine, default an absent existingHooks field to keep, and reject any other value', () => {
  const dir = project();
  const writeAnswers = (name: string, value: Record<string, unknown>): string => {
    const file = join(dir, `${name}.json`);
    writeFileSync(file, JSON.stringify({ agents: 'claude', mode: 'step', docs: 'private', ...value }));
    return file;
  };

  const absent = readAnswers(writeAnswers('absent', {}), 'en') as ExistingSetupAnswers;
  assert.equal(absent.existingHooks, 'keep');
  assert.equal((readAnswers(writeAnswers('remove', { existingHooks: 'remove-mine' }), 'en') as ExistingSetupAnswers).existingHooks, 'remove-mine');
  assert.throws(() => readAnswers(writeAnswers('invalid', { existingHooks: 'delete-them' }), 'en'), /existingHooks[\s\S]*keep[\s\S]*remove-mine/i);
});
