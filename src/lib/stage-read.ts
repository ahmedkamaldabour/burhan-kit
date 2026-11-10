import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { itemSlugs, nowSection } from '../hooks/core/lib.mjs';
import { routeOf, stageOf, type Stage } from '../hooks/core/item-stage.mjs';
import { readProjectConfig } from './config.js';
import { BurhanError } from './errors.js';
import { realTarget } from './fs-safe.js';
import { findingsGated, gateOf, gateOpen, readItemFindings, type Gate } from './findings.js';
import { itemFolder, planPath, readOr, units } from './item-files.js';
import { latestQcFile } from './items.js';
import { docsLocation } from './status.js';

/** `findings`: what is open in the item's review and QC findings, for an item with the findings gate; null for an old item. */
export interface ItemStage { slug: string; route: string; st: Stage; story: string | null; plan: string | null; findings: { review: Gate; qc: Gate } | null }

/** The slugs in the state file's Now section; none when there is no state file or it cannot be read. */
export function nowSlugs(project: string): string[] {
  const stateRel = readProjectConfig(project).values.WF_STATE_FILE || '.burhan/local/PROGRESS.md';
  const state = join(project, stateRel);
  try { return existsSync(state) ? itemSlugs(nowSection(readFileSync(state, 'utf8'))) : []; } catch { return []; /* a folder or an unreadable file: no item found */ }
}

/** The item a command names (without a slug: the only item in Now), its route and its stage, read from its files. `command` names the caller in an error message. */
export function readItemStage(target: string, slug: string | undefined, docs: string | undefined, command: string): ItemStage {
  const project = realTarget(target);
  let name = slug;
  if (name === undefined) {
    const slugs = nowSlugs(project);
    if (slugs.length !== 1) throw new BurhanError(`${command} needs an item slug: ${slugs.length === 0 ? 'there is no item in Now' : `Now has more than one (${slugs.join(', ')})`}`);
    name = slugs[0]!;
  }
  const { slug: s, dir } = itemFolder(docsLocation(target, docs).abs, name, command);
  const story = readOr(join(dir, `${s}-story.md`));
  const plan = readOr(planPath(dir, s));
  const findings = readOr(join(dir, `${s}-findings.md`));
  const route = routeOf(story, plan, findings);
  const read = plan !== null && findingsGated(plan) ? readItemFindings(dir, s) : null;
  const gates = read === null || plan === null ? null : { review: gateOf(read, 'review', units(plan).filter((u) => u.rung === 4).map((u) => u.n)), qc: gateOf(read, 'qc') };
  const st = stageOf({ slug: s, route, story, plan, findings, qc: readOr(latestQcFile(dir, s)), spec: readOr(join(dir, `${s}-build-spec.md`)), ...(gates === null ? {} : { undecided: { review: gateOpen(gates.review), qc: gateOpen(gates.qc) } }) });
  return { slug: s, route, st, story, plan, findings: gates };
}
