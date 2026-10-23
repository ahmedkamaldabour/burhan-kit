import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyPlan, planInstall } from '../src/lib/install.js';
import { LEGACY_BASH_COMMANDS, ownsHooks, snippetKeys, type Settings } from '../src/lib/hooks-merge.js';
import { bashInstall, v022 } from './legacy-bash.js';
import { uninstall } from '../src/lib/uninstall.js';
import { capture, tmpDir } from './helpers.js';

const FIXTURE = { claude: 'claude.settings.snippet.json', codex: 'codex.hooks.snippet.json' } as const;
const AGENT_FILE = { claude: '.claude/settings.json', codex: '.codex/hooks.json' } as const;
const hookCommands = (dir: string, agent: 'claude' | 'codex'): string[] => snippetKeys(JSON.parse(readFileSync(join(dir, AGENT_FILE[agent]), 'utf8')) as Settings);

for (const agent of ['claude', 'codex'] as const) {
  test(`the embedded ${agent} bash commands equal burhan v0.2.2's snippet, byte for byte`, () => {
    const committed = snippetKeys(JSON.parse(v022(FIXTURE[agent])) as Settings);
    assert.equal(committed.length, 5);
    assert.deepEqual([...LEGACY_BASH_COMMANDS[agent]], committed);
  });

  test(`${agent}: old bash entries are recognised as ours with no kit snippet and no project copy`, () => {
    const d = tmpDir('burhan-legacy-keys-');
    bashInstall(d, [agent]);
    rmSync(join(d, '.burhan'), { recursive: true });
    assert.equal(ownsHooks(d, agent), true, 'the agent file alone proves it holds burhan entries');
  });
}

test('an upgrade interrupted after the bash directories were removed still replaces the old entries', () => {
  const d = tmpDir('burhan-legacy-interrupted-');
  spawnSync('git', ['init', '-q'], { cwd: d });
  bashInstall(d, ['claude', 'codex']);
  rmSync(join(d, '.burhan/hooks'), { recursive: true }); // no adapter directory, no snippet copy left
  const plan = planInstall({ mode: 'upgrade', target: d, agents: ['claude', 'codex'], apply: false, bootstrap: false });
  applyPlan(plan);
  for (const agent of ['claude', 'codex'] as const) {
    assert.equal(hookCommands(d, agent).filter((c) => c.includes('hook.sh')).length, 0, `${agent}: no bash entry is left beside the Node ones`);
    assert.equal(hookCommands(d, agent).length, 6, `${agent}: exactly one entry per hook`);
  }
});

test('uninstalling a 0.2.2 bash install removes its entries and directories and keeps the user\'s own hook', () => {
  const d = tmpDir('burhan-legacy-uninstall-');
  spawnSync('git', ['init', '-q'], { cwd: d });
  bashInstall(d, ['claude', 'codex']);
  const mine = { type: 'command', command: 'node', args: ['tools/mine.js'] };
  const file = join(d, '.claude/settings.json');
  const cur = JSON.parse(readFileSync(file, 'utf8')) as { hooks: Record<string, { hooks: unknown[] }[]> };
  cur.hooks.Stop.unshift({ hooks: [mine] });
  writeFileSync(file, JSON.stringify(cur, null, 2));
  assert.equal(uninstall({ target: d, apply: true, all: false }, capture(d).io), 0);
  assert.equal(existsSync(join(d, '.burhan/hooks')), false, 'both runtimes\' directories go');
  const after = JSON.parse(readFileSync(file, 'utf8')) as { hooks: Record<string, { hooks: unknown[] }[]> };
  assert.deepEqual(after.hooks.Stop, [{ hooks: [mine] }], 'only the user\'s hook is left');
  assert.equal(existsSync(join(d, '.codex/hooks.json')) && /hook\.sh/u.test(readFileSync(join(d, '.codex/hooks.json'), 'utf8')), false);
});
