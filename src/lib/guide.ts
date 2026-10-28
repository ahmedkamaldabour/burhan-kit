import type { Io } from '../main.js';
import { realTarget } from './fs-safe.js';
import { fullRunFor, fullRunLine } from './full-run.js';
import { skillAdvice, skillAdviceLine } from './skill-advice.js';
import { readItemStage } from './stage-read.js';

/** `burhan guide [slug] [--json]`: the item's stage, whether code edits are authorized now, the process skill to run, and the next step. Without a slug, the only item in Now. */
export function guide(target: string, slug: string | undefined, io: Io, o: { json?: boolean; docs?: string } = {}): number {
  const { slug: s, route, st, story } = readItemStage(target, slug, o.docs, 'guide');
  const advice = skillAdvice(realTarget(target), s, st, route);
  const full = fullRunFor(realTarget(target));
  if (o.json) { io.stdout(`${JSON.stringify({ item: s, route, stage: st.stage, authorized: st.authorized, why: st.why, next: st.next, skill: advice?.skill ?? null, fullRun: full })}\n`); return 0; }
  const mode = /^- \*\*Mode:\*\*[ \t]*(step|auto)(?![A-Za-z])/m.exec(story ?? '')?.[1];
  io.stdout(`guide: ${s} — ${route || 'no exact route'}${mode ? ` (mode ${mode})` : ''}\n`);
  io.stdout(`stage: ${st.stage}\n`);
  io.stdout(`code edits: ${st.authorized ? 'AUTHORIZED' : 'NOT authorized'} — ${st.why}\n`);
  if (advice !== null) io.stdout(`${skillAdviceLine(advice)}\n`);
  io.stdout(`next: ${st.next}\n`);
  io.stdout(`${fullRunLine(full)}\n`);
  return 0;
}
