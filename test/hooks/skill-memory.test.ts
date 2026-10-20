import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers.js';
import { projectKey } from '../../src/lib/evidence.js';
import { run } from '../../src/hooks/main.mjs';

// The code SKILL GATE counts TDD / debugging from an earlier turn of the same item in the same session
// (alerts-and-texts SU2, AC-04 – AC-06). No config file: the WF_* values come from the environment.
const GATE = 'SKILL GATE (code)';
const TDD = 'superpowers:test-driven-development';

function setup(now: string): { project: string; env: NodeJS.ProcessEnv; root: string } {
  const project = tmpDir('burhan-skill-memory-project-');
  const root = tmpDir('burhan-skill-memory-evidence-');
  mkdirSync(join(project, '.burhan/local'), { recursive: true });
  writeFileSync(join(project, '.burhan/local/PROGRESS.md'), `## Now\n${now}`);
  return { project, root, env: { ...process.env, WF_EVIDENCE_DIR: root, WF_SKILLS: 'superpowers', WF_CODE_REGEX: '\\.src$', WF_EVIDENCE_LEDGER: 'on' } };
}
const TWO = '### alpha\n- **Route:** change / bounded\n### beta\n- **Route:** change / bounded\n';
const ONE = '### alpha\n- **Route:** change / bounded\n';

let n = 0;
/** One Stop: `skills` used and `code` written this turn; `link` runs `burhan use <slug>` in it. */
async function stop(s: ReturnType<typeof setup>, session: string, o: { skills?: string[]; code?: boolean; link?: string; reentrant?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  const turn = {
    files_created: [], files_edited: o.code ? [join(s.project, 'a.src')] : [],
    shell_commands: o.link ? [`burhan use ${o.link}`] : [], skills_used: o.skills ?? [], assistant_text: '',
    steps: o.code ? [{ seq: 1, kind: 'edit', file: join(s.project, 'a.src') }] : [],
  };
  const event = { event: 'turn_end', agent: 'claude', project_dir: s.project, session, turn_id: `synthetic-T${++n}`, turn_scope: 'whole', turn, reentrant: o.reentrant ?? false };
  const r = await run(['core', 'turn-audit'], JSON.stringify(event), o.env ?? s.env);
  assert.equal(r.debug, '');
  return r.stdout;
}

test('a skill from an earlier turn of the same item in the same session counts for the code gate', async () => {
  const s = setup(TWO);
  await stop(s, 'S1', { link: 'alpha', skills: [TDD] });
  assert.doesNotMatch(await stop(s, 'S1', { code: true }), new RegExp(GATE.replace(/[()]/g, '\\$&')));
});

test('a skill used only in a continuation after a hook block (reentrant Stop) is remembered too', async () => {
  const s = setup(TWO);
  await stop(s, 'S1', { link: 'alpha' });
  await stop(s, 'S1', { skills: ['superpowers:systematic-debugging'], reentrant: true });
  assert.doesNotMatch(await stop(s, 'S1', { code: true }), /SKILL GATE \(code\)/);
});

test('no leak: another item, another session, or no resolved item → this turn only (the gate fires)', async () => {
  const items = setup(TWO);
  await stop(items, 'S1', { link: 'alpha', skills: [TDD] });
  await stop(items, 'S1', { link: 'beta' });
  assert.match(await stop(items, 'S1', { code: true }), /SKILL GATE \(code\)/, 'another item in the same session');

  const sessions = setup(TWO);
  await stop(sessions, 'S1', { link: 'alpha', skills: [TDD] });
  await stop(sessions, 'S2', { link: 'alpha' });
  assert.match(await stop(sessions, 'S2', { code: true }), /SKILL GATE \(code\)/, 'the same item in another session');

  const unlinked = setup(TWO);
  await stop(unlinked, 'S1', { skills: [TDD] });
  assert.match(await stop(unlinked, 'S1', { code: true }), /SKILL GATE \(code\)/, 'several items and no link: no item resolves');
});

test('no leak to a slug sharing a prefix, and only the two exact skill names are remembered', async () => {
  const prefix = setup('### alpha\n- x\n### alpha-2\n- x\n');
  await stop(prefix, 'S1', { link: 'alpha', skills: [TDD] });
  await stop(prefix, 'S1', { link: 'alpha-2' });
  assert.match(await stop(prefix, 'S1', { code: true }), /SKILL GATE \(code\)/, 'alpha-2 does not see alpha');
  const lookalike = setup(ONE);
  await stop(lookalike, 'S1', { skills: ['superpowers:test-driven-development-x', 'superpowers:brainstorming'] });
  assert.match(await stop(lookalike, 'S1', { code: true }), /SKILL GATE \(code\)/, 'a look-alike skill is not remembered');
});

test('one item in Now resolves without a link, so its memory counts; WF_EVIDENCE_LEDGER=off changes nothing', async () => {
  const s = setup(ONE);
  await stop(s, 'S1', { skills: [TDD] });
  assert.doesNotMatch(await stop(s, 'S1', { code: true }), /SKILL GATE \(code\)/);
  const off = setup(ONE);
  const env = { ...off.env, WF_EVIDENCE_LEDGER: 'off' };
  await stop(off, 'S1', { skills: [TDD], env });
  assert.doesNotMatch(await stop(off, 'S1', { code: true, env }), /SKILL GATE \(code\)/);
});

test('the gate itself is unchanged: no skill at all fires the same message; an unwritable store fails open', async () => {
  const s = setup(ONE);
  assert.match(await stop(s, 'S1', { code: true }), /⚠ SKILL GATE \(code\): code was written this turn without superpowers:test-driven-development or superpowers:systematic-debugging\. Confirm the skill was used, or invoke it before continuing\./);
  if (process.platform === 'win32' || process.getuid?.() === 0) return;
  const locked = setup(ONE);
  const dir = join(locked.root, projectKey(locked.project));
  mkdirSync(dir, { recursive: true });
  chmodSync(dir, 0o500);
  try {
    await stop(locked, 'S1', { skills: [TDD] });
    assert.match(await stop(locked, 'S1', { code: true }), /SKILL GATE \(code\)/, 'nothing remembered → fires as today');
  } finally { chmodSync(dir, 0o700); }
});

test('only the code gate reads the memory: a story created later without brainstorming still fires', async () => {
  const s = setup(ONE);
  await stop(s, 'S1', { skills: ['superpowers:brainstorming', TDD] });
  const story = join(s.project, '.burhan/work/alpha/alpha-story.md');
  mkdirSync(join(s.project, '.burhan/work/alpha'), { recursive: true });
  writeFileSync(story, '# s\n');
  const event = { event: 'turn_end', agent: 'claude', project_dir: s.project, session: 'S1', turn_id: 'synthetic-story', turn_scope: 'whole',
    turn: { files_created: [story], files_edited: [], shell_commands: [], skills_used: [], assistant_text: '', steps: [{ seq: 1, kind: 'edit', file: story }] }, reentrant: false };
  const r = await run(['core', 'turn-audit'], JSON.stringify(event), { ...s.env, WF_DOCS_DIR: '.burhan/work' });
  assert.match(r.stdout, /SKILL GATE \(story\)/);
});
