import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { install } from '../src/lib/install.js';
import { applySetup, planSetup } from '../src/lib/setup/engine.js';
import { capture, tmpDir } from './helpers.js';

// first-use-fixes SU2: the Kit command row tells the agent how this project runs the kit CLI
const ROW = '| **Kit command** | `npx burhan-kit` | — |';
const home = tmpDir('burhan-kitcmd-home-');
const bindings = (t: string): string => readFileSync(join(t, '.burhan/bindings.md'), 'utf8');
const project = (): string => { const t = tmpDir('burhan-kitcmd-'); spawnSync('git', ['init', '-q'], { cwd: t }); return t; };
const answers = { agents: ['claude' as const], mode: 'step' as const, docs: { kind: 'private' as const }, lang: 'en' as const };

test('init writes npx burhan-kit into the Kit command row of a new bindings.md', () => {
  const t = project();
  assert.equal(install({ mode: 'init', target: t, agents: ['claude'], apply: true, bootstrap: false }, capture(t).io), 0);
  assert.ok(bindings(t).split('\n').includes(ROW), 'the row is filled');
  assert.ok(!bindings(t).includes('how this project runs the kit CLI'), 'the placeholder is gone');
});

test('init and upgrade never touch an existing bindings.md, not even a placeholder row', () => {
  const t = project();
  mkdirSync(join(t, '.burhan'), { recursive: true });
  const mine = '# my bindings\n| **Kit command** | *(how this project runs the kit CLI, e.g. `npx burhan-kit` or `burhan`)* | — |\n';
  writeFileSync(join(t, '.burhan/bindings.md'), mine);
  assert.equal(install({ mode: 'init', target: t, agents: ['claude'], apply: true, bootstrap: false }, capture(t).io), 0);
  assert.equal(bindings(t), mine);
  assert.equal(install({ mode: 'upgrade', target: t, agents: null, apply: true, bootstrap: false }, capture(t).io), 0);
  assert.equal(bindings(t), mine);
});

test('setup fills the row while it is the template placeholder, in a new file and in an existing one, and keeps a value the person wrote', () => {
  const fresh = project();
  applySetup(planSetup(fresh, answers, home));
  assert.ok(bindings(fresh).split('\n').includes(ROW), 'a new bindings.md');

  const placeholder = project();
  mkdirSync(join(placeholder, '.burhan'), { recursive: true });
  writeFileSync(join(placeholder, '.burhan/bindings.md'), '| **Kit command** | *(how this project runs the kit CLI, e.g. `npx burhan-kit` or `burhan`)* | — |\n');
  applySetup(planSetup(placeholder, answers, home));
  assert.ok(bindings(placeholder).split('\n').includes(ROW), 'an existing file that still has the placeholder');

  const own = project();
  mkdirSync(join(own, '.burhan'), { recursive: true });
  writeFileSync(join(own, '.burhan/bindings.md'), '| **Kit command** | `node dist/cli.js` | — |\n');
  applySetup(planSetup(own, answers, home));
  assert.ok(bindings(own).includes('| **Kit command** | `node dist/cli.js` | — |'), "the person's value stays");
  assert.ok(!bindings(own).includes('npx burhan-kit` | —'));
});
