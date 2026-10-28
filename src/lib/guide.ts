import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Io } from '../main.js';
import { itemSlugs, nowSection } from '../hooks/core/lib.mjs';
import { routeOf, stageOf } from '../hooks/core/item-stage.mjs';
import { readProjectConfig } from './config.js';
import { BurhanError } from './errors.js';
import { realTarget } from './fs-safe.js';
import { itemFolder, planPath, readOr } from './item-files.js';
import { latestQcFile } from './items.js';
import { docsLocation } from './status.js';

/** `burhan guide [slug] [--json]`: the item's stage, whether code edits are authorized now, and the next step. Without a slug, the only item in Now. */
export function guide(target: string, slug: string | undefined, io: Io, o: { json?: boolean; docs?: string } = {}): number {
  const project = realTarget(target);
  let name = slug;
  if (name === undefined) {
    const stateRel = readProjectConfig(project).values.WF_STATE_FILE || '.burhan/local/PROGRESS.md';
    const state = join(project, stateRel);
    let slugs: string[] = [];
    try { slugs = existsSync(state) ? itemSlugs(nowSection(readFileSync(state, 'utf8'))) : []; } catch { /* a folder or an unreadable file: no item found */ }
    if (slugs.length !== 1) throw new BurhanError(`guide needs an item slug: ${slugs.length === 0 ? 'there is no item in Now' : `Now has more than one (${slugs.join(', ')})`}`);
    name = slugs[0]!;
  }
  const { slug: s, dir } = itemFolder(docsLocation(target, o.docs).abs, name, 'guide');
  const story = readOr(join(dir, `${s}-story.md`));
  const plan = readOr(planPath(dir, s));
  const findings = readOr(join(dir, `${s}-findings.md`));
  const route = routeOf(story, plan, findings);
  const st = stageOf({ slug: s, route, story, plan, findings, qc: readOr(latestQcFile(dir, s)), spec: readOr(join(dir, `${s}-build-spec.md`)) });
  if (o.json) { io.stdout(`${JSON.stringify({ item: s, route, stage: st.stage, authorized: st.authorized, why: st.why, next: st.next })}\n`); return 0; }
  const mode = /^- \*\*Mode:\*\*[ \t]*(step|auto)(?![A-Za-z])/m.exec(story ?? '')?.[1];
  io.stdout(`guide: ${s} — ${route || 'no exact route'}${mode ? ` (mode ${mode})` : ''}\n`);
  io.stdout(`stage: ${st.stage}\n`);
  io.stdout(`code edits: ${st.authorized ? 'AUTHORIZED' : 'NOT authorized'} — ${st.why}\n`);
  io.stdout(`next: ${st.next}\n`);
  return 0;
}
