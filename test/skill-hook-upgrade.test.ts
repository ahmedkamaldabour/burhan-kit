import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCli } from '../src/main.js';
import { applyPlan, planInstall, type InstallOptions } from '../src/lib/install.js';
import { capture, tmpDir } from './helpers.js';

type Group = { matcher?: string; hooks: { command: string; args?: string[]; timeout?: number }[] };
const file = (d: string) => join(d, '.claude/settings.json');
const read = (d: string) => JSON.parse(readFileSync(file(d), 'utf8')) as { hooks: Record<string, Group[]> };
const opts = (target: string, o: Partial<InstallOptions> = {}): InstallOptions => ({ mode: 'init', target, agents: ['claude'], apply: true, bootstrap: true, ...o });
const run = (o: InstallOptions) => applyPlan(planInstall(o));
const ours = (d: string) => Object.values(read(d).hooks).flat().flatMap((g) => g.hooks).filter((h) => (h.args ?? []).includes('pre-edit-skill'));
const USER: Group = { matcher: 'Write', hooks: [{ command: 'node', args: ['tools/my-write-hook.js'] }] };

function repo(): string {
  const d = tmpDir('burhan-skill-hook-');
  spawnSync('git', ['init', '-q'], { cwd: d });
  return d;
}

/** What 0.4.1 installed: the same file without the pre-write entry, plus a hook of the person's own on the same event. */
function as041(d: string): void {
  const s = read(d);
  s.hooks.PreToolUse = s.hooks.PreToolUse.filter((g) => !g.hooks.some((h) => (h.args ?? []).includes('pre-edit-skill')));
  s.hooks.PreToolUse.push(USER);
  writeFileSync(file(d), JSON.stringify(s, null, 2) + '\n');
}

test('init wires the pre-write check once, on the write tools, with a short timeout', () => {
  const d = repo();
  run(opts(d));
  const groups = read(d).hooks.PreToolUse.filter((g) => g.hooks.some((h) => (h.args ?? []).includes('pre-edit-skill')));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].matcher, 'Write|Edit|MultiEdit|NotebookEdit');
  assert.ok((groups[0].hooks[0].timeout ?? 99) <= 15);
});

test('upgrading a 0.4.1 install adds the pre-write check, keeps the person\'s own hook, and a second upgrade changes nothing', () => {
  const d = repo();
  run(opts(d));
  as041(d);
  assert.equal(ours(d).length, 0);
  run(opts(d, { mode: 'upgrade', agents: null }));
  assert.equal(ours(d).length, 1);
  assert.ok(read(d).hooks.PreToolUse.some((g) => g.hooks.some((h) => (h.args ?? [])[0] === 'tools/my-write-hook.js')), 'the person\'s hook stays');
  const once = readFileSync(file(d), 'utf8');
  run(opts(d, { mode: 'upgrade', agents: null }));
  assert.equal(readFileSync(file(d), 'utf8'), once);
});

test('uninstall removes the pre-write check and keeps the person\'s own hook', async () => {
  const d = repo();
  run(opts(d));
  as041(d);
  run(opts(d, { mode: 'upgrade', agents: null }));
  const c = capture(d);
  assert.equal(await runCli(['uninstall', d, '--apply'], c.io), 0);
  assert.equal(ours(d).length, 0);
  assert.ok(read(d).hooks.PreToolUse.some((g) => g.hooks.some((h) => (h.args ?? [])[0] === 'tools/my-write-hook.js')));
});
