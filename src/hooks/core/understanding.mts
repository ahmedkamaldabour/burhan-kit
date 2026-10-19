/**
 * Project understanding (phases/memory.md): a short reminder every prompt, and a turn-end warning, while a brownfield
 * project has no Approved or Waived baseline. Guidance only — nothing here blocks. Exempt: greenfield, the patch lane,
 * read-only items, the onboarding itself. The tree is walked only when the baseline is not decided (cost per turn).
 */
import { baselineState, isBrownfield, type BaselineState } from './baseline.mjs';
import { itemBlock, itemField, itemResolved, itemRoute, itemSlugs, stateNow, type Ctx } from './lib.mjs';
import { linkedItem } from './store.mjs';

const ONBOARD = 'Claude Code: /burhan:onboard · Codex: follow .burhan/commands/onboard.md';
const PATCH = new Set(['change / patch', 'bug / patch', 'refactor / patch']);

/** The item this session works on, and whether its route is exempt (patch lane or read-only). */
function exemptItem(ctx: Ctx): boolean {
  const now = stateNow(ctx.project, ctx.cfg);
  const item = itemBlock(now, itemResolved(now, linkedItem(ctx.project, ctx.ev.get('.session'), itemSlugs(now), ctx.env)));
  const route = itemRoute(item);
  if (PATCH.has(route)) return true;
  const ro = itemField(item, 'Read-only');
  return route.startsWith('investigation / ') || route === 'bug / spike' ? ro !== 'no' : ro === 'yes';
}

/** The undecided baseline state of a brownfield project, or null when nothing should be said. */
export function undecided(ctx: Ctx): Exclude<BaselineState, 'approved' | 'waived'> | null {
  const state = baselineState(ctx.project);
  if (state === 'approved' || state === 'waived') return null;
  if (exemptItem(ctx)) return null;
  return isBrownfield(ctx.project, ctx.cfg.WF_CODE_REGEX ?? '') ? state : null;
}

/** The per-prompt line (outside the router's two phase lines). */
export function reminderLine(state: Exclude<BaselineState, 'approved' | 'waived'>): string {
  if (state === 'draft') return `⚑ BASELINE IS A DRAFT: finish the onboarding and get the person's decision before a story or code (${ONBOARD}).`;
  const why = state === 'malformed' ? ' (its Baseline line is not in an exact form — run burhan memory check)' : '';
  return `⚑ PROJECT NOT UNDERSTOOD YET: this project has code but no approved baseline in .burhan/PROJECT.md${why}. Before a story or code, run the onboarding (${ONBOARD}), or the person waives it.`;
}

/** The turn-end warning text. */
export function gateLine(what: string, state: BaselineState): string {
  return `⚠ BASELINE GATE: ${what} this turn, but this project has no approved or waived baseline (.burhan/PROJECT.md: ${state === 'none' ? 'missing' : state}). Run the onboarding first (${ONBOARD}), or ask the person whether to waive it — never write Approved or Waived yourself.`;
}
