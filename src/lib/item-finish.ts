import type { Io } from '../main.js';
import { checkText, hasContractMarker } from '../hooks/core/item-contract.mjs';
import { evidenceMatches } from '../hooks/core/evidence-cmd.mjs';
import { readProjectConfig } from './config.js';
import { BurhanError } from './errors.js';
import { ereToJs, isPiped, readLedger } from './evidence.js';
import { putFile, realTarget } from './fs-safe.js';
import { fenced, itemFolder, openDeviations, overallStatus, planPath, planRoute, readOr, routeNeeds, setFieldLine, units } from './item-files.js';
import { assertInside, oneLine } from './item-io.js';
import { docsLocation } from './status.js';

const regex = (ere: string | undefined): RegExp | null => { try { return ere ? new RegExp(ereToJs(ere)) : null; } catch { return null; } };

/** `burhan item finish <slug> [--evidence <text>]`: the plan becomes Completed when the plan follows the contract, every sub-unit is Reviewed, every gate that
 *  comes before Completed is ticked, and the evidence ledger shows a passing proof after the item's last code edit. QC, the knowledge review and Close-out
 *  come AFTER Completed (lifecycle), so they are not asked here. The ledger is written at the end of a turn, so a proof run in this very turn is not in it
 *  yet: `--evidence` states what shows it, and the plan then says it was stated, not proven. */
export function itemFinish(target: string, slug: string | undefined, io: Io, o: { evidence?: string; docs?: string; env?: NodeJS.ProcessEnv } = {}): number {
  const project = realTarget(target);
  const { slug: s, dir } = itemFolder(docsLocation(target, o.docs).abs, slug, 'item finish');
  const path = planPath(dir, s);
  const plan = readOr(path);
  if (plan === null) throw new BurhanError(`item "${s}" has no implementation plan`);
  const current = overallStatus(plan);
  if (current !== 'In progress') throw new BurhanError(`the plan is ${current ?? 'without a status'}; item finish needs it In progress`);
  const stated = oneLine(o.evidence, '--evidence');

  const open: string[] = [];
  const faults = checkText('plan', plan);
  if (faults.length > 0 && hasContractMarker(plan)) open.push(`the plan breaks the contract: ${faults.map((f) => f.code).join(', ')} (burhan item check ${s})`);
  const stops = openDeviations(plan);
  if (stops.length > 0) open.push(`a deviation is open (Deviations row ${stops.map((d) => d.n).join(', ')}): the owner decides it first (burhan deviation resolve ${s})`);
  const all = units(plan);
  if (all.length === 0) open.push('the plan has no sub-unit heading that is read');
  else { const notReviewed = all.filter((u) => u.rung !== 4).map((u) => `Sub-unit ${u.n}`); if (notReviewed.length > 0) open.push(`not every sub-unit is Reviewed: ${notReviewed.join(', ')}`); }

  const needs = routeNeeds(planRoute(plan));
  const lines = plan.split('\n');
  const inFence = fenced(lines);
  const start = lines.findIndex((l, i) => !inFence[i] && /^## Gate checklist\s*$/.test(l.replace(/\r$/, '')));
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  const gates: string[] = [];
  let boxes = 0;
  if (start !== -1) {
    for (let i = start + 1; i < (end === -1 ? lines.length : end); i++) {
      const m = inFence[i] ? null : /^[ \t]*- \[([ xX])\][ \t]+(.*)$/.exec(lines[i]!.replace(/\r$/, ''));
      if (!m) continue;
      boxes++;
      const text = m[2]!;
      // These come after Completed: QC, the knowledge review, Close-out. "Story approved" only where the route has a story.
      if (m[1] !== ' ' || /^(Close-out|QC|Knowledge review)/i.test(text) || (/^Story approved/i.test(text) && !needs.story)) continue;
      gates.push(`"${text.slice(0, 40)}"`);
    }
  }
  if (start === -1 || boxes === 0) open.push('the plan has no gate checklist that is read ("## Gate checklist" with "- [ ]" lines)');
  if (gates.length > 0) open.push(`gates still open: ${gates.join(', ')}`);
  if (open.length > 0) throw new BurhanError(`cannot finish ${s}: ${open.join('; ')}`);

  // The proof: a passing, unpiped evidence command after the item's last code edit, from the ledger. A pattern that is empty or does not compile never
  // turns the requirement off: every edit then counts as code, and a proof cannot be recognised. Records under no item may be this item's, so they count.
  const values = readProjectConfig(project).values;
  const code = regex(values.WF_CODE_REGEX);
  const proof = regex(values.WF_EVIDENCE_REGEX);
  const recs = readLedger(target, o.env ?? process.env).filter((r) => r.item === s || !r.item || r.item === '-');
  const edits = recs.map((r, i) => (r.kind === 'edit' && r.file !== undefined && (code === null || code.test(r.file)) ? i : -1)).filter((i) => i >= 0);
  let stateNote = '';
  let say = '';
  if (edits.length === 0) say = ' (no code edit of this item is in the ledger, so no proof was asked for)';
  else {
    const last = edits[edits.length - 1]!;
    const shown = proof !== null && recs.some((r, i) => i > last && r.kind === 'cmd' && r.status === 'ok' && !isPiped(r.cmd ?? '') && evidenceMatches(proof, r.cmd ?? ''));
    if (!shown) {
      if (stated === '') {
        const unusable = code === null || proof === null ? ` WF_CODE_REGEX or WF_EVIDENCE_REGEX is empty or not usable, so every edit counts as code and a proof cannot be recognised.` : '';
        throw new BurhanError(`cannot finish ${s}: no passing proof after the last code edit (${recs[last]!.file}) in the evidence ledger.${unusable} The ledger is written at the end of a turn, so a proof run in this turn is not in it yet: end the turn and finish in the next one, or pass --evidence "<what shows it>" (recorded as stated, not proven)`);
      }
      stateNote = ` · stated evidence: ${stated}`;
      say = ' (evidence stated, not proven by the ledger)';
    }
  }
  const updated = setFieldLine(plan, 'Overall status', `Completed${stateNote}`);
  if (updated === null) throw new BurhanError('the plan has no **Overall status:** line that is read: run burhan item check');
  assertInside(project, path);
  putFile(path, updated);
  io.stdout(`item finish: ${s} is Completed${say}\n`);
  io.stdout('next: update the item block in the state file (a transition), then QC or close-out as the route says\n');
  return 0;
}
