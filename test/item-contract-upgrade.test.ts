import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyPlan, planInstall } from '../src/lib/install.js';
import { loadHookConfig } from '../src/hooks/core/config.mjs';
import { tmpDir } from './helpers.js';

function install(mode: 'init' | 'upgrade', dir: string): void {
  applyPlan(planInstall({ mode, target: dir, agents: ['claude'], apply: true, bootstrap: false }));
}
const project = (config: string | null): string => {
  const d = tmpDir('burhan-contract-upgrade-');
  spawnSync('git', ['init', '-q'], { cwd: d });
  if (config !== null) { mkdirSync(join(d, '.burhan'), { recursive: true }); writeFileSync(join(d, '.burhan/workflow.config'), config); }
  return d;
};

test('a project made by init starts with the item contract on, and the hooks read it as on', () => {
  const d = project(null);
  install('init', d);
  assert.match(readFileSync(join(d, '.burhan/workflow.config'), 'utf8'), /^WF_ITEM_CONTRACT="on"$/m);
  assert.equal(loadHookConfig(d, {}).WF_ITEM_CONTRACT, 'on');
});

test('an existing project that never set the key is left exactly as it is by upgrade, and the hooks read it as off', () => {
  const config = 'WF_CHECK_CMD="npm run lint"\nWF_SKILLS="none"\n';
  const d = project(config);
  install('init', d);
  writeFileSync(join(d, '.burhan/workflow.config'), config); // the team file as an older version left it
  install('upgrade', d);
  assert.equal(readFileSync(join(d, '.burhan/workflow.config'), 'utf8'), config);
  assert.equal(loadHookConfig(d, {}).WF_ITEM_CONTRACT, 'off');
});

test('the item files do not appear in a project by upgrade: no item, no state file entry', () => {
  const d = project(null);
  install('init', d);
  install('upgrade', d);
  assert.equal(readFileSync(join(d, '.burhan/workflow.config'), 'utf8').includes('WF_ITEM_CONTRACT="on"'), true);
  assert.throws(() => readFileSync(join(d, '.burhan/work/anything'), 'utf8'));
});
