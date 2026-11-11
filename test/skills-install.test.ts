import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { skillIds } from '../src/hooks/adapters/codex/patch.mjs';
import { PHASES, skillName } from '../src/hooks/core/skill-table.mjs';
import { isManagedCommand } from '../src/lib/commands.js';
import { applyPlan, planInstall, type InstallOptions } from '../src/lib/install.js';
import { uninstall } from '../src/lib/uninstall.js';
import { runChecks } from '../src/lib/doctor.js';
import { capture, tmpDir } from './helpers.js';

// Tests run from .test-build/test, so the repository root is two levels up.
const root = fileURLToPath(new URL('../../', import.meta.url));
const NAMES = PHASES.map(skillName);
const kitText = (n: string): string => readFileSync(join(root, 'kit/skills/shared', n, 'SKILL.md'), 'utf8');
const repo = (config?: string): string => {
  const d = tmpDir('burhan-skills-install-');
  spawnSync('git', ['init', '-q'], { cwd: d });
  if (config !== undefined) { mkdirSync(join(d, '.burhan'), { recursive: true }); writeFileSync(join(d, '.burhan/workflow.config'), config); }
  return d;
};
const opts = (target: string, agents: InstallOptions['agents'], o: Partial<InstallOptions> = {}): InstallOptions => ({ mode: 'init', target, agents, apply: true, bootstrap: false, ...o });
const run = (o: InstallOptions) => { const p = planInstall(o); applyPlan(p); return p; };

test('init writes the six skills in .burhan/skills and, for Claude Code, as managed project skills', () => {
  const d = repo();
  run(opts(d, ['claude']));
  for (const n of NAMES) {
    assert.equal(readFileSync(join(d, '.burhan/skills', n, 'SKILL.md'), 'utf8'), kitText(n), `.burhan/skills/${n}`);
    const managed = readFileSync(join(d, '.claude/skills', n, 'SKILL.md'), 'utf8');
    assert.ok(isManagedCommand(managed), `${n}: carries the managed mark`);
    assert.ok(managed.startsWith(`---\nname: ${n}\n`), `${n}: front matter first`);
    assert.ok(managed.includes('# ' + n), `${n}: the text`);
  }
});

test('a Codex-only project gets .burhan/skills and no Claude folder', () => {
  const d = repo();
  run(opts(d, ['codex']));
  for (const n of NAMES) assert.ok(existsSync(join(d, '.burhan/skills', n, 'SKILL.md')), n);
  assert.equal(existsSync(join(d, '.claude/skills')), false);
});

test('Codex reads the same file: a SKILL.md read in the shell is the skill id', () => {
  assert.deepEqual(skillIds(['cat .burhan/skills/burhan-story/SKILL.md']), ['burhan-story']);
  assert.deepEqual(skillIds(['sed -n 1,40p .burhan/skills/burhan-done/SKILL.md']), ['burhan-done']);
});

test('a second upgrade changes nothing, and an upgrade refreshes a managed skill', () => {
  const d = repo();
  run(opts(d, ['claude']));
  const before = NAMES.map((n) => readFileSync(join(d, '.claude/skills', n, 'SKILL.md'), 'utf8'));
  run(opts(d, ['claude'], { mode: 'upgrade' }));
  assert.deepEqual(NAMES.map((n) => readFileSync(join(d, '.claude/skills', n, 'SKILL.md'), 'utf8')), before);
  writeFileSync(join(d, '.claude/skills/burhan-story/SKILL.md'), before[0]!.replace('# burhan-story', '# burhan-story (old)'));
  run(opts(d, ['claude'], { mode: 'upgrade' }));
  assert.equal(readFileSync(join(d, '.claude/skills/burhan-story/SKILL.md'), 'utf8'), before[0]);
});

test('a skill of the person\'s with a burhan name is never overwritten, and the install says so', () => {
  const d = repo();
  mkdirSync(join(d, '.claude/skills/burhan-plan'), { recursive: true });
  writeFileSync(join(d, '.claude/skills/burhan-plan/SKILL.md'), '---\nname: burhan-plan\ndescription: mine\n---\nmy own plan skill\n');
  const p = run(opts(d, ['claude']));
  assert.equal(readFileSync(join(d, '.claude/skills/burhan-plan/SKILL.md'), 'utf8'), '---\nname: burhan-plan\ndescription: mine\n---\nmy own plan skill\n');
  assert.ok(p.steps.some((s) => s.say.includes('skipped .claude/skills/burhan-plan/SKILL.md')), p.steps.map((s) => s.say).join('\n'));
  assert.ok(existsSync(join(d, '.claude/skills/burhan-story/SKILL.md')), 'the others are written');
});

test('uninstall removes only what burhan wrote', () => {
  const d = repo();
  mkdirSync(join(d, '.claude/skills/burhan-plan'), { recursive: true });
  writeFileSync(join(d, '.claude/skills/burhan-plan/SKILL.md'), '---\nname: burhan-plan\ndescription: mine\n---\nmine\n');
  mkdirSync(join(d, '.claude/skills/my-skill'), { recursive: true });
  writeFileSync(join(d, '.claude/skills/my-skill/SKILL.md'), '---\nname: my-skill\ndescription: mine\n---\nmine\n');
  run(opts(d, ['claude']));
  const c = capture(d);
  assert.equal(uninstall({ target: d, apply: true, all: false }, c.io), 0, c.o.err);
  assert.equal(existsSync(join(d, '.burhan/skills')), false, '.burhan/skills is removed');
  for (const n of NAMES.filter((x) => x !== 'burhan-plan')) assert.equal(existsSync(join(d, '.claude/skills', n, 'SKILL.md')), false, `${n}: the managed copy is removed`);
  assert.ok(existsSync(join(d, '.claude/skills/burhan-plan/SKILL.md')), "the person's burhan-plan stays");
  assert.ok(existsSync(join(d, '.claude/skills/my-skill/SKILL.md')), "the person's other skill stays");
});

test('upgrade names a leftover WF_SKILLS in the team config and changes nothing else about it', () => {
  const d = repo("WF_SKILLS='superpowers'\n");
  run(opts(d, ['claude']));
  const p = planInstall(opts(d, ['claude'], { mode: 'upgrade' }));
  assert.ok(p.steps.some((s) => /^NOTE: WF_SKILLS "superpowers" is no longer read/.test(s.say) && s.say.includes('Delete the line')), p.steps.map((s) => s.say).join('\n'));
  applyPlan(p);
  assert.equal(readFileSync(join(d, '.burhan/workflow.config'), 'utf8'), "WF_SKILLS='superpowers'\n");
});

test('doctor: a missing .burhan/skills/ is a warning that names the upgrade, not a failure', () => {
  const d = repo();
  run(opts(d, ['claude']));
  const kit = { isFile: () => true, isRunnable: () => true, env: {}, platform: process.platform };
  const probe = { nodeVersion: () => '24.13.0', claudeVersion: () => '2.1.296', home: () => tmpDir('burhan-skills-home-'), kitProbe: () => kit };
  rmSync(join(d, '.burhan/skills'), { recursive: true });
  const found = runChecks(d, probe).filter((c) => c.text.includes('.burhan/skills/'));
  assert.equal(found.length, 1);
  assert.equal(found[0]!.status, 'warn');
  assert.match(found[0]!.text, /run burhan upgrade --apply/);
});
