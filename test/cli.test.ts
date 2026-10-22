import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { runCli } from '../src/main.js';
import { packageRoot, kitDir } from '../src/lib/kit.js';
import { capture, tmpDir } from './helpers.js';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseConfig } from '../src/lib/config.js';
import { runWizard } from '../src/lib/setup/wizard.js';
import { scriptedPrompter } from '../src/lib/setup/prompter.js';

test('--version prints the package.json version', async () => {
  const { o, io } = capture();
  assert.equal(await runCli(['--version'], io), 0);
  assert.equal(o.out, JSON.parse(readFileSync(join(packageRoot(), 'package.json'), 'utf8')).version + '\n');
});

test('--help prints usage and exits 0; no command exits 2', async () => {
  const a = capture();
  assert.equal(await runCli(['--help'], a.io), 0);
  assert.match(a.o.out, /usage: burhan <command>/);
  assert.match(a.o.out, /--set check=<cmd\|none> \[code=<re>\] \[test=<re>\] \[evidence=<re>\] \[sensitive=<p;q>\]/);
  assert.doesNotMatch(a.o.out, /never-run|neverRun|WF_FORBIDDEN|WF_SINGLE_TEST_HINT/i);
  const b = capture();
  assert.equal(await runCli([], b.io), 2);
  assert.match(b.o.out, /usage: burhan <command>/);
});

test('unknown command exits 2 and names it', async () => {
  const { o, io } = capture();
  assert.equal(await runCli(['frobnicate'], io), 2);
  assert.match(o.err, /unknown command: frobnicate/);
});

test('the kit is found from the compiled module', () => {
  assert.match(kitDir(), /kit$/);
  assert.ok(packageRoot().length > 0);
});

test('the compiled entry point runs as a program', () => {
  const r = spawnSync(process.execPath, [join(packageRoot(), '.test-build/src/cli.js'), '--version'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, JSON.parse(readFileSync(join(packageRoot(), 'package.json'), 'utf8')).version + '\n');
});

test('bare command without a terminal prints usage and exits 2; setup without one points to a terminal', async () => {
  const a = capture(); a.io.interactive = false;
  assert.equal(await runCli([], a.io), 2);
  assert.match(a.o.out, /usage: burhan <command>/);
  const b = capture(); b.io.interactive = false;
  assert.equal(await runCli(['setup', tmpdir()], b.io), 2);
  assert.match(b.o.err, /needs a terminal/);
});

test('setup --stack prints the first-use block; setup --set saves the check end to end', async () => {
  const a = capture();
  assert.equal(await runCli(['setup', '--stack'], a.io), 0);
  assert.match(a.o.out, /first-use setup/);
  const t = tmpDir('burhan-cli-set-');
  spawnSync('git', ['init', '-q'], { cwd: t });
  await runWizard(t, capture(t).io, scriptedPrompter(['use', 'apply']), 'en', t);
  const b = capture(t);
  assert.equal(await runCli(['setup', t, '--set', 'check=exit 0', 'sensitive=a;b'], b.io), 0);
  assert.equal(parseConfig(readFileSync(join(t, '.burhan/workflow.config'), 'utf8')).values.WF_CHECK_CMD, 'exit 0');
});

test('setup --set saves code, test and evidence end to end; a pattern the hooks refuse exits 2 and saves nothing', async () => {
  const t = tmpDir('burhan-cli-set-patterns-');
  spawnSync('git', ['init', '-q'], { cwd: t });
  await runWizard(t, capture(t).io, scriptedPrompter(['use', 'apply']), 'en', t);
  const cfg = (): Record<string, string> => parseConfig(readFileSync(join(t, '.burhan/workflow.config'), 'utf8')).values;
  const ok = capture(t);
  assert.equal(await runCli(['setup', t, '--set', 'check=exit 0', 'code=\\.js$', 'test=\\.test\\.js$', 'evidence=^npm test'], ok.io), 0);
  assert.equal(cfg().WF_CODE_REGEX, '\\.js$');
  assert.equal(cfg().WF_TEST_REGEX, '\\.test\\.js$');
  assert.equal(cfg().WF_EVIDENCE_REGEX, '^npm test');
  const bad = capture(t);
  assert.equal(await runCli(['setup', t, '--set', 'check=exit 0', '--force', 'code=(a)\\1'], bad.io), 2);
  assert.match(bad.o.err, /code pattern/);
  assert.equal(cfg().WF_CODE_REGEX, '\\.js$', 'the saved pattern is untouched');
});

test('setup allowed flag forms still dispatch normally (AC-05)', async () => {
  const answersTarget = tmpDir('burhan-cli-answers-');
  spawnSync('git', ['init', '-q'], { cwd: answersTarget });
  const answers = join(answersTarget, 'answers.json');
  writeFileSync(answers, JSON.stringify({ agents: 'claude', mode: 'step', docs: 'private' }));
  assert.equal(await runCli(['setup', answersTarget, '--answers', answers, '--apply'], capture(answersTarget).io), 0);

  const setTarget = tmpDir('burhan-cli-set-allowed-');
  spawnSync('git', ['init', '-q'], { cwd: setTarget });
  await runWizard(setTarget, capture(setTarget).io, scriptedPrompter(['use', 'apply']), 'en', setTarget);
  assert.equal(await runCli(['setup', setTarget, '--set', 'check=exit 0'], capture(setTarget).io), 0);

  // Run against a fresh repository, not the process cwd (this checkout may carry its own install).
  assert.equal(await runCli(['setup', setTarget, '--stack'], capture(setTarget).io), 0);
  const agentTarget = tmpDir('burhan-cli-agent-');
  spawnSync('git', ['init', '-q'], { cwd: agentTarget });
  assert.equal(await runCli(['setup', agentTarget, '--agent'], capture(agentTarget).io), 0);
});

test('an error inside an async setup command is a plain "burhan: …" message with exit 2, not a stack trace (review I-1)', async () => {
  const d = tmpDir('burhan-cli-noinst-');
  spawnSync('git', ['init', '-q', d]);
  const { o, io } = capture(d);
  assert.equal(await runCli(['setup', d, '--set', 'check=true'], io), 2);
  assert.match(o.err, /^burhan: burhan is not installed/);
});

const CLASHING_SETUP_FLAGS: [string, string, string[]][] = [
  ['--agent', '--answers', ['--agent', '--answers', 'answers.json']],
  ['--agent', '--apply', ['--agent', '--apply']],
  ['--agent', '--set', ['--agent', '--set', 'check=true']],
  ['--agent', '--stack', ['--agent', '--stack']],
  ['--stack', '--set', ['--stack', '--set', 'check=true']],
  ['--stack', '--answers', ['--stack', '--answers', 'answers.json']],
];

for (const lang of ['en', 'ar'] as const) {
  for (const [first, second, flags] of CLASHING_SETUP_FLAGS) {
    test(`setup rejects ${first} with ${second} in ${lang} before writing (AC-05, AC-06)`, async () => {
      const target = tmpDir('burhan-cli-clash-');
      const before = readdirSync(target);
      const { o, io } = capture(target);

      assert.equal(await runCli(['setup', target, '--lang', lang, ...flags], io), 2);
      assert.match(o.err, new RegExp(first.replace('-', '\\-')));
      assert.match(o.err, new RegExp(second.replace('-', '\\-')));
      if (lang === 'ar') assert.match(o.err, /[\u0600-\u06ff]/);
      assert.deepEqual(readdirSync(target), before);
    });
  }
}
