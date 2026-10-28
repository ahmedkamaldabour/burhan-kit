import { join } from 'node:path';
import type { Io } from '../main.js';
import { BurhanError } from './errors.js';
import { putFile, realTarget } from './fs-safe.js';
import { hasReviewSection, itemFolder, overallStatus, planPath, qcVerdict, readOr, RUNGS, setFieldLine, units, withRung } from './item-files.js';
import { assertInside, oneLine, today } from './item-io.js';
import { latestQcFile } from './items.js';
import { placeholderReport } from './placeholders.js';
import { docsLocation } from './status.js';

// Maps, not objects: a word like `constructor` must be an unknown status, not a property of Object.
const RUNG_WORD = new Map<string, number>([['draft', 0], ['approved', 1], ['in-progress', 2], ['in progress', 2], ['implemented', 3], ['reviewed', 4]]);
const PLAN_WORD = new Map<string, string>([['draft', 'Draft'], ['approved', 'Approved'], ['in-progress', 'In progress'], ['in progress', 'In progress'], ['completed', 'Completed'], ['paused', 'Paused'], ['superseded', 'Superseded']]);

/** `burhan item set <slug> plan <status>` and `burhan item set <slug> unit <N> <status>`: a status moves only along its ladder. */
export function itemSet(target: string, slug: string | undefined, args: string[], io: Io, docs?: string, reopen?: string): number {
  const project = realTarget(target);
  const { slug: s, dir } = itemFolder(docsLocation(target, docs).abs, slug, 'item set');
  if (args[0] === 'findings') {
    // A findings file (a read-only route) has no plan: `item set <slug> findings concluded` sets its Status.
    if (args[1]?.toLowerCase() !== 'concluded' || args.length !== 2) throw new BurhanError('item set findings needs one status: concluded');
    const file = join(dir, `${s}-findings.md`);
    const text = readOr(file);
    if (text === null) throw new BurhanError(`item "${s}" has no findings file`);
    const left = placeholderReport(project, text, 'findings');
    if (left !== null) throw new BurhanError(`the findings file has ${left}: fill it in first (burhan item check ${s})`);
    const done = setFieldLine(text, 'Status', 'Concluded');
    if (done === null) throw new BurhanError('the findings file has no **Status:** line that is read: run burhan item check');
    assertInside(project, file);
    putFile(file, done);
    io.stdout('item set: the findings are now Concluded\n');
    return 0;
  }
  const path = planPath(dir, s);
  const plan = readOr(path);
  if (plan === null) throw new BurhanError(`item "${s}" has no implementation plan`);
  const current = overallStatus(plan);
  if (current === null) throw new BurhanError('the plan has no **Overall status:** line: run burhan item check');
  const [what, ...rest] = args;
  let updated: string;
  let say: string;
  let reopenedAfterPass = false;

  if (what === 'plan') {
    const next = PLAN_WORD.get((rest[0] ?? '').toLowerCase());
    if (next === undefined || rest.length !== 1) throw new BurhanError(`item set plan needs one status: ${[...new Set(PLAN_WORD.values())].join(', ')}`);
    if (next === current) { io.stdout(`item set: the plan is already ${current}\n`); return 0; }
    if (next === 'Approved') throw new BurhanError('approval is yours to give: use burhan approve plan --by <name>');
    if (next === 'Draft') throw new BurhanError('a plan does not go back to Draft');
    if (next === 'In progress' && current === 'Completed') {
      // The lifecycle sends a failed QC back to build: reopen only for that.
      const qc = readOr(latestQcFile(dir, s));
      const failed = qc !== null && qcVerdict(qc) === 'FAIL';
      const passed = qc !== null && qcVerdict(qc) === 'PASS';
      reopenedAfterPass = passed;
      if (!failed && !(passed && reopen !== undefined && reopen.trim() !== '')) throw new BurhanError('the plan is Completed; it is reopened only when the latest QC failed, or, if it passed, with --reopen "<why>" (burhan review add --kind qc ... --verdict "FAIL — N issues")');
    } else if (next === 'In progress' && current !== 'Approved' && current !== 'Paused') throw new BurhanError(`the plan is ${current}; it must be Approved before it is In progress`);
    // Completed is `item finish`'s: it checks the sub-units, the gates, the open deviations and the proof; a plain status move would skip them all.
    if (next === 'Completed') throw new BurhanError(`a plan is completed by burhan item finish ${s}, which checks the sub-units, the gates, the deviations and the proof: item set does not`);
    if (next === 'Paused' && current !== 'In progress' && current !== 'Approved') throw new BurhanError(`the plan is ${current}; only an Approved or In progress plan is paused`);
    if (next === 'Superseded' && current === 'Completed') throw new BurhanError('a Completed plan is not superseded; open a new item');
    updated = setFieldLine(plan, 'Overall status', next) ?? plan;
    // A plan reopened after its QC PASS says when and why (it counts as an escaped defect in `burhan stats`).
    if (reopenedAfterPass) updated = setFieldLine(updated, 'Reopened after PASS', `${today()} — ${oneLine(reopen, '--reopen')}`) ?? updated;
    say = `the plan is now ${next}`;
  } else if (what === 'unit') {
    if (!/^\d+$/.test(rest[0] ?? '')) throw new BurhanError('item set unit needs a number: item set <slug> unit <N> <status>');
    const n = Number(rest[0]);
    const to = RUNG_WORD.get((rest[1] ?? '').toLowerCase());
    if (to === undefined || rest.length !== 2) throw new BurhanError(`item set unit needs a status: ${RUNGS.map(([, w]) => w).join(', ')}`);
    if (current === 'Completed' || current === 'Superseded' || current === 'Paused') throw new BurhanError(`the plan is ${current}; its sub-units do not move`);
    const unit = units(plan).find((u) => u.n === n);
    if (unit === undefined) throw new BurhanError(`the plan has no Sub-unit ${n}`);
    if (unit.rung === -1) throw new BurhanError(`Sub-unit ${n} has no status from the ladder: run burhan item check`);
    if (to === unit.rung) { io.stdout(`item set: Sub-unit ${n} is already ${RUNGS[to]![1]}\n`); return 0; }
    if (to > unit.rung + 1) throw new BurhanError(`one step at a time: ${RUNGS[unit.rung]![1]} goes to ${RUNGS[unit.rung + 1]![1]} next`);
    if (to < unit.rung && to !== 2) throw new BurhanError('a sub-unit goes back only to In progress (a review that failed)');
    let startsPlan = false;
    if (to === 2 && to > unit.rung) {
      if (current !== 'Approved' && current !== 'In progress') throw new BurhanError(`the plan is ${current}; approve it first (burhan approve plan --by <name>)`);
      startsPlan = current === 'Approved';
    }
    if (to === 4 && !hasReviewSection(readOr(join(dir, 'reviews', `${s}-review.md`)), n)) throw new BurhanError(`no review section for Sub-unit ${n} in reviews/${s}-review.md`);
    const lines = plan.split('\n');
    lines[unit.line] = withRung(lines[unit.line]!, to);
    updated = lines.join('\n');
    if (startsPlan) updated = setFieldLine(updated, 'Overall status', 'In progress') ?? updated;
    say = `Sub-unit ${n} is now ${RUNGS[to]![1]}${startsPlan ? '; the plan is now In progress' : ''}`;
  } else {
    throw new BurhanError('item set needs plan or unit: item set <slug> plan <status> | item set <slug> unit <N> <status>');
  }

  assertInside(project, path);
  putFile(path, updated);
  io.stdout(`item set: ${say}\n`);
  return 0;
}
