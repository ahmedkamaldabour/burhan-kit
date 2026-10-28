import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { run } from '../../src/hooks/main.mjs';
import { projectKey } from '../../src/hooks/core/store.mjs';
import { skillFor, stageOf } from '../../src/hooks/core/item-stage.mjs';
import { tmpDir } from '../helpers.js';

// The CLI's stage → skill table and the prompt router's skillLine (skill-line.mts) are two readings of phases/skills.md. They must agree
// wherever both name a skill. The table is finer in exactly these stages (plan section 3), so they are the only allowed differences.
const FINER = new Set(['Sub-unit N implemented', 'all sub-units reviewed', 'QC failed', 'build spec missing']);
const D = 'AI_SPEC/docs';
const APPROVED = 'Approved — dev · 2026-10-28';
const story = (route: string, status: string): string => `# S\n- **Route:** ${route}\n- **Status:** ${status}\n`;
const plan = (route: string, status: string, rungs: string[]): string =>
  `# P\n- **Route:** ${route}\n- **Overall status:** ${status}\n\n## 4. Sub-unit breakdown\n${rungs.map((r, i) => `### Sub-unit ${i + 1} — u${i + 1} · ${r}\n`).join('')}`;
const cases = (route: string): Array<[string | null, string | null]> => [
  [story(route, 'Draft'), null],
  [story(route, APPROVED), null],
  [story(route, APPROVED), plan(route, 'Draft', ['⬜ Draft'])],
  [story(route, APPROVED), plan(route, 'Approved', ['🟡 Approved'])],
  [story(route, APPROVED), plan(route, 'In progress', ['🔵 In progress'])],
  [story(route, APPROVED), plan(route, 'In progress', ['🟢 Implemented'])],
  [story(route, APPROVED), plan(route, 'In progress', ['✅ Reviewed'])],
  [story(route, APPROVED), plan(route, 'Completed', ['✅ Reviewed'])],
  [story(route, APPROVED), plan(route, 'Paused', ['🔵 In progress'])],
  [story(route, APPROVED), plan(route, 'Superseded', ['🔵 In progress'])],
];

/** The skill the real prompt-router hook names for a project whose item `foo` has these files (null: it names none). */
async function hookSkill(route: string, storyText: string | null, planText: string | null): Promise<string | null> {
  const project = tmpDir('burhan-agree-project-');
  const store = tmpDir('burhan-agree-store-');
  mkdirSync(join(project, '.burhan/local'), { recursive: true });
  writeFileSync(join(project, '.burhan/workflow.config'), [`WF_DOCS_DIR=${D}`, 'WF_STATE_FILE=.burhan/local/PROGRESS.md', 'WF_SKILLS=superpowers', `WF_EVIDENCE_DIR='${store}'`].join('\n') + '\n');
  writeFileSync(join(project, '.burhan/local/PROGRESS.md'), `# s\n## Now\n### foo\n- **Route:** ${route}\n## Waiting on you\n`);
  const link = join(store, projectKey(project), 'S', 'item');
  mkdirSync(dirname(link), { recursive: true });
  writeFileSync(link, 'foo\n');
  const dir = join(project, D, 'foo');
  mkdirSync(dir, { recursive: true });
  if (storyText !== null) writeFileSync(join(dir, 'foo-story.md'), storyText);
  if (planText !== null) writeFileSync(join(dir, 'foo-implementation-plan.md'), planText);
  const out = (await run(['core', 'prompt-router'], JSON.stringify({ event: 'prompt', prompt: 'hello', project_dir: project, session: 'S' }), { ...process.env, WF_EVIDENCE_DIR: store })).stdout;
  return /Skill \([^)]*\): invoke (\S+) and read/.exec(out)?.[1] ?? null;
}

test('the table agrees with the prompt router wherever both name a skill; it differs only in the four finer stages', async () => {
  let compared = 0;
  let finer = 0;
  for (const route of ['feature / architectural', 'bug / bounded', 'change / bounded']) {
    for (const [s, p] of cases(route)) {
      const st = stageOf({ slug: 'foo', route, story: s, plan: p, findings: null, qc: null, spec: null });
      const mine = skillFor(st, route)?.skill ?? null;
      const theirs = await hookSkill(route, s, p);
      if (FINER.has(st.stage.replace(/\d+/, 'N'))) {
        finer++;
        assert.notEqual(mine, null, `${route} · ${st.stage}`);
        assert.notEqual(mine, theirs, `${route} · ${st.stage}: a finer stage must differ from the router`);
        continue;
      }
      assert.equal(mine, theirs, `${route} · ${st.stage}`);
      compared++;
    }
  }
  assert.ok(compared >= 20 && finer >= 4, `the grid ran: ${compared} compared, ${finer} finer`);
});
