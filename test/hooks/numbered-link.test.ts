import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers.js';
import { run } from '../../src/hooks/main.mjs';

// `burhan use 1` and `burhan use foo` link the session to the block `### 001-foo`: the turn-end hook turns what was typed into the heading (item numbered-item-ids).
const GATE = /SKILL GATE \(code\)/;
const TDD = 'superpowers:test-driven-development';

function setup(now: string): { project: string; env: NodeJS.ProcessEnv } {
  const project = tmpDir('burhan-numbered-link-project-');
  const root = tmpDir('burhan-numbered-link-evidence-');
  mkdirSync(join(project, '.burhan/local'), { recursive: true });
  writeFileSync(join(project, '.burhan/local/PROGRESS.md'), `## Now\n${now}`);
  return { project, env: { ...process.env, WF_EVIDENCE_DIR: root, WF_SKILLS: 'superpowers', WF_CODE_REGEX: '\\.src$', WF_EVIDENCE_LEDGER: 'on' } };
}
let n = 0;
async function stop(s: ReturnType<typeof setup>, o: { skills?: string[]; code?: boolean; link?: string } = {}): Promise<string> {
  const turn = {
    files_created: [], files_edited: o.code ? [join(s.project, 'a.src')] : [],
    shell_commands: o.link ? [`burhan use ${o.link}`] : [], skills_used: o.skills ?? [], assistant_text: '',
    steps: o.code ? [{ seq: 1, kind: 'edit', file: join(s.project, 'a.src') }] : [],
  };
  const event = { event: 'turn_end', agent: 'claude', project_dir: s.project, session: 'S1', turn_id: `numbered-T${++n}`, turn_scope: 'whole', turn, reentrant: false };
  const r = await run(['core', 'turn-audit'], JSON.stringify(event), s.env);
  assert.equal(r.debug, '');
  return r.stdout;
}
const TWO = '### 001-alpha\n- **Route:** change / bounded\n### 002-beta\n- **Route:** change / bounded\n';

test('use with a number links the block, so a skill used under it counts for the code gate of the same item', async () => {
  const s = setup(TWO);
  await stop(s, { link: '1', skills: [TDD] });
  assert.doesNotMatch(await stop(s, { code: true }), GATE);
});

test('use with the plain slug of a numbered item links the same block', async () => {
  const s = setup(TWO);
  await stop(s, { link: 'alpha', skills: [TDD] });
  assert.doesNotMatch(await stop(s, { code: true }), GATE);
});

test('use with a number that names two blocks links nothing: no guess', async () => {
  const s = setup('### 013-a\n- **Route:** change / bounded\n### 013-b\n- **Route:** change / bounded\n');
  await stop(s, { link: '13', skills: [TDD] });
  assert.match(await stop(s, { code: true }), GATE);
});

test('use with a number that names another block does not lend it the skill', async () => {
  const s = setup(TWO);
  await stop(s, { link: '1', skills: [TDD] });
  await stop(s, { link: '2' });
  assert.match(await stop(s, { code: true }), GATE);
});

// Review finding 1 of numbered-item-ids (sub-unit 2): `burhan use x` (CLI) and the hook agree when an old `x` and `012-x` both exist.
test('review finding 1: burhan use x (CLI) and the hook link the same block x when an old x and 012-x both exist', async () => {
  const { useItem } = await import('../../src/lib/use.js');
  const { capture } = await import('../helpers.js');
  const s = setup('### x\n- **Route:** change / bounded\n### 012-x\n- **Route:** change / bounded\n');
  const c = capture(s.project);
  assert.equal(useItem(s.project, 'x', c.io), 0, c.o.err);
  assert.match(c.o.out, /linked at the end of this turn/);
  await stop(s, { link: 'x', skills: [TDD] });
  assert.doesNotMatch(await stop(s, { code: true }), GATE);
});
