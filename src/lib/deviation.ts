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

/** The least words a reason has: a sentence, not a word (the same smallest check as an accepted finding). */
const MIN_WORDS = 3;

/** `burhan deviation add <slug> --unit N --what <text> --where <file:line or step> --output <text> [--apply "<why no decision is needed>"]`: records a step that did not
 *  go as the build spec said as a row of the plan's Deviations table. Without `--apply` the row is open: the executor stops until the owner decides it (a class B
 *  problem). With `--apply` the row is `applied` at once, with the reason and no owner's name: a class A problem (phases/stage-build.md), fixed by the agent and
 *  reported; `applied` is the agent's own claim, and the row stays visible in the plan, in `guide` and in `item finish`. */
export function deviationAdd(target: string, slug: string | undefined, o: { unit?: string; what?: string; where?: string; output?: string; apply?: string; by?: string; docs?: string }, io: Io): number {
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
  let applied: string | undefined;
  if (o.apply !== undefined) {
    if (o.by !== undefined) throw new BurhanError('an applied row carries no owner\'s name: leave out --by (the owner\'s decision is deviation resolve, for an open row)');
    const why = text(o.apply, '--apply');
    if (why.split(/\s+/).length < MIN_WORDS) throw new BurhanError(`--apply needs the reason no decision is needed, in a sentence (at least ${MIN_WORDS} words): --apply "<why no decision is needed>"`);
    applied = `applied by the agent · ${today()} — ${why}`;
  }
  const updated = withDeviationRow(plan, { ...row, ...(applied === undefined ? {} : { applied }) });
  if (updated === null) throw new BurhanError('the plan has no Deviations table that is read ("## Deviations" with a table): run burhan item check');
  assertInside(project, file);
  putFile(file, updated.text);
  if (applied !== undefined) {
    io.stdout(`deviation: row ${updated.n} recorded as applied for Sub-unit ${unit} (class A: no decision is needed). Fix it, report it, and go on; the row is listed by burhan guide and burhan item finish. Applied is your own claim, not the owner's approval: if you are not sure that no decision is needed, it is class B, so record it without --apply and ask the owner.\n`);
    return 0;
  }
  io.stdout(`deviation: row ${updated.n} recorded as open for Sub-unit ${unit} (class B: a decision is needed). STOP: do not fix it on your own; ask the owner (step mode: at the end of the sub-unit; auto mode: stop and wait for the answer, then go on). An approved deviation updates the plan and the build spec first, then the code. If the answer is already known and no decision is needed, record it with --apply "<why no decision is needed>" and go on.\n`);
  return 0;
}

/** The rows the agent applied without asking, as one sentence for `guide` and `item finish`; null when there is none. Each row says where and why, cut to a line. */
export function appliedSentence(plan: string): string | null {
  const rows = deviations(plan).filter((d) => d.status === 'applied');
  if (rows.length === 0) return null;
  const clean = (t: string): string => t.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ');
  const cut = (t: string, n: number): string => { const c = clean(t); return c.length > n ? `${c.slice(0, n - 1)}…` : c; };
  const why = (decision: string): string => decision.replace(/^applied by the agent · \d{4}-\d{2}-\d{2} — /, '');
  const MAX = 5;
  const shown = rows.slice(0, MAX).map((d) => `row ${d.n}, sub-unit ${d.unit}: ${cut(d.what, 70)} — ${cut(why(d.decision), 90)}`);
  const more = rows.length > MAX ? `; and ${rows.length - MAX} more: see the Deviations table of the plan` : '';
  return `applied by the agent without asking (${rows.length}): ${shown.join('; ')}${more}`;
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
