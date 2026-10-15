import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { runChecks, type Probe } from '../src/lib/doctor.js';
import { applySetup, ignoredCommittedSetupFiles, planSetup, renderSummary, type SetupAnswers } from '../src/lib/setup/engine.js';
import { tmpDir } from './helpers.js';

const home = tmpDir('burhan-gitignore-home-');
const probe: Probe = { bashMajor: () => 5, has: () => true, jqVersion: () => 'jq-1.8.1', nodeVersion: () => '24.13.0', claudeVersion: () => '2.1.296', home: () => home };
const answers: SetupAnswers = { agents: ['claude', 'codex'], mode: 'step', docs: { kind: 'shared' }, lang: 'en' };
const ignoredCommittedFiles = [
  '!/.claude/settings.json',
  '!/.claude/commands/burhan/e2e.md',
  '!/.claude/commands/burhan/qc.md',
  '!/.claude/agents/burhan-reviewer.md',
  '!/.codex/hooks.json',
];

test('one scoped ignore writer keeps kit, config and memory trackable and private files ignored', () => {
  const target = repo('# mine\n');
  const selected: SetupAnswers = { ...answers, docs: { kind: 'private' } };
  applySetup(planSetup(target, selected, home));
  const ignore = join(target, '.burhan/.gitignore');
  assert.equal(readFileSync(ignore, 'utf8'), '/local/\n/work/\n/discovery/\n');
  for (const rel of ['local/state.md', 'work/item/story.md', 'discovery/finding.md', 'context/stack.md']) {
    mkdirSync(join(target, '.burhan', rel, '..'), { recursive: true });
    writeFileSync(join(target, '.burhan', rel), 'private or memory\n');
  }
  writeFileSync(join(target, '.burhan/PROJECT.md'), 'memory\n');
  for (const rel of ['local/state.md', 'work/item/story.md', 'discovery/finding.md'])
    assert.equal(spawnSync('git', ['check-ignore', '--quiet', '--', `.burhan/${rel}`], { cwd: target }).status, 0, rel);
  for (const rel of ['WORKFLOW.md', 'workflow.config', 'PROJECT.md', 'context/stack.md'])
    assert.equal(spawnSync('git', ['check-ignore', '--quiet', '--', `.burhan/${rel}`], { cwd: target }).status, 1, rel);
  assert.deepEqual(ignoredCommittedSetupFiles(target), []);
  assert.deepEqual(ignoredCommittedSetupFiles(target, planSetup(target, selected, home).files), []);
  const user = '# keep my rules\r\n/cache/\r\n/local/\r\n';
  writeFileSync(ignore, user);
  applySetup(planSetup(target, selected, home));
  assert.equal(readFileSync(ignore, 'utf8'), user + '/work/\n/discovery/\n');
  applySetup(planSetup(target, selected, home));
  assert.equal(readFileSync(ignore, 'utf8'), user + '/work/\n/discovery/\n');
  assert.equal(readFileSync(join(target, '.gitignore'), 'utf8'), '# mine\n');
});

function repo(gitignore: string): string {
  const target = tmpDir('burhan-gitignore-');
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: target }).status, 0, 'git init');
  writeFileSync(join(target, '.gitignore'), gitignore);
  return target;
}

function ignoredLines(text: string): string[] {
  return text.split('\n').filter((line) => /^\s*(?:!\/|\/\.)/.test(line)).map((line) => line.trim());
}

test('AC-18: ignored committed setup files warn in both summaries and doctor without editing .gitignore', () => {
  const hidden = '/.claude/*\n.codex\n';
  const target = repo(hidden);
  applySetup(planSetup(target, answers, home));
  assert.equal(readFileSync(join(target, '.gitignore'), 'utf8'), hidden, '.gitignore stays byte-identical after apply');

  for (const lang of ['en', 'ar'] as const) {
    const lines = ignoredLines(renderSummary(planSetup(target, answers, home), lang));
    for (const line of ignoredCommittedFiles) assert.ok(lines.includes(line), `${lang} summary lists ${line}`);
    assert.deepEqual(lines.filter((line) => line.startsWith('!/.codex') || line.startsWith('/.codex')),
      ['!/.codex/', '/.codex/*', '!/.codex/hooks.json'], `${lang} unignores the ignored parent before its file`);
  }

  const doctorWarnings = runChecks(target, probe).filter((check) => check.status === 'warn').flatMap((check) => ignoredLines(check.text));
  assert.deepEqual(doctorWarnings, ignoredLines(renderSummary(planSetup(target, answers, home), 'en')), 'doctor lists the same exact negated ignore lines');

  const clean = '# project ignores\n';
  const cleanTarget = repo(clean);
  applySetup(planSetup(cleanTarget, answers, home));
  assert.equal(readFileSync(join(cleanTarget, '.gitignore'), 'utf8'), clean, '.gitignore stays byte-identical in a clean repo');
  for (const lang of ['en', 'ar'] as const)
    assert.deepEqual(ignoredLines(renderSummary(planSetup(cleanTarget, answers, home), lang)), [], `${lang} clean summary has no ignore warning`);
  assert.deepEqual(runChecks(cleanTarget, probe).filter((check) => check.status === 'warn').flatMap((check) => ignoredLines(check.text)), [], 'clean doctor has no ignore warning');
});

test('AC-18: printed lines unignore planned kit files in a fresh repo', () => {
  const fixture = repo('/.burhan\n/.claude/*\n.codex\n');
  const hidden = readFileSync(join(fixture, '.gitignore'), 'utf8');
  const target = repo(hidden);
  const plan = planSetup(target, answers, home);
  const lines = ignoredLines(renderSummary(plan, 'en'));
  assert.ok(lines.includes('!/.burhan/WORKFLOW.md'), 'summary includes a kit file from a directory not yet in the target');
  assert.deepEqual(lines.filter((line) => line.startsWith('!/.codex') || line.startsWith('/.codex')),
    ['!/.codex/', '/.codex/*', '!/.codex/hooks.json'], 'the ignored .codex parent is opened before its file');

  writeFileSync(join(target, '.gitignore'), hidden + lines.join('\n') + '\n');
  applySetup(plan);
  for (const rel of ['.burhan/WORKFLOW.md', '.burhan/hooks/node/core/turn-audit.mjs', '.claude/settings.json', '.claude/commands/burhan/e2e.md', '.codex/hooks.json'])
    assert.notEqual(spawnSync('git', ['-C', target, 'check-ignore', '--quiet', '--no-index', '--', rel]).status, 0, `${rel} is no longer ignored after adding the printed lines`);
});
