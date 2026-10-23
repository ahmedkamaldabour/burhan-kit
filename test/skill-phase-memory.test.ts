import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from './helpers.js';
import { run } from '../src/hooks/main.mjs';

// QC finding on AC-02: a phase skill used in an EARLIER turn of the same item in the same session counts for the pre-write check.
const BRAIN = 'superpowers:brainstorming';
function setup(): { project: string; env: NodeJS.ProcessEnv } {
  const project = tmpDir('burhan-phase-memory-project-');
  const root = tmpDir('burhan-phase-memory-store-');
  mkdirSync(join(project, '.burhan/local'), { recursive: true });
  writeFileSync(join(project, '.burhan/local/PROGRESS.md'), '## Now\n### alpha\n- **Route:** feature / bounded\n### beta\n- **Route:** feature / bounded\n');
  return { project, env: { ...process.env, WF_EVIDENCE_DIR: root, WF_SKILLS: 'superpowers', WF_EVIDENCE_LEDGER: 'on' } };
}
let n = 0;
async function stop(s: ReturnType<typeof setup>, session: string, o: { skills?: string[]; link?: string } = {}): Promise<void> {
  const turn = { files_created: [], files_edited: [], shell_commands: o.link ? [`burhan use ${o.link}`] : [], skills_used: o.skills ?? [], assistant_text: '', steps: [] };
  const r = await run(['core', 'turn-audit'], JSON.stringify({ event: 'turn_end', agent: 'claude', project_dir: s.project, session, turn_id: `T${++n}`, turn_scope: 'whole', turn, reentrant: false }), s.env);
  assert.equal(r.debug, '');
}
async function writeStory(s: ReturnType<typeof setup>, session: string, item: string, skills: string[] = []): Promise<string> {
  const file = join(s.project, `.burhan/work/${item}/${item}-story.md`);
  const r = await run(['core', 'pre-edit-skill'], JSON.stringify({ event: 'pre_edit', file, project_dir: s.project, session, turn: { skills_used: skills, assistant_text: '' } }), s.env);
  return r.stdout;
}

test('brainstorming used in an earlier turn of the same item and session -> no line before the story', async () => {
  const s = setup();
  await stop(s, 'S1', { link: 'alpha', skills: [BRAIN] });
  assert.equal(await writeStory(s, 'S1', 'alpha'), '');
});

test('control: nothing was used earlier -> the line', async () => {
  const s = setup();
  await stop(s, 'S1', { link: 'alpha' });
  assert.match(await writeStory(s, 'S1', 'alpha'), /brainstorming/u);
});

test('a skill remembered for another item does not count', async () => {
  const s = setup();
  await stop(s, 'S1', { link: 'alpha', skills: [BRAIN] });
  await stop(s, 'S1', { link: 'beta' });
  assert.match(await writeStory(s, 'S1', 'beta'), /brainstorming/u);
});

test('another session does not inherit it', async () => {
  const s = setup();
  await stop(s, 'S1', { link: 'alpha', skills: [BRAIN] });
  await stop(s, 'S2', { link: 'alpha' });
  assert.match(await writeStory(s, 'S2', 'alpha'), /brainstorming/u);
});
