import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyPlan, planInstall, type InstallOptions } from '../src/lib/install.js';
import { installRoot } from '../src/hooks/install-root.mjs';
import { tmpDir } from './helpers.js';

function freshRepo(config?: string): string {
  const d = tmpDir('burhan-node-install-');
  spawnSync('git', ['init', '-q'], { cwd: d });
  if (config !== undefined) { mkdirSync(join(d, '.burhan'), { recursive: true }); writeFileSync(join(d, '.burhan/workflow.config'), config); }
  return d;
}
const opts = (target: string, o: Partial<InstallOptions> = {}): InstallOptions => ({ mode: 'init', target, agents: ['claude'], apply: true, bootstrap: true, ...o });
const run = (o: InstallOptions) => { const p = planInstall(o); applyPlan(p); return p; };
/** Every file under dir (skipping .git) with its content, for before/after comparison. */
function tree(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const e of readdirSync(dir)) {
    if (e === '.git') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { out[p.slice(base.length) + '/'] = ''; tree(p, base, out); } else out[p.slice(base.length)] = readFileSync(p, 'utf8');
  }
  return out;
}
const settings = (d: string, file = '.claude/settings.json') => JSON.parse(readFileSync(join(d, file), 'utf8')) as { hooks: Record<string, { hooks: { command: string; args?: string[] }[] }[]> };
const commands = (d: string, file?: string) => Object.values(settings(d, file).hooks).flat().flatMap((g) => g.hooks);
const BASH = 'WF_HOOK_RUNTIME=bash\n';

test('the default runtime is Node: the hook code lands in .burhan/hooks/node, the bash hooks are not installed, Claude gets the exec form', () => {
  const d = freshRepo();
  run(opts(d));
  for (const f of ['main.mjs', 'gates.txt', 'install-root.mjs', 'core/turn-audit.mjs', 'adapters/claude/hook.mjs']) assert.ok(existsSync(join(d, '.burhan/hooks/node', f)), f);
  assert.equal(existsSync(join(d, '.burhan/hooks/core')), false);
  assert.equal(existsSync(join(d, '.burhan/hooks/adapters')), false);
  const entries = commands(d);
  assert.equal(entries.length, 5);
  for (const e of entries) { assert.equal(e.command, 'node'); assert.equal(e.args![0], '${CLAUDE_PROJECT_DIR}/.burhan/hooks/node/main.mjs'); }
});

test('the layout is pinned: the entry sits where installRoot finds the project', () => {
  const d = freshRepo();
  run(opts(d, { agents: ['claude', 'codex'] }));
  const entry = join(d, '.burhan/hooks/node/main.mjs');
  assert.ok(existsSync(entry));
  assert.equal(installRoot(entry), d.replace(/\/$/u, ''));
  const launcher = commands(d, '.codex/hooks.json')[0].command;
  assert.ok(launcher.includes("'.burhan','hooks','node','main.mjs'"), 'the Codex launcher looks for exactly that path');
});

test('WF_HOOK_RUNTIME=bash keeps the 0.2 bash hooks and removes the Node directory; switching back and forth is clean and idempotent', () => {
  const d = freshRepo(BASH);
  run(opts(d));
  assert.ok(existsSync(join(d, '.burhan/hooks/core/lib.sh')));
  assert.ok(existsSync(join(d, '.burhan/hooks/adapters/claude/hook.sh')));
  assert.equal(existsSync(join(d, '.burhan/hooks/node')), false);
  assert.ok(commands(d).every((e) => e.command.startsWith('bash ') && e.args === undefined));
  const bashTree = tree(d);
  run(opts(d, { mode: 'upgrade', agents: null }));
  assert.deepEqual(tree(d), bashTree, 'a second bash upgrade changes nothing');

  writeFileSync(join(d, '.burhan/workflow.config'), 'WF_HOOK_RUNTIME=node\n');
  run(opts(d, { mode: 'upgrade', agents: null }));
  assert.equal(existsSync(join(d, '.burhan/hooks/core')), false);
  assert.equal(existsSync(join(d, '.burhan/hooks/adapters')), false);
  assert.ok(existsSync(join(d, '.burhan/hooks/node/main.mjs')));
  const nodeTree = tree(d);
  run(opts(d, { mode: 'upgrade', agents: null }));
  assert.deepEqual(tree(d), nodeTree, 'a second node upgrade changes nothing');

  writeFileSync(join(d, '.burhan/workflow.config'), BASH);
  run(opts(d, { mode: 'upgrade', agents: null }));
  assert.equal(existsSync(join(d, '.burhan/hooks/node')), false);
  assert.ok(existsSync(join(d, '.burhan/hooks/core/lib.sh')));
});

test('an unknown WF_HOOK_RUNTIME is a note and means node', () => {
  const d = freshRepo('WF_HOOK_RUNTIME=perl\n');
  const p = planInstall(opts(d, { apply: false }));
  assert.ok(p.steps.some((s) => /WF_HOOK_RUNTIME/u.test(s.say) && /perl/u.test(s.say)));
  applyPlan(p);
  assert.ok(existsSync(join(d, '.burhan/hooks/node/main.mjs')));
});

test('upgrading a 0.2 bash install: Node commands, no old entries, the user\'s own hooks kept, bash dirs gone, nothing duplicated', () => {
  const d = freshRepo(BASH);
  run(opts(d, { agents: ['claude', 'codex'] }));
  const mine = { type: 'command', command: 'node', args: ['tools/mine.js'] };
  const file = join(d, '.claude/settings.json');
  const cur = settings(d);
  cur.hooks.Stop.unshift({ hooks: [mine] } as never);
  writeFileSync(file, JSON.stringify(cur, null, 2));
  writeFileSync(join(d, '.burhan/workflow.config'), ''); // the default runtime is node
  const plan = planInstall(opts(d, { mode: 'upgrade', agents: null, apply: false }));
  assert.deepEqual([...plan.agents].sort(), ['claude', 'codex'], 'agents are found from the installed adapters');
  assert.ok(plan.steps.some((s) => /trust/iu.test(s.say) && /codex/iu.test(s.say)), 'the Codex re-trust notice is part of the plan');
  applyPlan(plan);
  const after = commands(d);
  assert.equal(after.filter((e) => e.command.includes('hook.sh')).length, 0);
  assert.equal(after.filter((e) => e.command === 'node' && e.args![1] === 'claude').length, 5);
  assert.deepEqual(settings(d).hooks.Stop[0].hooks, [mine], 'the user\'s node hook is untouched and first');
  assert.equal(commands(d, '.codex/hooks.json').filter((e) => e.command.includes('hook.sh')).length, 0);
  assert.equal(commands(d, '.codex/hooks.json').filter((e) => e.command.startsWith('node -e')).length, 5);
  const settled = tree(d);
  run(opts(d, { mode: 'upgrade', agents: null }));
  assert.deepEqual(tree(d), settled, 'a second upgrade changes nothing');
});

test('under the Node runtime the installed agents are found from their hook files', () => {
  const d = freshRepo();
  run(opts(d, { agents: ['codex'] }));
  const plan = planInstall(opts(d, { mode: 'upgrade', agents: null, apply: false }));
  assert.deepEqual(plan.agents, ['codex']);
});

test('the plan lists the Node directory and the removed bash directories as kit files', () => {
  const d = freshRepo(BASH);
  run(opts(d));
  writeFileSync(join(d, '.burhan/workflow.config'), '');
  const plan = planInstall(opts(d, { mode: 'upgrade', agents: null, apply: false }));
  const f = (rel: string) => plan.files.find((x) => x.rel === rel);
  assert.deepEqual(f('.burhan/hooks/node/'), { rel: '.burhan/hooks/node/', existed: false, action: 'create', kind: 'kit' });
  assert.equal(f('.burhan/hooks/core/')?.action, 'remove');
  assert.equal(f('.burhan/hooks/adapters/claude/')?.action, 'remove');
});

test('a runtime switch with a partial --agents list rewrites every installed agent (no dangling hooks)', () => {
  const d = freshRepo(BASH);
  run(opts(d, { agents: ['claude', 'codex'] }));
  writeFileSync(join(d, '.burhan/workflow.config'), 'WF_HOOK_RUNTIME=node\n');
  const plan = planInstall(opts(d, { mode: 'upgrade', agents: ['codex'], apply: false }));
  assert.deepEqual([...plan.agents].sort(), ['claude', 'codex'], 'the bash hooks go away for everyone, so everyone is rewritten');
  assert.ok(plan.steps.some((s) => /claude/u.test(s.say) && /runtime|also|every/iu.test(s.say)), 'the plan says why claude is included');
  applyPlan(plan);
  assert.equal(commands(d).filter((e) => e.command.includes('hook.sh')).length, 0, 'claude no longer points at the removed bash hooks');
  assert.equal(commands(d, '.codex/hooks.json').filter((e) => e.command.includes('hook.sh')).length, 0);
  writeFileSync(join(d, '.burhan/workflow.config'), BASH);
  applyPlan(planInstall(opts(d, { mode: 'upgrade', agents: ['claude'], apply: false })));
  assert.equal(commands(d, '.codex/hooks.json').filter((e) => e.command.startsWith('node -e')).length, 0, 'codex no longer points at the removed Node hooks');
  assert.ok(existsSync(join(d, '.burhan/hooks/adapters/codex/hook.sh')), 'and the bash codex adapter is there for it');
});

test('the project keeps the Node snippets it was installed with, so a later release recognises these entries as ours', () => {
  const d = freshRepo();
  run(opts(d, { agents: ['claude', 'codex'] }));
  for (const f of ['claude', 'codex']) assert.ok(existsSync(join(d, `.burhan/hooks/node/snippets/${f}.snippet.json`)), f);
  // an entry an earlier release wrote and today's kit no longer has
  const old = { type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/.burhan/hooks/node/main.mjs', 'claude', 'hook', 'turn-audit-old'], timeout: 15 };
  const snippetFile = join(d, '.burhan/hooks/node/snippets/claude.snippet.json');
  const snippet = JSON.parse(readFileSync(snippetFile, 'utf8')) as { hooks: Record<string, { hooks: unknown[] }[]> };
  snippet.hooks.Stop[0].hooks.push(old);
  writeFileSync(snippetFile, JSON.stringify(snippet));
  const file = join(d, '.claude/settings.json');
  const cur = settings(d);
  cur.hooks.Stop.push({ hooks: [old] } as never);
  writeFileSync(file, JSON.stringify(cur, null, 2));
  run(opts(d, { mode: 'upgrade', agents: null }));
  assert.equal(commands(d).filter((e) => e.args?.[3] === 'turn-audit-old').length, 0, 'the earlier release\'s entry was replaced, not left beside the new one');
  assert.equal(commands(d).filter((e) => e.args?.[3] === 'turn-audit').length, 1);
});
