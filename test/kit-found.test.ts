import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { KitProbe } from '../src/hooks/core/kit-command.mjs';
import { runChecks, type Probe } from '../src/lib/doctor.js';
import { install } from '../src/lib/install.js';
import { readVersion } from '../src/lib/kit.js';
import { runAnswers } from '../src/lib/setup/agent.js';
import { kitStepLines } from '../src/lib/setup/kit-step.js';
import { scriptedPrompter } from '../src/lib/setup/prompter.js';
import { runWizard } from '../src/lib/setup/wizard.js';
import { capture, tmpDir } from './helpers.js';

// AC-01, AC-02: the setup step and the doctor check use one probe; nothing is printed when the kit is found; burhan does not run npm.
const home = tmpDir('burhan-kitfound-home-');
const probeOf = (found: boolean, pkg = false): KitProbe => ({
  isFile: (p) => pkg && p.endsWith('package.json'), isRunnable: () => found, env: { PATH: '' }, platform: process.platform,
});
const fresh = (): string => { const d = tmpDir('burhan-kitfound-'); spawnSync('git', ['init', '-q'], { cwd: d }); return d; };
const answersFile = (): string => {
  const f = join(tmpDir('burhan-kitfound-answers-'), 'answers.json');
  writeFileSync(f, JSON.stringify({ agents: 'claude', mode: 'step', docs: 'private' }));
  return f;
};

test('kitStepLines: the install command with this version for a package.json project, npm i -g without one, nothing when found', () => {
  const v = readVersion();
  assert.ok(kitStepLines('/p', 'en', probeOf(false, true), v).join('\n').includes(`npm i -D burhan-kit@${v}`));
  const noPkg = kitStepLines('/p', 'en', probeOf(false), v).join('\n');
  assert.ok(noPkg.includes('npm i -g burhan-kit') && !noPkg.includes('npm i -D'));
  assert.deepEqual(kitStepLines('/p', 'en', probeOf(true), v), []);
  assert.ok(kitStepLines('/p', 'ar', probeOf(false), v).join('\n').includes('npm i -g burhan-kit'), 'the Arabic text carries the same command');
  assert.match(kitStepLines('/p', 'en', probeOf(false), v).join('\n'), /burhan does not run npm and does not change package\.json/);
});

test('setup --apply prints the install command before the Step 3 block when the kit is not found, and nothing when it is', () => {
  const v = readVersion();
  const a = capture();
  assert.equal(runAnswers(fresh(), answersFile(), true, a.io, 'en', home, undefined, { kit: probeOf(false) }), 0, a.o.err);
  assert.ok(a.o.out.includes('npm i -g burhan-kit'), a.o.out);
  assert.ok(a.o.out.indexOf('Before step 3') !== -1 && a.o.out.indexOf('Before step 3') < a.o.out.indexOf('Step 3 — start your first session'), 'the install step comes first');
  const b = capture();
  assert.equal(runAnswers(fresh(), answersFile(), true, b.io, 'en', home, undefined, { kit: probeOf(false, true) }), 0, b.o.err);
  assert.ok(b.o.out.includes(`npm i -D burhan-kit@${v}`));
  const c = capture();
  assert.equal(runAnswers(fresh(), answersFile(), true, c.io, 'en', home, undefined, { kit: probeOf(true) }), 0, c.o.err);
  assert.doesNotMatch(c.o.out, /npm i -[Dg]/);
  const d = capture();
  assert.equal(runAnswers(fresh(), answersFile(), false, d.io, 'en', home, undefined, { kit: probeOf(false) }), 0, d.o.err);
  assert.doesNotMatch(d.o.out, /npm i -[Dg]/, 'a dry run prints no install step');
});

test('the wizard prints the same step when the kit is not found', async () => {
  const t = fresh();
  const r = capture(t);
  assert.equal(await runWizard(t, r.io, scriptedPrompter(['use', 'apply']), 'en', home, false, probeOf(false)), 0, r.o.err);
  assert.ok(r.o.out.includes('npm i -g burhan-kit'), r.o.out);
  const q = fresh();
  const s = capture(q);
  assert.equal(await runWizard(q, s.io, scriptedPrompter(['use', 'apply']), 'en', home, false, probeOf(true)), 0, s.o.err);
  assert.doesNotMatch(s.o.out, /npm i -[Dg]/);
});

test('doctor warns with the install command when the kit is not found, and says ok when it is', () => {
  const p = tmpDir('burhan-kitfound-doctor-');
  install({ mode: 'init', target: p, agents: ['claude'], apply: true, bootstrap: false }, capture(p).io);
  const probe = (kit: KitProbe): Probe => ({ nodeVersion: () => '24.13.0', claudeVersion: () => '2.1.296', home: () => home, kitProbe: () => kit });
  const missing = runChecks(p, probe(probeOf(false, true))).filter((c) => c.text.startsWith('kit command'));
  assert.equal(missing.length, 1);
  assert.equal(missing[0]!.status, 'warn', 'a warning, never a failure');
  assert.ok(missing[0]!.text.includes(`npm i -D burhan-kit@${readVersion()}`), missing[0]!.text);
  assert.ok(runChecks(p, probe(probeOf(false))).some((c) => c.status === 'warn' && c.text.includes('npm i -g burhan-kit')));
  const found = runChecks(p, probe(probeOf(true))).filter((c) => c.text.startsWith('kit command'));
  assert.deepEqual(found.map((c) => c.status), ['ok']);
});
