/** The skill the agent must invoke before its next phase (phases/skills.md), read from the item's own files — never from the
 *  words of the prompt. Shared by the prompt router (and the pre-write check). Fails open: null says nothing. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { itemBlock, itemResolved, itemRoute, itemSlugs, stateNow, type Ctx } from './lib.mjs';
import { linkedItem, safeId } from './store.mjs';
import { SKILLS, invokeText } from './skill-table.mjs';

/** The environment the session store is read with: the project's config over the process environment (as session-gates and turn-audit). */
export const storeEnv = (ctx: Ctx): NodeJS.ProcessEnv => ({ ...ctx.env, ...ctx.cfg });

export interface SkillLine { label: string; skill: string }

const STATUS_WORDS = ['In progress', 'Draft', 'Approved', 'Completed', 'Paused', 'Superseded', 'Concluded'];

/** The status word of a `**label:** value` line in an item file; null for a missing file, a template placeholder or a list of choices. */
function status(file: string, label: string): string | null {
  let text: string;
  try { text = readFileSync(file, 'utf8'); } catch { return null; }
  const m = new RegExp(`\\*\\*${label}:\\*\\*[ \\t]*([^\\n]*)`).exec(text);
  const v = m ? m[1].replace(/\*/g, '').trim() : '';
  if (v === '' || /<[^>\n]{0,400}>| \| | → /.test(v)) return null;
  return STATUS_WORDS.find((w) => new RegExp(`^${w}(?=$|[ \\t(,;—])`).test(v)) ?? null;
}

/** The session's item ('' = none or unknown) and the Now block it came from. */
export function currentItem(ctx: Ctx): { now: string; item: string } {
  const now = stateNow(ctx.project, ctx.cfg);
  const slugs = itemSlugs(now);
  const item = itemResolved(now, linkedItem(ctx.project, ctx.ev.get('.session'), slugs, storeEnv(ctx)));
  return { now, item: safeId(item) ? item : '' };
}

export function skillLine(ctx: Ctx): SkillLine | null {
  try {
    const now = stateNow(ctx.project, ctx.cfg);
    const slugs = itemSlugs(now);
    if (slugs.length === 0) return { label: 'before a story', skill: SKILLS.story.name };
    const item = itemResolved(now, linkedItem(ctx.project, ctx.ev.get('.session'), slugs, storeEnv(ctx)));
    if (item === '' || !safeId(item)) return null;
    const route = itemRoute(itemBlock(now, item));
    if (route.endsWith(' / patch')) return null; // the patch lane has no story or plan: no phase skill is asked for
    const type = route.split(' / ')[0];
    const dir = join(ctx.project, ctx.cfg.WF_DOCS_DIR ?? '', item);
    const plan = status(join(dir, `${item}-implementation-plan.md`), 'Overall status');
    const building = plan === 'Approved' || plan === 'In progress';
    if (plan === 'Completed') return { label: 'verify', skill: SKILLS.done.name };
    if (plan === 'Paused' || plan === 'Superseded') return null;
    if (type === 'bug' || type === 'investigation') return { label: 'investigate', skill: SKILLS.debug.name };
    if (building) return { label: 'build', skill: SKILLS.build.name };
    if (status(join(dir, `${item}-story.md`), 'Status') === 'Approved') return { label: 'plan', skill: SKILLS.plan.name };
    return { label: 'story', skill: SKILLS.story.name };
  } catch { return null; }
}

export const skillLineText = (s: SkillLine): string => `⚑ Skill (${s.label}): invoke ${invokeText(s.skill)} before you start.`;
