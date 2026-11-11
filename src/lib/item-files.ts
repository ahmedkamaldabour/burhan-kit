import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BurhanError } from './errors.js';
import { isSlug, SLUG_RULE } from './item-io.js';
import { matchItem, type Match } from '../hooks/core/item-id.mjs';

import { deviations, fenced, openDeviations, overallStatus, planRoute, qcAccepted, qcVerdict, routeNeeds, RUNGS, setFieldLine, units, withDeviationResolved, withDeviationRow, withRung } from '../hooks/core/item-model.mjs';
export type { Unit } from '../hooks/core/item-model.mjs';
export { deviations, fenced, openDeviations, overallStatus, planRoute, qcAccepted, qcVerdict, routeNeeds, RUNGS, setFieldLine, units, withDeviationResolved, withDeviationRow, withRung };

/** The item folders of the docs location: every directory (a link to a directory too) whose name does not start with a dot, sorted. A missing docs folder has none. */
export function folderNames(docsAbs: string): string[] {
  let names: string[] = [];
  try { names = readdirSync(docsAbs); } catch { return []; }
  const isDir = (n: string): boolean => { try { return statSync(join(docsAbs, n)).isDirectory(); } catch { return false; } };
  return names.filter((n) => !n.startsWith('.') && isDir(n)).sort();
}

/** The refusal for an argument that names more than one item: the candidates are listed, never guessed between. */
export const ambiguous = (arg: string, m: Extract<Match, { kind: 'many' }>): BurhanError =>
  new BurhanError(`"${arg}" names more than one item${m.by === 'number' ? ` (the number ${arg.padStart(3, '0')} is used by more than one)` : ''}: ${m.ids.join(', ')} — give the full id`);

/** The full id (folder name) an argument names: a full id, a number (`12`, `012`) or the plain slug. null when no folder matches; more than one is refused. */
export function resolveId(docsAbs: string, arg: string): string | null {
  const m = matchItem(arg, folderNames(docsAbs));
  if (m.kind === 'many') throw ambiguous(arg, m);
  return m.kind === 'one' ? m.id : null;
}

/** The item's folder under the docs location, checked to exist. `slug` is the plain slug, the number or the full id; the result's `slug` is always the full id (the folder name, the prefix of its files). */
export function itemFolder(docsAbs: string, slug: string | undefined, command: string): { slug: string; dir: string } {
  if (!isSlug(slug)) throw new BurhanError(`${command} needs an item slug (${SLUG_RULE})`);
  const id = resolveId(docsAbs, slug);
  if (id === null) throw new BurhanError(`item "${slug}" has no folder under the docs location`);
  return { slug: id, dir: join(docsAbs, id) };
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
