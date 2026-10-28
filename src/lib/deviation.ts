import type { Io } from '../main.js';
import { BurhanError } from './errors.js';
import { putFile, realTarget } from './fs-safe.js';
import { person } from './approve.js';
import { deviations, itemFolder, overallStatus, planPath, readOr, units, withDeviationResolved, withDeviationRow } from './item-files.js';
import { assertInside, today } from './item-io.js';
import { docsLocation } from './status.js';

/** A free-text argument for a table cell: required, of any length; a line break becomes a space and a pipe is escaped when it is written. */
function text(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim() === '') throw new BurhanError(`${flag} is needed`);
  return value.trim();
}

/** `burhan deviation add <slug> --unit N --what <text> --where <file:line or step> --output <text>`: records a step that did not go as the build spec said
 *  as an open row of the plan's Deviations table. The executor stops until the owner decides it. */
export function deviationAdd(target: string, slug: string | undefined, o: { unit?: string; what?: string; where?: string; output?: string; docs?: string }, io: Io): number {
  const project = realTarget(target);
  const { slug: s, dir } = itemFolder(docsLocation(target, o.docs).abs, slug, 'deviation add');
  const file = planPath(dir, s);
  const plan = readOr(file);
  if (plan === null) throw new BurhanError(`item "${s}" has no implementation plan`);
  const status = overallStatus(plan);
  if (status !== 'Approved' && status !== 'In progress') throw new BurhanError(`the plan is ${status ?? 'without a status'}: a deviation is recorded while the plan is Approved or In progress`);
  if (o.unit === undefined || !/^\d+$/.test(o.unit)) throw new BurhanError('--unit is needed: the number of the sub-unit that deviated');
  const unit = Number(o.unit);
  if (!units(plan).some((u) => u.n === unit)) throw new BurhanError(`the plan has no Sub-unit ${unit}`);
  const row = { unit, what: text(o.what, '--what'), where: text(o.where, '--where'), output: text(o.output, '--output') };
  const updated = withDeviationRow(plan, row);
  if (updated === null) throw new BurhanError('the plan has no Deviations table that is read ("## Deviations" with a table): run burhan item check');
  assertInside(project, file);
  putFile(file, updated.text);
  io.stdout(`deviation: row ${updated.n} recorded as open for Sub-unit ${unit}. STOP: do not fix it on your own; ask the owner. An approved deviation updates the plan and the build spec first, then the code.\n`);
  return 0;
}

/** `burhan deviation resolve <slug> <n> --approved|--rejected --by <name> [--decision <text>]`: the owner's decision on an open row. */
export function deviationResolve(target: string, slug: string | undefined, n: string | undefined, o: { approved?: boolean; rejected?: boolean; by?: string; decision?: string; docs?: string }, io: Io): number {
  const project = realTarget(target);
  const { slug: s, dir } = itemFolder(docsLocation(target, o.docs).abs, slug, 'deviation resolve');
  const by = person(o.by);
  if ((o.approved === true) === (o.rejected === true)) throw new BurhanError('deviation resolve needs exactly one of --approved or --rejected');
  if (n === undefined || !/^\d+$/.test(n)) throw new BurhanError('deviation resolve needs the row number: deviation resolve <slug> <n> --approved|--rejected --by <name>');
  const file = planPath(dir, s);
  const plan = readOr(file);
  if (plan === null) throw new BurhanError(`item "${s}" has no implementation plan`);
  const row = deviations(plan).find((d) => d.n === Number(n));
  if (row === undefined) throw new BurhanError(`the Deviations table has no row ${n}`);
  if (row.status !== 'open') throw new BurhanError(`Deviations row ${n} is ${row.status}, not open`);
  const decision = `${by} · ${today()}${o.decision !== undefined && o.decision.trim() !== '' ? ` — ${o.decision.trim()}` : ''}`;
  const updated = withDeviationResolved(plan, Number(n), o.approved === true ? 'approved' : 'rejected', decision);
  if (updated === null) throw new BurhanError(`the Deviations table has no row ${n}`);
  assertInside(project, file);
  putFile(file, updated);
  io.stdout(`deviation: row ${n} ${o.approved === true ? 'approved' : 'rejected'} by ${by}; it was run from the shell, so the turn-end report lists it as agent-run: it must be the decision you were given. ${o.approved === true ? 'Update the plan and the build spec first, then the code.' : ''}\n`);
  return 0;
}
