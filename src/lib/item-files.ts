import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BurhanError } from './errors.js';
import { isSlug, SLUG_RULE } from './item-io.js';

import { deviations, fenced, openDeviations, overallStatus, planRoute, qcAccepted, qcVerdict, routeNeeds, RUNGS, setFieldLine, units, withDeviationResolved, withDeviationRow, withRung } from '../hooks/core/item-model.mjs';
export type { Unit } from '../hooks/core/item-model.mjs';
export { deviations, fenced, openDeviations, overallStatus, planRoute, qcAccepted, qcVerdict, routeNeeds, RUNGS, setFieldLine, units, withDeviationResolved, withDeviationRow, withRung };

/** The item's folder under the docs location, checked to exist. */
export function itemFolder(docsAbs: string, slug: string | undefined, command: string): { slug: string; dir: string } {
  if (!isSlug(slug)) throw new BurhanError(`${command} needs an item slug (${SLUG_RULE})`);
  const dir = join(docsAbs, slug);
  if (!existsSync(dir)) throw new BurhanError(`item "${slug}" has no folder under the docs location`);
  return { slug, dir };
}

export const planPath = (dir: string, slug: string): string => join(dir, `${slug}-implementation-plan.md`);
/** The file's text, or null when it is not a plain file (a missing file, a folder, or a link: a link could lead outside the project). */
export const readOr = (path: string): string | null => {
  try { return lstatSync(path).isFile() ? readFileSync(path, 'utf8') : null; } catch { return null; }
};

/** The sub-unit numbers a review heading names: `Sub-unit 3`, a group `Sub-units 1–3` or `Sub-units 5, 7` (the form of kit/templates/review.md). */
export function reviewHeadingUnits(line: string): number[] {
  const m = /^#{2,4}[ \t].*?Sub-units?[ \t]+(\d[\d,\s–-]{0,200})/.exec(line);
  if (!m) return [];
  const out: number[] = [];
  for (const tok of m[1]!.split(',')) {
    const t = tok.trim().replace(/[\s–-]+$/, '');
    const r = /^(\d+)\s*[–-]\s*(\d+)$/.exec(t);
    if (r) { const a = Number(r[1]); const b = Number(r[2]); for (let n = a; n <= b && n - a < 1000; n++) out.push(n); }
    else if (/^\d+$/.test(t)) out.push(Number(t));
  }
  return out;
}

/** Does the review file have a heading for this sub-unit (its own, or a review group that names it)? */
export const hasReviewSection = (review: string | null, n: number): boolean =>
  review !== null && review.split('\n').some((l) => reviewHeadingUnits(l.replace(/\r$/, '')).includes(n));
