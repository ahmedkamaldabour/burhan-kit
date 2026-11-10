import type { Io } from '../main.js';
import { skillFor } from '../hooks/core/item-stage.mjs';
import { realTarget } from './fs-safe.js';
import { appliedSentence } from './deviation.js';
import { questionLines } from './finding.js';
import { fullRunFor, fullRunLine } from './full-run.js';
import { skillAdvice, skillAdviceLine, wantsSkills } from './skill-advice.js';
import { nowSlugs, readItemStage } from './stage-read.js';

const NEW_ITEM = 'burhan item new <slug> --type <feature|bug|investigation|change|refactor|release> --scope <spike|bounded|architectural>';

/** `guide` with no slug when Now holds no item or several: it answers instead of failing. */
function guideWithoutItem(project: string, slugs: string[], io: Io, json: boolean): number {
  const none = slugs.length === 0;
  const stage = none ? 'no item' : 'several items';
  const why = none
    ? 'no item is in Now, so nothing authorizes a code edit (an exact patch line is the only exception)'
    : `Now holds more than one item (${slugs.join(', ')}), so it is not clear which one a code edit belongs to`;
  const next = none
    ? `route the request with ${NEW_ITEM}; for one obvious change with no escalator, state the routing line "patch — <reason>" and make it`
    : `burhan guide <slug>, with one of: ${slugs.join(', ')}`;
  const choice = none && wantsSkills(project) ? skillFor({ stage: 'no item files' }, '') : null;
  const full = fullRunFor(project);
  if (json) { io.stdout(`${JSON.stringify({ item: null, items: slugs, route: '', stage, authorized: false, why, next, skill: choice?.skill ?? null, fullRun: full })}\n`); return 0; }
  io.stdout(`guide: ${none ? 'no item in Now' : `${slugs.length} items in Now: ${slugs.join(', ')}`}\n`);
  io.stdout(`stage: ${stage}\n`);
  io.stdout(`code edits: NOT authorized — ${why}\n`);
  if (choice !== null) io.stdout(`${skillAdviceLine({ ...choice, seen: { state: 'unknown', why: 'there is no item yet' } })}\n`);
  io.stdout(`next: ${next}\n`);
  io.stdout(`${fullRunLine(full)}\n`);
  return 0;
}

/** `burhan guide [slug] [--json]`: the item's stage, whether code edits are authorized now, the process skill to run, and the next step. Without a slug, the only item in Now; with none or several it says what to do instead of failing. */
export function guide(target: string, slug: string | undefined, io: Io, o: { json?: boolean; docs?: string } = {}): number {
  if (slug === undefined) {
    const project = realTarget(target);
    const slugs = nowSlugs(project);
    if (slugs.length !== 1) return guideWithoutItem(project, slugs, io, o.json === true);
  }
  const { slug: s, route, st, story, plan, findings } = readItemStage(target, slug, o.docs, 'guide');
  const advice = skillAdvice(realTarget(target), s, st, route);
  const full = fullRunFor(realTarget(target), process.env, { slug: s, docs: o.docs });
  if (o.json) { io.stdout(`${JSON.stringify({ item: s, route, stage: st.stage, authorized: st.authorized, why: st.why, next: st.next, skill: advice?.skill ?? null, fullRun: full })}\n`); return 0; }
  const mode = /^- \*\*Mode:\*\*[ \t]*(step|auto)(?![A-Za-z])/m.exec(story ?? '')?.[1];
  io.stdout(`guide: ${s} — ${route || 'no exact route'}${mode ? ` (mode ${mode})` : ''}\n`);
  io.stdout(`stage: ${st.stage}\n`);
  io.stdout(`code edits: ${st.authorized ? 'AUTHORIZED' : 'NOT authorized'} — ${st.why}\n`);
  if (advice !== null) io.stdout(`${skillAdviceLine(advice)}\n`);
  io.stdout(`next: ${st.next}\n`);
  // The rows of the Deviations table that the agent applied without asking: the owner sees them here, whatever the stage.
  const applied = plan === null ? null : appliedSentence(plan);
  if (applied !== null) io.stdout(`deviations: ${applied}\n`);
  // At the stage where they are asked, the open findings as one question for the owner.
  const open = findings === null ? null : st.stage === 'all sub-units reviewed' ? findings.review : st.stage === 'QC passed, not accepted' ? findings.qc : null;
  if (open !== null) for (const l of questionLines(s, open)) io.stdout(`${l}\n`);
  io.stdout(`${fullRunLine(full)}\n`);
  return 0;
}
