/** Before a story, plan, review or code file is written: the skill line of that phase, once per session and item, when the skill was not
 *  used this turn. Never blocks (WORKFLOW §7). Silent inside a subagent (it has no Skill tool). */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ereTest } from './ere.mjs';
import { itemBlock, itemRoute, relPath, type Check } from './lib.mjs';
import { currentItem, skillLineText, storeEnv } from './skill-line.mjs';
import { markSkillTold, rememberedPhaseSkills, rememberedSkills, skillTold } from './store.mjs';

const outside = (rel: string): boolean => rel.startsWith('/') || rel.startsWith('../') || rel === '..' || /^[A-Za-z]:/.test(rel);

export const preEditSkill: Check = (ctx) => {
  const { ev, cfg, project } = ctx;
  if (cfg.WF_SKILLS !== 'superpowers') return [];
  const raw = ev.get('.file');
  if (raw === '' || ev.get('.agent_id') !== '') return [];
  const rel = relPath(raw, project).replace(/\\/g, '/');
  if (outside(rel) || rel === (cfg.WF_STATE_FILE ?? '') || rel.startsWith(`${cfg.WF_DISCOVERY_DIR ?? '\u0000'}/`)) return [];
  const used = ev.list('.turn.skills_used');
  const { now, item } = currentItem(ctx);
  // This turn's skills and those this session used earlier for the same item (or before any item existed).
  const earlier = rememberedPhaseSkills(project, ev.get('.session'), item, storeEnv(ctx));
  const has = (names: string): boolean => [...used, ...earlier].some((s) => new RegExp(`(^|:)(${names})$`).test(s));
  let label = '';
  let skill = '';
  const docs = cfg.WF_DOCS_DIR ?? '';
  const parts = docs !== '' && rel.startsWith(`${docs}/`) ? rel.slice(docs.length + 1).split('/') : [];
  if (parts.length === 0 && rel.startsWith('.burhan/')) return [];
  if (parts.length === 2 && !existsSync(join(project, rel))) {
    if (parts[1] === `${parts[0]}-story.md` && !has('brainstorming')) { label = 'story'; skill = 'superpowers:brainstorming'; }
    else if (parts[1] === `${parts[0]}-implementation-plan.md` && !has('writing-plans')) { label = 'plan'; skill = 'superpowers:writing-plans'; }
  } else if (parts.length === 3 && parts[1] === 'reviews' && /\.md$/.test(parts[2]) && !/-(qc|verification)(-r[0-9]+)?\.md$/.test(parts[2]) && !has('requesting-code-review')) {
    label = 'review'; skill = 'superpowers:requesting-code-review';
  } else if (parts.length === 0 && ereTest(cfg.WF_CODE_REGEX ?? '', rel) && !ereTest(cfg.WF_TEST_REGEX ?? '', rel)) {
    const remembered = item === '' ? [] : rememberedSkills(project, ev.get('.session'), item, storeEnv(ctx));
    const done = has('test-driven-development|systematic-debugging') || remembered.length > 0;
    let patch = ereTest('^[[:space:]>*_-]*patch\\**[[:space:]]*(—|–)', ev.get('.turn.assistant_text'), { i: true });
    if (patch && item !== '') patch = ['change / patch', 'bug / patch', 'refactor / patch'].includes(itemRoute(itemBlock(now, item)));
    if (patch && ereTest(cfg.WF_SENSITIVE_REGEX ?? '', rel)) patch = false;
    if (!done && !patch) { label = 'build'; skill = 'superpowers:test-driven-development'; }
  }
  if (skill === '') return [];
  const session = ev.get('.session');
  if (skillTold(project, session, item || '-', skill, storeEnv(ctx))) return [];
  markSkillTold(project, session, item || '-', skill, storeEnv(ctx));
  return [skillLineText({ label, skill })];
};
