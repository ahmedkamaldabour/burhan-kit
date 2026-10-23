import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../src/hooks/main.mjs';
import { linkItem } from '../src/hooks/core/store.mjs';
import { tmpDir } from './helpers.js';

// The session store is where the project's workflow.config says (WF_EVIDENCE_DIR), over the process environment — as in session-gates and turn-audit.
function scene(): { project: string; store: string; env: NodeJS.ProcessEnv } {
  const project = tmpDir('burhan-skill-env-project-');
  const store = tmpDir('burhan-skill-env-store-');
  mkdirSync(join(project, '.burhan/local'), { recursive: true });
  writeFileSync(join(project, '.burhan/workflow.config'), `WF_SKILLS=superpowers\nWF_EVIDENCE_DIR='${store}'\n`);
  writeFileSync(join(project, '.burhan/local/PROGRESS.md'), '# s\n## Now\n### foo\n- **Route:** feature / bounded\n### bar\n- **Route:** bug / bounded\n## Waiting on you\n');
  // the process environment points somewhere else: the config must win
  return { project, store, env: { ...process.env, WF_EVIDENCE_DIR: tmpDir('burhan-skill-env-other-') } };
}
const core = async (check: string, event: Record<string, unknown>, env: NodeJS.ProcessEnv) => (await run(['core', check], JSON.stringify(event), env)).stdout;

test('the router finds the session link in the store the config names, not the environment\'s', async () => {
  const { project, store, env } = scene();
  linkItem(project, 'S1', 'bar', ['foo', 'bar'], { ...env, WF_EVIDENCE_DIR: store });
  const out = await core('prompt-router', { event: 'prompt', prompt: 'continue', project_dir: project, session: 'S1' }, env);
  assert.match(out, /Skill \(investigate\): invoke superpowers:systematic-debugging/u);
});

test('the pre-write marker is written in the store the config names', async () => {
  const { project, store, env } = scene();
  const out = await core('pre-edit-skill', { event: 'pre_edit', file: join(project, 'app.ts'), project_dir: project, session: 'S2', turn: { skills_used: [], assistant_text: '' } }, { ...env });
  assert.equal(out, '', 'a non-code file in this project says nothing; the story file below does');
  const story = await core('pre-edit-skill', { event: 'pre_edit', file: join(project, '.burhan/work/foo/foo-story.md'), project_dir: project, session: 'S2', turn: { skills_used: [], assistant_text: '' } }, env);
  assert.match(story, /brainstorming/u);
  const found = (dir: string): boolean => existsSync(dir) && readdirSync(dir, { recursive: true }).some((f) => String(f).endsWith('skilltold'));
  assert.equal(found(store), true, 'the marker is in the configured store');
  assert.equal(found(env.WF_EVIDENCE_DIR!), false, 'and not in the environment\'s');
});
