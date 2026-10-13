import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig } from '../src/lib/config.js';
import { runCli } from '../src/main.js';
import { readAnswers } from '../src/lib/setup/agent.js';
import { applySetup, currentAnswers, planSetup, type SetupAnswers } from '../src/lib/setup/engine.js';
import { putFile } from '../src/lib/fs-safe.js';
import { scriptedPrompter } from '../src/lib/setup/prompter.js';
import { runWizard } from '../src/lib/setup/wizard.js';
import { capture, tmpDir } from './helpers.js';

const home = tmpDir('burhan-shared-folder-home-');
const answersDir = tmpDir('burhan-shared-folder-answers-');

type MoveDocs = 'keep' | 'move';
type SharedAnswers = SetupAnswers & { moveDocs?: MoveDocs; legacyShared?: true };
type SetupFilesystem = { mkdir(path: string, options: { recursive: true }): void; rename(from: string, to: string): void; put(path: string, data: string): void };
type RunCliWithFilesystem = (args: string[], io: ReturnType<typeof capture>['io'], fs: SetupFilesystem) => Promise<number>;

function project(): string {
  return tmpDir('burhan-shared-folder-');
}

function files(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const entry of readdirSync(dir)) {
    if (entry === '.git') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out[path.slice(base.length) + '/'] = '';
      files(path, base, out);
    } else out[path.slice(base.length)] = readFileSync(path, 'utf8');
  }
  return out;
}

const treeHash = (dir: string): string => createHash('sha256').update(JSON.stringify(files(dir))).digest('hex');
const config = (target: string): Record<string, string> => parseConfig(readFileSync(join(target, '.workflow/workflow.config'), 'utf8')).values;
const standardAnswers = (docs: SetupAnswers['docs']): SetupAnswers => ({ agents: ['claude'], mode: 'step', docs, lang: 'en' });

/** Make a genuine installed project whose saved layout predates the new shared folders. */
function legacyProject(): string {
  const target = project();
  applySetup(planSetup(target, standardAnswers({ kind: 'private' }), home));
  const configFile = join(target, '.workflow/workflow.config');
  writeFileSync(configFile, readFileSync(configFile, 'utf8')
    .replace(/^WF_DOCS_DIR=.*$/m, "WF_DOCS_DIR='AI_SPEC/docs'")
    .replace(/^WF_DISCOVERY_DIR=.*$/m, "WF_DISCOVERY_DIR='AI_SPEC/discovery'"));
  mkdirSync(join(target, 'AI_SPEC/docs/item'), { recursive: true });
  mkdirSync(join(target, 'AI_SPEC/discovery'), { recursive: true });
  writeFileSync(join(target, 'AI_SPEC/docs/item/item-story.md'), 'legacy work\n');
  writeFileSync(join(target, 'AI_SPEC/discovery/2026-10-13-shared.md'), 'legacy discovery\n');
  return target;
}

/** An installed legacy project whose config relies on the hooks' AI_SPEC/docs default. */
function unsetLegacyProject(): string {
  const target = legacyProject();
  const configFile = join(target, '.workflow/workflow.config');
  writeFileSync(configFile, readFileSync(configFile, 'utf8')
    .replace(/^WF_DOCS_DIR=.*\n/m, '')
    .replace(/^WF_DISCOVERY_DIR=.*\n/m, ''));
  return target;
}

function answerFile(name: string, value: unknown): string {
  const file = join(answersDir, `${name}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(value));
  return file;
}

function agentJson(output: string): { recommended: SharedAnswers; questions: { id: string; text: string; choices: { value: string; label: string }[] }[] } {
  const block = output.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(block, 'setup --agent prints one JSON block');
  return JSON.parse(block[1]);
}

test('a new shared install saves docs/burhan/work and docs/burhan/discovery', () => {
  const target = project();
  applySetup(planSetup(target, standardAnswers({ kind: 'shared' }), home));
  assert.deepEqual(config(target), {
    ...config(target),
    WF_DOCS_DIR: 'docs/burhan/work',
    WF_DISCOVERY_DIR: 'docs/burhan/discovery',
  });
});

test('a legacy AI_SPEC shared install is recognised as shared and marked legacy', () => {
  const target = legacyProject();
  const current = currentAnswers(target) as SharedAnswers | null;
  assert.ok(current);
  assert.deepEqual(current.docs, { kind: 'shared' });
  assert.equal(current.legacyShared, true);
});

test('an installed project with WF_DOCS_DIR unset keeps its effective AI_SPEC shared folders', async () => {
  const target = unsetLegacyProject();
  const before = treeHash(target);
  const current = currentAnswers(target) as SharedAnswers | null;
  assert.ok(current);
  assert.deepEqual(current.docs, { kind: 'shared' });
  assert.equal(current.legacyShared, true);

  const agent = capture(target);
  assert.equal(await runCli(['setup', target, '--agent'], agent.io), 0);
  assert.ok(agentJson(agent.o.out).questions.some((question) => question.id === 'moveDocs'));

  const wizard = scriptedPrompter(['use', 'keep', 'apply']);
  assert.equal(await runWizard(target, capture(target).io, wizard, 'en', home), 0);
  assert.equal(treeHash(target), before, 'keeping an unset legacy layout changes nothing');
});

test('only a legacy shared install asks to keep or move, in English and Egyptian Arabic', async () => {
  for (const lang of ['en', 'ar'] as const) {
    const target = legacyProject();
    const agent = capture(target);
    assert.equal(await runCli(['setup', target, '--agent', '--lang', lang], agent.io), 0);
    const question = agentJson(agent.o.out).questions.find((candidate) => candidate.id === 'moveDocs');
    assert.ok(question, `${lang} agent output asks about moving the old folder`);
    assert.deepEqual(question.choices.map((choice) => choice.value), ['keep', 'move']);
    if (lang === 'ar') assert.match(question.text, /[\u0600-\u06ff]/);
    else assert.doesNotMatch(question.text, /[\u0600-\u06ff]/);

    const wizard = scriptedPrompter(['use', 'keep', 'apply']);
    assert.equal(await runWizard(target, capture(target).io, wizard, lang, home), 0);
    assert.equal(wizard.asked.length, 3, `${lang} wizard asks use/change, moveDocs, then apply/change`);
  }

  const privateTarget = project();
  applySetup(planSetup(privateTarget, standardAnswers({ kind: 'private' }), home));
  const privateAgent = capture(privateTarget);
  assert.equal(await runCli(['setup', privateTarget, '--agent'], privateAgent.io), 0);
  assert.equal(agentJson(privateAgent.o.out).questions.some((question) => question.id === 'moveDocs'), false);
  const privateWizard = scriptedPrompter(['use', 'apply']);
  assert.equal(await runWizard(privateTarget, capture(privateTarget).io, privateWizard, 'en', home), 0);
  assert.equal(privateWizard.asked.length, 2, 'a private install never sees the move question');
});

test('keep leaves a legacy shared project byte-identical', async () => {
  const target = legacyProject();
  const before = treeHash(target);
  const prompter = scriptedPrompter(['use', 'keep', 'apply']);
  assert.equal(await runWizard(target, capture(target).io, prompter, 'en', home), 0);
  assert.equal(treeHash(target), before);
});

test('move renames both legacy folders without changing their contents and writes the new paths', async () => {
  const target = legacyProject();
  const work = readFileSync(join(target, 'AI_SPEC/docs/item/item-story.md'), 'utf8');
  const discovery = readFileSync(join(target, 'AI_SPEC/discovery/2026-10-13-shared.md'), 'utf8');
  const answers = answerFile('move', { agents: 'claude', mode: 'step', docs: 'shared', moveDocs: 'move' });
  const result = capture(target);
  assert.equal(await runCli(['setup', target, '--answers', answers, '--apply'], result.io), 0, result.o.err);
  assert.equal(existsSync(join(target, 'AI_SPEC/docs')), false);
  assert.equal(existsSync(join(target, 'AI_SPEC/discovery')), false);
  assert.equal(readFileSync(join(target, 'docs/burhan/work/item/item-story.md'), 'utf8'), work);
  assert.equal(readFileSync(join(target, 'docs/burhan/discovery/2026-10-13-shared.md'), 'utf8'), discovery);
  assert.equal(config(target).WF_DOCS_DIR, 'docs/burhan/work');
  assert.equal(config(target).WF_DISCOVERY_DIR, 'docs/burhan/discovery');
});

test('a failed legacy move rolls both folders back and returns a plain localised error', async () => {
  for (const [lang, fail] of [
    ['en', 'rename'] as const,
    ['ar', 'config'] as const,
  ]) {
    const target = legacyProject();
    const before = treeHash(target);
    const answers = answerFile(`rollback-${fail}`, { agents: 'claude', mode: 'step', docs: 'shared', moveDocs: 'move', lang });
    const fs: SetupFilesystem = {
      mkdir: mkdirSync,
      rename: (from, to) => {
        if ((fail === 'rename' && to.endsWith('docs/burhan/discovery')) || (fail === 'config' && to.endsWith('.workflow/workflow.config'))) throw new Error('injected filesystem failure');
        return renameSync(from, to);
      },
      put: (path, data) => {
        if (fail === 'config' && path.endsWith('.workflow/workflow.config')) throw new Error('injected filesystem failure');
        putFile(path, data);
      },
    };
    const result = capture(target);
    // The answers path uses the CLI's normal BurhanError-to-exit-2 handling; the filesystem injection
    // makes the move fail after the first rename in both variants.
    assert.equal(await (runCli as unknown as RunCliWithFilesystem)(['setup', target, '--answers', answers, '--apply'], result.io, fs), 2);
    assert.doesNotMatch(result.o.err, /injected filesystem failure|Error:/);
    assert.match(result.o.err, lang === 'en' ? /move|folders|changed/i : /[\u0600-\u06ff]/);
    assert.equal(treeHash(target), before, `${fail} failure restores the whole project`);
  }
});

test('a failed rollback reports the split folders and unchanged config in both languages', async () => {
  for (const lang of ['en', 'ar'] as const) {
    const target = legacyProject();
    const answers = answerFile(`rollback-failed-${lang}`, { agents: 'claude', mode: 'step', docs: 'shared', moveDocs: 'move', lang });
    const fs: SetupFilesystem = {
      mkdir: mkdirSync,
      rename: (from, to) => {
        if (to.endsWith('docs/burhan/discovery') || (from.endsWith('docs/burhan/work') && to.endsWith('AI_SPEC/docs')))
          throw new Error('injected filesystem failure');
        return renameSync(from, to);
      },
      put: putFile,
    };
    const result = capture(target);
    assert.equal(await (runCli as unknown as RunCliWithFilesystem)(['setup', target, '--answers', answers, '--apply'], result.io, fs), 2);
    assert.doesNotMatch(result.o.err, /Nothing was changed|مفيش حاجة اتغيّرت/);
    assert.doesNotMatch(result.o.err, /injected filesystem failure|Error:/);
    for (const path of ['docs/burhan/work', 'AI_SPEC/discovery', 'AI_SPEC/docs', 'WF_DOCS_DIR', 'WF_DISCOVERY_DIR'])
      assert.match(result.o.err, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${lang} reports ${path}`);
    assert.equal(existsSync(join(target, 'docs/burhan/work')), true, `${lang} reports the work folder where it remains`);
    assert.equal(existsSync(join(target, 'AI_SPEC/discovery')), true, `${lang} reports the discovery folder where it remains`);
    assert.equal(config(target).WF_DOCS_DIR, 'AI_SPEC/docs');
    assert.equal(config(target).WF_DISCOVERY_DIR, 'AI_SPEC/discovery');
  }
});

test('a pre-existing move target exits 2 and leaves the legacy project unchanged', async () => {
  const target = legacyProject();
  mkdirSync(join(target, 'docs/burhan/work'), { recursive: true });
  writeFileSync(join(target, 'docs/burhan/work/already-here.md'), 'do not replace\n');
  const before = treeHash(target);
  const answers = answerFile('blocked-move', { agents: 'claude', mode: 'step', docs: 'shared', moveDocs: 'move' });
  const result = capture(target);
  assert.equal(await runCli(['setup', target, '--answers', answers, '--apply'], result.io), 2);
  assert.match(result.o.err, /docs\/burhan\/work|target|exists/i);
  assert.equal(treeHash(target), before);
});

test('answers default moveDocs to keep, allow keep or move, and reject another value before writing', async () => {
  const base = { agents: 'claude', mode: 'step', docs: 'shared' };
  const absent = readAnswers(answerFile('absent', base), 'en') as SharedAnswers;
  assert.equal(absent.moveDocs, 'keep');
  assert.equal((readAnswers(answerFile('keep', { ...base, moveDocs: 'keep' }), 'en') as SharedAnswers).moveDocs, 'keep');
  assert.equal((readAnswers(answerFile('move-value', { ...base, moveDocs: 'move' }), 'en') as SharedAnswers).moveDocs, 'move');

  const target = legacyProject();
  const before = treeHash(target);
  const invalid = answerFile('invalid', { ...base, moveDocs: 'rename' });
  const result = capture(target);
  assert.equal(await runCli(['setup', target, '--answers', invalid, '--apply'], result.io), 2);
  assert.match(result.o.err, /moveDocs[\s\S]*keep[\s\S]*move/i);
  assert.equal(treeHash(target), before);
});

test('hook and status fallback defaults deliberately stay on the legacy shared paths', () => {
  const defaults = [
    ['kit/hooks/core/lib.sh', ': "${WF_DOCS_DIR:=AI_SPEC/docs}"', ': "${WF_DISCOVERY_DIR:=AI_SPEC/discovery}"'],
    ['src/hooks/core/config.mts', "def('WF_DOCS_DIR', 'AI_SPEC/docs');", "def('WF_DISCOVERY_DIR', 'AI_SPEC/discovery');"],
    ['src/lib/status.ts', "?? 'AI_SPEC/docs'"],
  ] as const;
  for (const [file, ...expected] of defaults) {
    const text = readFileSync(file, 'utf8');
    for (const value of expected) assert.ok(text.includes(value), `${file} keeps ${value}`);
  }
});
