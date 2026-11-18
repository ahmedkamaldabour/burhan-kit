import { lstatSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Io } from '../main.js';
import { displayId } from '../hooks/core/item-id.mjs';
import { person } from './approve.js';
import { BurhanError } from './errors.js';
import { realTarget } from './fs-safe.js';
import { itemFolder, overallStatus, planPath, readOr } from './item-files.js';
import { assertInside, oneLine, today } from './item-io.js';
import { itemRoute } from './items.js';
import { hasStateBlock, stateClose } from './state-set.js';
import { docsLocation } from './status.js';

/** The file that keeps the owner's reason for closing an item as already satisfied, in the item's folder. */
export const satisfiedFile = (slug: string): string => `${slug}-already-satisfied.md`;

/** Write a new file and never replace one: the exclusive create closes the gap between the check above and the write (two closes at once, a file that appeared meanwhile). */
function writeNew(file: string, text: string, where: string, slug: string): void {
  try { writeFileSync(realTarget(file), text, { flag: 'wx' }); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new BurhanError(`item "${slug}" already has ${where}: it was closed as already satisfied`);
    throw e;
  }
}

/** `burhan item close <slug> --already-satisfied "<reason>" --by <owner name>`: the owner closes an item whose story the code already satisfies. A written reason is kept in the item's folder
 *  (`<slug>-already-satisfied.md`), so the index shows `Already satisfied` and a later reader sees why. Refused (exit 2, nothing written) for a missing or empty reason, for an agent's name
 *  (the check `approve` makes), for an item with no story, for a plan that is not absent, Draft or Approved, and for an item already closed this way. The plan is never touched. When the
 *  item has a block in the state file it becomes its closed line (commit `uncommitted`); a problem there is said on one line and never fails the close. */
export function itemClose(target: string, slug: string | undefined, o: { alreadySatisfied?: string; by?: string; docs?: string }, io: Io): number {
  const project = realTarget(target);
  const { slug: s, dir } = itemFolder(docsLocation(target, o.docs).abs, slug, 'item close');
  if (o.alreadySatisfied === undefined) throw new BurhanError('item close needs --already-satisfied "<why the code already does what the story asks>": it is the one way this command closes an item (an item that was built is finished with item finish)');
  const by = person(o.by, 'closes the item');
  const reason = oneLine(o.alreadySatisfied, '--already-satisfied');
  if (reason === '') throw new BurhanError('the reason is empty: write why the code already does what the story asks');
  const story = readOr(join(dir, `${s}-story.md`));
  if (story === null) throw new BurhanError(`item "${s}" has no story: only an item with a story is closed as already satisfied`);
  const plan = readOr(planPath(dir, s));
  const status = plan === null ? null : overallStatus(plan);
  if (plan !== null && status !== 'Draft' && status !== 'Approved') throw new BurhanError(`the plan of "${s}" is ${status ?? 'without a status'}: an item whose plan is In progress, Completed, Paused or Superseded is finished or paused the usual way (burhan item finish, burhan item set), not closed as already satisfied`);
  if (itemRoute(story, plan ?? '') === null) throw new BurhanError(`the route of item "${s}" cannot be read from its story or plan, so its closed line cannot be written: fix the Route line first (burhan item check ${s})`);
  const file = join(dir, satisfiedFile(s));
  const where = relative(project, file).split(sep).join('/');
  const exists = ((): boolean => { try { lstatSync(file); return true; } catch { return false; } })();
  if (exists) throw new BurhanError(`item "${s}" already has ${where}: it was closed as already satisfied`);
  assertInside(project, file);
  writeNew(file, `# ${s} — closed as already satisfied\n- **Closed by:** ${by} · ${today()}\n- **Reason:** ${reason}\n- **Story:** ./${s}-story.md\n\nThe code already does what the story asks, so nothing was planned or built. The owner decided this with \`burhan item close\`; the item's index state is \`Already satisfied\`.\n`, where, s);
  io.stdout(`item close: ${displayId(s)} closed as already satisfied by ${by}\n  reason kept in ${where}\n`);
  const folder = relative(project, dir).split(sep).join('/');
  if (!hasStateBlock(project, s)) io.stdout(`  state: no "### ${s}" block under Now in the state file, so no closed line was written there\n`);
  else {
    try { stateClose(project, s, { outcome: 'Already satisfied', commit: 'uncommitted', folder, docs: o.docs }, io); }
    catch (e) {
      if (!(e instanceof BurhanError)) throw e;
      io.stdout(`  state: the block of ${s} was not closed (${e.message}); run burhan state close ${s} --outcome "Already satisfied" --commit uncommitted --folder ${folder}\n`);
    }
  }
  io.stdout('next: regenerate the index with burhan status --write\n');
  return 0;
}
