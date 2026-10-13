import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as hooksMerge from '../src/lib/hooks-merge.js';
import { BurhanError } from '../src/lib/errors.js';
import { runCli } from '../src/main.js';
import { agentInstructions, readAnswers } from '../src/lib/setup/agent.js';
import { applySetup, planSetup, renderSummary, type SetupAnswers } from '../src/lib/setup/engine.js';
import { scriptedPrompter } from '../src/lib/setup/prompter.js';
import { runWizard } from '../src/lib/setup/wizard.js';
import { capture, tmpDir } from './helpers.js';

type ExistingHook = { agent: 'claude' | 'codex'; event: string; command: string };

const home = tmpDir('burhan-existing-hooks-home-');
const USER_COMMAND = 'echo my-own-reminder';

const answers = (): SetupAnswers => ({
  agents: ['claude'], mode: 'step', docs: { kind: 'private' }, lang: 'en',
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
      { type: 'command', command: 'bash "${CLAUDE_PROJECT_DIR:-.}/.burhan/hooks/adapters/claude/hook.sh" session-gates' },
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

for (const lang of ['en', 'ar'] as const) {
  test(`${lang}: existing hooks stay listed without a fourth question or removal instructions`, async () => {
    const target = project();
    const file = writeClaudeHooks(target, { SessionStart: [{ hooks: [{ type: 'command', command: USER_COMMAND }] }] });
    const before = userEntryBytes(file);
    const prompter = scriptedPrompter(['use', 'apply']);
    assert.equal(await runWizard(target, capture(target).io, prompter, lang, home), 0);
    assert.equal(prompter.asked.length, 2);
    assert.ok(prompter.shown.some((line) => line.includes(USER_COMMAND)));
    assert.deepEqual(userEntryBytes(file), before);
    const output = agentInstructions(target, lang, home);
    const protocol = JSON.parse(output.match(/```json\n([\s\S]*?)\n```/)![1]);
    assert.deepEqual(protocol.questions.map((question: { id: string }) => question.id), ['agents', 'mode', 'docs']);
    assert.equal('existingHooks' in protocol.recommended, false);
    assert.match(output, /SessionStart[\s\S]*echo my-own-reminder/);
    for (const text of [output, ...prompter.shown])
      assert.doesNotMatch(text, /remove-mine|keep both|Remove these exact|شيل الإدخالات|هشيل بتوعي/i);
  });

  test(`${lang}: existingHooks is rejected as an unknown answer before writes`, async () => {
    for (const value of ['keep', 'remove-mine', 'delete-them']) {
      const target = project();
      const file = writeClaudeHooks(target, { Stop: [{ hooks: [{ command: USER_COMMAND }] }] });
      const before = readFileSync(file, 'utf8');
      const answerFile = join(project(), 'answers.json');
      writeFileSync(answerFile, JSON.stringify({ agents: 'claude', mode: 'step', docs: 'private', existingHooks: value }));
      assert.throws(() => readAnswers(answerFile, lang), /existingHooks/);
      const result = capture(target);
      assert.equal(await runCli(['setup', target, '--lang', lang, '--answers', answerFile, '--apply'], result.io), 2);
      assert.match(result.o.err, /existingHooks/);
      assert.equal(readFileSync(file, 'utf8'), before);
      assert.deepEqual(readdirSync(target), ['.claude']);
    }
  });
}

test('setup, reapply, upgrade and uninstall keep mixed-event/group foreign hooks in order', async () => {
  const target = project();
  const foreign = { hooks: {
    SessionStart: [{ matcher: 'first', hooks: [{ command: USER_COMMAND, timeout: 4 }, { command: 'echo .burhan/hooks/adapters/claude/hook.sh' }] }],
    Stop: [{ matcher: 'second', hooks: [{ command: USER_COMMAND, timeout: 9 }] }, { hooks: [] }],
    Notification: [{ hooks: [{ command: 'echo other-event' }] }],
  }, custom: { untouched: null } };
  const file = writeClaudeHooks(target, foreign.hooks);
  writeFileSync(file, JSON.stringify(foreign));
  const plan = planSetup(target, answers(), home);
  assert.equal(plan.existingHooks.length, 3);
  applySetup(plan);
  for (let repeat = 0; repeat < 2; repeat++) {
    applySetup(planSetup(target, answers(), home));
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).hooks.SessionStart[0], foreign.hooks.SessionStart[0]);
  }
  assert.equal(await runCli(['upgrade', target, '--apply'], capture(target).io), 0);
  assert.equal(await runCli(['uninstall', target, '--apply'], capture(target).io), 0);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), foreign);
});
