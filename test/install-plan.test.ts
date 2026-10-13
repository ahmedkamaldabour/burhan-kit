import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { install, planInstall, applyPlan } from '../src/lib/install.js';
import { capture } from './helpers.js';

function freshRepo(): string {
  const d = mkdtempSync(join(tmpdir(), 'burhan-plan-'));
  spawnSync('git', ['init', '-q'], { cwd: d });
  return d;
}

/** Every path under dir (skipping .git) mapped to its content, for before/after comparison. */
function tree(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const e of readdirSync(dir)) {
    if (e === '.git') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { out[p.slice(base.length) + '/'] = ''; tree(p, base, out); }
    else out[p.slice(base.length)] = readFileSync(p, 'utf8');
  }
  return out;
}

const opts = (target: string, apply: boolean) => ({ mode: 'init' as const, target, agents: ['claude' as const], apply, bootstrap: true });

test('planInstall lists the files it would write and writes nothing', () => {
  const t = freshRepo();
  const before = tree(t);
  const p = planInstall(opts(t, false));
  assert.deepEqual(tree(t), before);
  const f = (rel: string) => p.files.find((x) => x.rel === rel);
  assert.deepEqual(f('CLAUDE.md'), { rel: 'CLAUDE.md', existed: false, action: 'create', kind: 'bootstrap' });
  assert.deepEqual(f('.claude/settings.json'), { rel: '.claude/settings.json', existed: false, action: 'create', kind: 'hooks' });
  assert.equal(f('.workflow/hooks/core/')?.kind, 'kit');
  assert.equal(f('.workflow/bindings.md')?.kind, 'config');
  assert.equal(f('.workflow/.gitignore')?.kind, 'gitignore');
  assert.ok(p.agents.includes('claude'));
  assert.ok(p.steps.length > 0);
});

test('an existing CLAUDE.md is reported as existed', () => {
  const t = freshRepo();
  writeFileSync(join(t, 'CLAUDE.md'), '# mine\n');
  const p = planInstall(opts(t, false));
  assert.equal(p.files.find((x) => x.rel === 'CLAUDE.md')?.existed, true);
});

test('applyPlan(planInstall) produces the same tree as install --apply', () => {
  const a = freshRepo(), b = freshRepo();
  for (const d of [a, b]) mkdirSync(join(d, 'src'));
  assert.equal(install(opts(a, true), capture(a).io), 0);
  applyPlan(planInstall(opts(b, true)));
  const ta = tree(a), tb = tree(b);
  assert.deepEqual(Object.keys(tb).sort(), Object.keys(ta).sort());
  assert.deepEqual(tb, ta);
});

test('keepProjectFiles: the plan never creates workflow.config or bindings.md (setup writes them itself)', () => {
  const t = mkdtempSync(join(tmpdir(), 'burhan-keep-'));
  spawnSync('git', ['init', '-q', t]);
  const p = planInstall({ mode: 'init', target: t, agents: ['claude'], apply: true, bootstrap: true, keepProjectFiles: true });
  applyPlan(p);
  assert.equal(existsSync(join(t, '.workflow/workflow.config')), false);
  assert.equal(existsSync(join(t, '.workflow/bindings.md')), false);
  assert.equal(existsSync(join(t, '.workflow/WORKFLOW.md')), true, 'the rest of the install still ran');
  assert.ok(!p.files.some((f) => f.rel === '.workflow/workflow.config' || f.rel === '.workflow/bindings.md'));
});
