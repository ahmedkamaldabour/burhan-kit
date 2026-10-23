import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runChecks, type Probe } from '../src/lib/doctor.js';
import { install, planInstall, applyPlan } from '../src/lib/install.js';
import { applySetup, planSetup } from '../src/lib/setup/engine.js';
import type { SetupAnswers } from '../src/lib/setup/answers.js';
import { renderSummary } from '../src/lib/setup/summary.js';
import { stateNow } from '../src/hooks/core/lib.mjs';
import { runCli } from '../src/main.js';
import { capture, posixOnly, tmpDir } from './helpers.js';

const home = tmpDir('burhan-state-home-');
const good: Probe = { nodeVersion: () => '24.13.0', claudeVersion: () => '2.1.296', home: () => home };
const fresh = (): string => { const d = tmpDir('burhan-state-'); spawnSync('git', ['init', '-q'], { cwd: d }); return d; };
const answers: SetupAnswers = { agents: ['claude'], mode: 'step', docs: { kind: 'private' }, lang: 'en' };
const STATE = '.burhan/local/PROGRESS.md';
const headings = (t: string): string[] => t.split('\n').filter((l) => /^#{2,} /.test(l));
const initInstall = (t: string): void => { install({ mode: 'init', target: t, agents: ['claude'], apply: true, bootstrap: false }, capture(t).io); };

test('AC-06: setup, init and upgrade create the state file with only the four sections', () => {
  const a = fresh(); applySetup(planSetup(a, answers, home));
  const b = fresh(); initInstall(b);
  for (const t of [a, b]) {
    const text = readFileSync(join(t, STATE), 'utf8');
    assert.deepEqual(headings(text), ['## Now', '## Waiting on you', '## Commit instructions', '## Standing facts']);
    assert.equal(text.split('\n').filter((l) => /^\s*[-*|]|^###/.test(l)).length, 0, 'no items, no bullets');
  }
  const c = fresh(); initInstall(c); rmSync(join(c, STATE));
  install({ mode: 'upgrade', target: c, agents: null, apply: true, bootstrap: false }, capture(c).io);
  assert.ok(existsSync(join(c, STATE)), 'upgrade of an install with no state file creates it');
});

test('AC-06: an existing state file is never changed (setup, init again, upgrade)', () => {
  const t = fresh(); mkdirSync(join(t, '.burhan/local'), { recursive: true });
  const mine = '# mine\n## Now\n### x\n- y\n';
  writeFileSync(join(t, STATE), mine);
  applySetup(planSetup(t, answers, home));
  initInstall(t);
  install({ mode: 'upgrade', target: t, agents: null, apply: true, bootstrap: false }, capture(t).io);
  assert.equal(readFileSync(join(t, STATE), 'utf8'), mine);
  assert.ok(!renderSummary(planSetup(t, answers, home), 'en').includes('state file'), 'nothing to create → no state line in the summary');
});

test('AC-06: a custom WF_STATE_FILE is honoured', () => {
  const t = fresh(); mkdirSync(join(t, '.burhan'), { recursive: true });
  writeFileSync(join(t, '.burhan/workflow.config'), "WF_STATE_FILE='notes/STATE.md'\n");
  initInstall(t);
  assert.ok(existsSync(join(t, 'notes/STATE.md')));
  assert.ok(!existsSync(join(t, STATE)));
});

test('AC-06 security: a state path that leaves the project, or runs through a link out of it, is not created', () => {
  const out = tmpDir('burhan-state-out-');
  for (const value of ['/tmp/burhan-state-abs.md', '../burhan-state-up.md', 'a/../../b.md']) {
    const t = fresh(); mkdirSync(join(t, '.burhan'), { recursive: true });
    writeFileSync(join(t, '.burhan/workflow.config'), `WF_STATE_FILE='${value}'\n`);
    const { o, io } = capture(t);
    install({ mode: 'init', target: t, agents: ['claude'], apply: true, bootstrap: false }, io);
    assert.match(o.out, /state file/i, value);
    assert.ok(!existsSync('/tmp/burhan-state-abs.md') && !existsSync(join(t, '..', 'burhan-state-up.md')), value);
  }
  const t = fresh(); mkdirSync(join(t, '.burhan'), { recursive: true });
  symlinkSync(out, join(t, '.burhan/local'), 'dir');
  initInstall(t);
  assert.deepEqual(readdirSync(out), [], 'nothing written through the link');
  const u = fresh(); mkdirSync(join(u, '.burhan/local'), { recursive: true });
  symlinkSync(join(out, 'target.md'), join(u, STATE));
  initInstall(u);
  assert.deepEqual(readdirSync(out), [], 'nothing written through a dangling link');
});

test('AC-07: the file is git-ignored; doctor, the router and the size gate are fine with it', () => {
  const t = fresh(); applySetup(planSetup(t, answers, home));
  assert.equal(spawnSync('git', ['check-ignore', '-q', STATE], { cwd: t }).status, 0);
  const cs = runChecks(t, good).filter((c) => c.text.includes('PROGRESS.md') || c.text.includes('local/'));
  assert.ok(cs.some((c) => c.status === 'ok' && /PROGRESS\.md: \d+ \/ 80 lines/.test(c.text)), JSON.stringify(cs));
  assert.ok(cs.every((c) => c.status === 'ok'));
  assert.equal(stateNow(t, { WF_STATE_FILE: STATE } as never), '');
});

test('AC-06: uninstall without --all keeps the state file', async () => {
  const t = fresh(); applySetup(planSetup(t, answers, home));
  const { io } = capture(t);
  assert.equal(await runCli(['uninstall', t, '--apply'], io), 0);
  assert.ok(existsSync(join(t, STATE)));
});

test('AC-06: the setup summary lists the new state file once, in en and ar', () => {
  const t = fresh();
  for (const lang of ['en', 'ar'] as const) {
    const s = renderSummary(planSetup(t, { ...answers, lang }, home), lang);
    assert.equal(s.split(STATE).length - 1, 1, lang);
  }
});

test('review I-1: a file that exists when the plan is applied is never overwritten', () => {
  // (a) plan first, the person's file appears before apply
  const t = fresh(); mkdirSync(join(t, '.burhan'), { recursive: true });
  const plan = planInstall({ mode: 'init', target: t, agents: ['claude'], apply: true, bootstrap: false });
  mkdirSync(join(t, '.burhan/local'), { recursive: true }); writeFileSync(join(t, STATE), 'MINE');
  applyPlan(plan);
  assert.equal(readFileSync(join(t, STATE), 'utf8'), 'MINE');
  // (b) the state path names a file another step of the same run creates (the bootstrap file)
  const u = fresh(); mkdirSync(join(u, '.burhan'), { recursive: true });
  writeFileSync(join(u, '.burhan/workflow.config'), "WF_STATE_FILE='CLAUDE.md'\n");
  install({ mode: 'init', target: u, agents: ['claude'], apply: true, bootstrap: true }, capture(u).io);
  assert.match(readFileSync(join(u, 'CLAUDE.md'), 'utf8'), /burhan:start/);
  assert.doesNotMatch(readFileSync(join(u, 'CLAUDE.md'), 'utf8'), /## Standing facts/);
});

test('review M: a dry run writes nothing; unusable state paths get a NOTE and no file', () => {
  const t = fresh(); mkdirSync(join(t, '.burhan'), { recursive: true });
  const { o, io } = capture(t);
  install({ mode: 'init', target: t, agents: ['claude'], apply: false, bootstrap: false }, io);
  assert.ok(!existsSync(join(t, STATE)) && !existsSync(join(t, '.burhan/WORKFLOW.md')));
  assert.match(o.out, /state file/);
  for (const value of ['notes/', 'C:\\x\\s.md', '.git/hooks/pre-commit', '.burhan/hooks/node/s.md', '.burhan/templates/s.md']) {
    const u = fresh(); mkdirSync(join(u, '.burhan'), { recursive: true });
    writeFileSync(join(u, '.burhan/workflow.config'), `WF_STATE_FILE='${value}'\n`);
    const c = capture(u);
    install({ mode: 'init', target: u, agents: ['claude'], apply: true, bootstrap: false }, c.io);
    assert.match(c.o.out, /NOTE: the state file/, value);
    assert.ok(!existsSync(join(u, '.git/hooks/pre-commit')) && !existsSync(join(u, 'notes')) && !existsSync(join(u, '.burhan/templates/s.md')) && !existsSync(join(u, '.burhan/hooks/node/s.md')), value);
  }
});

test('QC D1: a folder the person cannot write to makes a NOTE, never an aborted install', { skip: posixOnly || (process.getuid?.() === 0 ? 'root ignores permission bits' : false) }, () => {
  const t = fresh(); mkdirSync(join(t, '.burhan/local'), { recursive: true });
  chmodSync(join(t, '.burhan/local'), 0o500);
  try {
    const { o, io } = capture(t);
    assert.equal(install({ mode: 'init', target: t, agents: ['claude'], apply: true, bootstrap: false }, io), 0, o.err);
    assert.match(o.out, /NOTE: the state file/);
    assert.ok(!existsSync(join(t, STATE)));
    assert.ok(existsSync(join(t, '.burhan/WORKFLOW.md')), 'the rest of the install still happened');
  } finally { chmodSync(join(t, '.burhan/local'), 0o700); }
});

test('QC D2: the summary line does not claim the file stays out of git', () => {
  const s = renderSummary(planSetup(fresh(), answers, home), 'en');
  assert.match(s, /state file/);
  assert.doesNotMatch(s.split('\n').filter((l) => l.includes(STATE)).join('\n'), /not in git/);
});

test('QC: a state path another step of the same run writes gets a NOTE, not a "created" line', () => {
  for (const value of ['CLAUDE.md', '.claude/settings.json', '.burhan/WORKFLOW.md']) {
    const t = fresh(); mkdirSync(join(t, '.burhan'), { recursive: true });
    writeFileSync(join(t, '.burhan/workflow.config'), `WF_STATE_FILE='${value}'\n`);
    const plan = planInstall({ mode: 'init', target: t, agents: ['claude'], apply: false, bootstrap: true });
    assert.ok(!plan.files.some((f) => f.kind === 'state'), value);
    assert.ok(plan.steps.some((s) => /^NOTE: the state file/.test(s.say)), value);
  }
});
