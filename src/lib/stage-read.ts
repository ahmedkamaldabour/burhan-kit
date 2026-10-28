import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { itemSlugs, nowSection } from '../hooks/core/lib.mjs';
import { routeOf, stageOf, type Stage } from '../hooks/core/item-stage.mjs';
import { readProjectConfig } from './config.js';
import { BurhanError } from './errors.js';
import { realTarget } from './fs-safe.js';
import { itemFolder, planPath, readOr } from './item-files.js';
import { latestQcFile } from './items.js';
import { docsLocation } from './status.js';

export interface ItemStage { slug: string; route: string; st: Stage; story: string | null }

/** The item a command names (without a slug: the only item in Now), its route and its stage, read from its files. `command` names the caller in an error message. */
export function readItemStage(target: string, slug: string | undefined, docs: string | undefined, command: string): ItemStage {
  const project = realTarget(target);
  let name = slug;
  if (name === undefined) {
    const stateRel = readProjectConfig(project).values.WF_STATE_FILE || '.burhan/local/PROGRESS.md';
    const state = join(project, stateRel);
    let slugs: string[] = [];
    try { slugs = existsSync(state) ? itemSlugs(nowSection(readFileSync(state, 'utf8'))) : []; } catch { /* a folder or an unreadable file: no item found */ }
    if (slugs.length !== 1) throw new BurhanError(`${command} needs an item slug: ${slugs.length === 0 ? 'there is no item in Now' : `Now has more than one (${slugs.join(', ')})`}`);
    name = slugs[0]!;
  }
  const { slug: s, dir } = itemFolder(docsLocation(target, docs).abs, name, command);
  const story = readOr(join(dir, `${s}-story.md`));
  const plan = readOr(planPath(dir, s));
  const findings = readOr(join(dir, `${s}-findings.md`));
  const route = routeOf(story, plan, findings);
  const st = stageOf({ slug: s, route, story, plan, findings, qc: readOr(latestQcFile(dir, s)), spec: readOr(join(dir, `${s}-build-spec.md`)) });
  return { slug: s, route, st, story };
}
