/** The skill the agent must invoke before its next phase (phases/skills.md), read from the item's own files — never from the
 *  words of the prompt. Shared by the prompt router (and the pre-write check). Fails open: null says nothing. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { itemBlock, itemResolved, itemRoute, itemSlugs, stateNow, type Ctx } from './lib.mjs';
import { linkedItem, safeId } from './store.mjs';

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
    if (ctx.cfg.WF_SKILLS !== 'superpowers') return null;
    const now = stateNow(ctx.project, ctx.cfg);
    const slugs = itemSlugs(now);
    if (slugs.length === 0) return { label: 'before a story', skill: 'superpowers:brainstorming' };
    const item = itemResolved(now, linkedItem(ctx.project, ctx.ev.get('.session'), slugs, storeEnv(ctx)));
    if (item === '' || !safeId(item)) return null;
    const route = itemRoute(itemBlock(now, item));
    if (route.endsWith(' / patch')) return null; // the patch lane has no story or plan: no phase skill is asked for
    const type = route.split(' / ')[0];
    const dir = join(ctx.project, ctx.cfg.WF_DOCS_DIR ?? '', item);
    const plan = status(join(dir, `${item}-implementation-plan.md`), 'Overall status');
    const building = plan === 'Approved' || plan === 'In progress';
    if (plan === 'Completed') return { label: 'verify', skill: 'superpowers:verification-before-completion' };
    if (plan === 'Paused' || plan === 'Superseded') return null;
    if (type === 'bug' || type === 'investigation') return { label: 'investigate', skill: 'superpowers:systematic-debugging' };
    if (building) return { label: 'build', skill: 'superpowers:test-driven-development' };
    if (status(join(dir, `${item}-story.md`), 'Status') === 'Approved') return { label: 'plan', skill: 'superpowers:writing-plans' };
    return { label: 'story', skill: 'superpowers:brainstorming' };
  } catch { return null; }
}

export const skillLineText = (s: SkillLine): string => `⚑ Skill (${s.label}): invoke ${s.skill} and read its instructions before you start.`;
