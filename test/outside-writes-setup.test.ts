import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCli } from '../src/main.js';
import { runWizard } from '../src/lib/setup/wizard.js';
import { scriptedPrompter } from '../src/lib/setup/prompter.js';
import { capture, notOnWindows, tmpDir } from './helpers.js';

const skip = notOnWindows('symlinks need privileges on Windows');
const home = tmpDir('burhan-owgs-home-');

// outside-writes-guard SU2: every writer refuses to write through a link that leaves the project, before its first write, unless allowed.
interface Scene { project: string; away: string; answers: string }
const fresh = (): Scene => {
  const project = tmpDir('burhan-owgs-p-'); const away = tmpDir('burhan-owgs-away-');
  spawnSync('git', ['init', '-q'], { cwd: project });
  const answers = join(project, '..', `answers-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(answers, JSON.stringify({ agents: ['claude'], mode: 'step', docs: { kind: 'private' }, lang: 'en' }));
  return { project, away, answers };
};
// A content hash of a folder tree, links not followed (a link counts by its text).
function snap(dir: string, base = dir, out: string[] = []): string {
  for (const e of readdirSync(dir).sort()) {
    if (e === '.git') continue;
    const p = join(dir, e); const st = lstatSync(p);
    if (st.isSymbolicLink()) out.push(`${p.slice(base.length)} -> ${readlinkSync(p)}`);
    else if (st.isDirectory()) { out.push(`${p.slice(base.length)}/`); snap(p, base, out); } else out.push(`${p.slice(base.length)} ${createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 12)}`);
  }
  return createHash('sha256').update(out.join('\n')).digest('hex');
}
const LINKS = ['claude-md', 'commands-folder', 'settings'] as const;
type Link = typeof LINKS[number];
/** Makes the link: `outside` is where it leads (a file or a folder away from the project). */
function link(s: Scene, kind: Link, claudeText = 'mine\n'): string {
  if (kind === 'claude-md') { writeFileSync(join(s.away, 'CLAUDE.md'), claudeText); symlinkSync(join(s.away, 'CLAUDE.md'), join(s.project, 'CLAUDE.md')); return join(s.away, 'CLAUDE.md'); }
  if (kind === 'commands-folder') { mkdirSync(join(s.project, '.claude'), { recursive: true }); symlinkSync(s.away, join(s.project, '.claude/commands')); return s.away; }
  mkdirSync(join(s.project, '.claude'), { recursive: true }); writeFileSync(join(s.away, 'settings.json'), '{}\n'); symlinkSync(join(s.away, 'settings.json'), join(s.project, '.claude/settings.json')); return join(s.away, 'settings.json');
}
type Writer = 'init' | 'upgrade' | 'answers' | 'set';
async function runWriter(w: Writer, s: Scene, flags: string[] = []): Promise<{ code: number; text: string }> {
  const c = capture(s.project);
  const argv = w === 'init' ? ['init', s.project, '--agents', 'claude', '--apply']
    : w === 'upgrade' ? ['upgrade', s.project, '--apply']
      : w === 'answers' ? ['setup', s.project, '--answers', s.answers, '--apply']
        : ['setup', s.project, '--set', 'check=none'];
  const code = await runCli([...argv, ...flags], c.io);
  return { code, text: c.o.out + c.o.err };
}
/** upgrade and set need burhan installed first: install cleanly, then add the link. */
async function prepared(w: Writer, kind: Link): Promise<{ s: Scene; target: string }> {
  const s = fresh();
  let claudeText = 'mine\n'; // upgrade and set only touch a CLAUDE.md that already holds the burhan block: the outside file keeps the installed one
  if (w === 'upgrade' || w === 'set') {
    assert.equal((await runWriter('init', s)).code, 0);
    if (kind === 'claude-md') { claudeText = readFileSync(join(s.project, 'CLAUDE.md'), 'utf8'); rmSync(join(s.project, 'CLAUDE.md'), { force: true }); }
    if (kind === 'commands-folder') rmSync(join(s.project, '.claude/commands'), { recursive: true, force: true });
    if (kind === 'settings') rmSync(join(s.project, '.claude/settings.json'), { force: true });
  }
  return { s, target: link(s, kind, claudeText) };
}

for (const w of ['init', 'upgrade', 'answers', 'set'] as const) for (const kind of LINKS) {
  test(`${w} with an outside ${kind} link: refused before any write, nothing changed`, { skip }, async () => {
    const { s, target } = await prepared(w, kind);
    const before = snap(s.project); const outsideBefore = snap(s.away);
    const r = await runWriter(w, s);
    assert.notEqual(r.code, 0, r.text);
    assert.match(r.text, /outside the project/u);
    assert.equal(snap(s.project), before, 'the project changed');
    assert.equal(snap(s.away), outsideBefore, `the outside side (${target}) changed`);
  });

  test(`${w} with an outside ${kind} link: --allow-outside-links lets it write, and so does the old name --allow-outside-settings`, { skip }, async () => {
    for (const flag of ['--allow-outside-links', '--allow-outside-settings']) {
      const { s } = await prepared(w, kind);
      const outsideBefore = snap(s.away);
      const r = await runWriter(w, s, [flag]);
      assert.equal(r.code, 0, `${flag}: ${r.text}`);
      // upgrade/set re-write what is already there: an outside CLAUDE.md that holds the current block comes out identical
      if (w !== 'set' && !(w === 'upgrade' && kind === 'claude-md')) assert.notEqual(snap(s.away), outsideBefore, `${flag}: nothing was written outside`);
    }
  });
}

for (const w of ['init', 'answers'] as const) {
  test(`${w}: an inside link (CLAUDE.md → AGENTS.md in the project) needs no flag`, { skip }, async () => {
    const s = fresh();
    writeFileSync(join(s.project, 'AGENTS.md'), 'shared\n');
    symlinkSync(join(s.project, 'AGENTS.md'), join(s.project, 'CLAUDE.md'));
    const r = await runWriter(w, s);
    assert.equal(r.code, 0, r.text);
  });
}

test('setup --set refuses before it writes the config (an outside settings link, burhan installed)', { skip }, async () => {
  const { s } = await prepared('set', 'settings');
  const cfgBefore = readFileSync(join(s.project, '.burhan/workflow.config'), 'utf8');
  const r = await runWriter('set', s);
  assert.notEqual(r.code, 0, r.text);
  assert.equal(readFileSync(join(s.project, '.burhan/workflow.config'), 'utf8'), cfgBefore);
});

test('the wizard refuses at the apply step without the flag, and writes with it', { skip }, async () => {
  const s = fresh(); link(s, 'claude-md');
  const before = snap(s.project); const outsideBefore = snap(s.away);
  await assert.rejects(runWizard(s.project, capture(s.project).io, scriptedPrompter(['use', 'apply']), 'en', home), /outside the project/u);
  assert.equal(snap(s.project), before); assert.equal(snap(s.away), outsideBefore);
  const t = fresh(); link(t, 'claude-md');
  assert.equal(await runWizard(t.project, capture(t.project).io, scriptedPrompter(['use', 'apply', 'no']), 'en', home, true), 0);
});

// review C-1: the verify skill appears (check set) or is removed (check none) only AFTER the config is saved, so the plan made before the save
// does not list it; a link at the skill's folder must still be refused before the config is written.
for (const where of ['.claude/skills/burhan-verify', '.claude/skills'] as const) for (const check of ['true', 'none'] as const) {
  test(`setup --set check=${check} with an outside link at ${where}: refused, config untouched, nothing written outside`, { skip }, async () => {
    const s = fresh();
    assert.equal((await runWriter('init', s)).code, 0);
    mkdirSync(join(s.project, '.claude/skills'), { recursive: true });
    rmSync(join(s.project, where), { recursive: true, force: true });
    symlinkSync(s.away, join(s.project, where));
    // with check=none the skill is only removed, and only when it is there: put one behind the link
    if (check === 'none') { mkdirSync(join(s.away, 'burhan-verify'), { recursive: true }); writeFileSync(join(s.away, where.endsWith('burhan-verify') ? 'SKILL.md' : 'burhan-verify/SKILL.md'), 'x\n'); }
    const cfgBefore = readFileSync(join(s.project, '.burhan/workflow.config'), 'utf8');
    const outsideBefore = snap(s.away);
    const c = capture(s.project);
    const code = await runCli(['setup', s.project, '--set', `check=${check}`, '--force'], c.io);
    assert.notEqual(code, 0, c.o.out + c.o.err);
    assert.match(c.o.out + c.o.err, /outside the project/u);
    assert.equal(readFileSync(join(s.project, '.burhan/workflow.config'), 'utf8'), cfgBefore, 'the config was saved');
    assert.equal(snap(s.away), outsideBefore, 'something was written outside');
  });
}

test('setup --set with the allow flag saves the config and writes the verify skill through the link', { skip }, async () => {
  const s = fresh();
  assert.equal((await runWriter('init', s)).code, 0);
  mkdirSync(join(s.project, '.claude/skills'), { recursive: true });
  symlinkSync(s.away, join(s.project, '.claude/skills/burhan-verify'));
  const c = capture(s.project);
  assert.equal(await runCli(['setup', s.project, '--set', 'check=true', '--force', '--allow-outside-links'], c.io), 0, c.o.out + c.o.err);
  assert.match(readFileSync(join(s.project, '.burhan/workflow.config'), 'utf8'), /WF_CHECK_CMD='?true/u);
  assert.match(readFileSync(join(s.away, 'SKILL.md'), 'utf8'), /true/u);
});

test('setup --set check=none with a link at the skills folder and no skill behind it writes nothing outside, so it is not refused', { skip }, async () => {
  const s = fresh();
  assert.equal((await runWriter('init', s)).code, 0);
  mkdirSync(join(s.project, '.claude/skills'), { recursive: true });
  rmSync(join(s.project, '.claude/skills'), { recursive: true, force: true });
  symlinkSync(s.away, join(s.project, '.claude/skills'));
  const outsideBefore = snap(s.away);
  const c = capture(s.project);
  assert.equal(await runCli(['setup', s.project, '--set', 'check=none'], c.io), 0, c.o.out + c.o.err);
  assert.equal(snap(s.away), outsideBefore);
});

// QC round 1, finding 1 (AC-04): with the flag, `setup --set` names each file it writes outside the project.
test('setup --set with the allow flag prints one OUTSIDE line for each file it writes outside', { skip }, async () => {
  const { s, target } = await prepared('set', 'settings');
  const c = capture(s.project);
  assert.equal(await runCli(['setup', s.project, '--set', 'check=none', '--allow-outside-links'], c.io), 0, c.o.out + c.o.err);
  assert.match(c.o.out, /OUTSIDE: \.claude\/settings\.json → /u);
  assert.ok(c.o.out.includes(realpathSync(target)), c.o.out);
  assert.match(c.o.out, /written because of --allow-outside-links/u);
});

test('setup --set with nothing outside prints no OUTSIDE line', { skip }, async () => {
  const s = fresh();
  assert.equal((await runWriter('init', s)).code, 0);
  const c = capture(s.project);
  assert.equal(await runCli(['setup', s.project, '--set', 'check=none'], c.io), 0);
  assert.doesNotMatch(c.o.out, /OUTSIDE:/u);
});
