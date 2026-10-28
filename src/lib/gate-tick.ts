import { join } from 'node:path';
import type { Io } from '../main.js';
import { checkText, storyIsApproved } from '../hooks/core/item-contract.mjs';
import { BurhanError } from './errors.js';
import { putFile, realTarget } from './fs-safe.js';
import { fenced, itemFolder, openDeviations, overallStatus, qcVerdict, planPath, planRoute, readOr, routeNeeds, units } from './item-files.js';
import { assertInside, oneLine } from './item-io.js';
import { latestQcFile } from './items.js';
import { docsLocation } from './status.js';

interface Ctx { plan: string; story: string | null; dir: string; slug: string }
/** A machine check returns why the gate cannot be ticked, or null when its evidence exists. */
type Check = (c: Ctx) => string | null;

/** The ids of the story's material questions that have no answer. */
export function openMaterial(story: string): string[] {
  return story.split('\n').filter((l) => /^\|[ \t]*Q-\d+/.test(l)).map((l) => l.split('|').slice(1, -1).map((x) => x.trim())).filter((cells) => cells[2]?.toLowerCase() === 'yes' && (cells[4] ?? '') === '').map((cells) => cells[0]!);
}

/** The plan text with the first gate box matching `pattern` ticked (no check: the caller has just made the evidence true). */
export function tickMatching(plan: string, pattern: RegExp): string {
  const lines = plan.split('\n');
  const inFence = fenced(lines);
  const at = lines.findIndex((l, i) => !inFence[i] && /^[ \t]*- \[ \][ \t]+/.test(l) && pattern.test(l.replace(/^[ \t]*- \[ \][ \t]+/, '')));
  if (at !== -1) lines[at] = lines[at]!.replace('- [ ]', '- [x]');
  return lines.join('\n');
}

const CHECKS: Array<[RegExp, Check]> = [
  [/^Route stated/i, (c) => (/^- \*\*Route:\*\* (feature|bug|investigation|change|refactor|release) \/ (spike|bounded|architectural|patch)(?: ·|$)/m.test(c.plan) ? null : 'the plan has no exact **Route:** "<type> / <scope>"')],
  [/^Story approved/i, (c) => (c.story !== null && storyIsApproved(c.story) ? null : 'the story is not Approved in the form "Approved — <name> · YYYY-MM-DD"')],
  [/^No open material question/i, (c) => { const open = openMaterial(c.story ?? ''); return open.length === 0 ? null : `material questions without an answer: ${open.join(', ')}`; }],
  [/^Plan approved/i, (c) => { const s = overallStatus(c.plan); return s === 'Approved' || s === 'In progress' || s === 'Completed' ? null : `the plan is ${s ?? 'without a status'}, not Approved`; }],
  [/^No open deviation/i, (c) => { const o = openDeviations(c.plan); return o.length === 0 ? null : `Deviations row ${o.map((d) => d.n).join(', ')} is open: the owner decides it first (burhan deviation resolve)`; }],
  [/^Per sub-unit: review done/i, (c) => {
    const all = units(c.plan);
    if (all.length === 0) return 'the plan has no sub-unit heading that is read (burhan item check)';
    const open = all.filter((u) => u.rung !== 4).map((u) => `Sub-unit ${u.n}`);
    return open.length === 0 ? null : `not every sub-unit is Reviewed: ${open.join(', ')}`;
  }],
  [/^Real verification/i, (c) => {
    const text = readOr(join(c.dir, 'reviews', `${c.slug}-verification.md`));
    if (text === null) return `reviews/${c.slug}-verification.md does not exist`;
    const faults = checkText('verification', text);
    return faults.length === 0 ? null : `the verification file has a fault: ${faults[0]!.code}`;
  }],
  [/^QC/i, (c) => {
    const text = readOr(latestQcFile(c.dir, c.slug));
    if (text === null) return 'there is no QC report';
    const faults = checkText('qc', text);
    if (faults.length > 0) return `the QC report has a fault: ${faults[0]!.code}`;
    return qcVerdict(text) === 'PASS' ? null : 'the QC verdict is not PASS';
  }],
];

/** `burhan gate tick <slug> <gate> [--evidence <text>]`: ticks a box of the plan's gate checklist. A gate with a machine check is ticked only when
 *  its evidence exists; any other gate needs --evidence, which is written on the line. A box is never unticked here. */
export function gateTick(target: string, slug: string | undefined, gate: string | undefined, io: Io, o: { evidence?: string; docs?: string } = {}): number {
  const project = realTarget(target);
  const { slug: s, dir } = itemFolder(docsLocation(target, o.docs).abs, slug, 'gate tick');
  const path = planPath(dir, s);
  const plan = readOr(path);
  if (plan === null) throw new BurhanError(`item "${s}" has no implementation plan`);
  if (gate === undefined || gate === '') throw new BurhanError('gate tick needs a gate: its number or a fragment of its text');

  const evidence = oneLine(o.evidence, '--evidence');
  const lines = plan.split('\n');
  const inFence = fenced(lines);
  const start = lines.findIndex((l, i) => !inFence[i] && /^## Gate checklist\s*$/.test(l.replace(/\r$/, '')));
  if (start === -1) throw new BurhanError('the plan has no "## Gate checklist" section: run burhan item check');
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  const boxes: Array<{ line: number; ticked: boolean; text: string }> = [];
  for (let i = start + 1; i < (end === -1 ? lines.length : end); i++) {
    const m = inFence[i] ? null : /^[ \t]*- \[([ xX])\][ \t]+(.*)$/.exec(lines[i]!.replace(/\r$/, ''));
    if (m) boxes.push({ line: i, ticked: m[1] !== ' ', text: m[2]! });
  }
  let pick: typeof boxes;
  if (/^\d+$/.test(gate)) pick = boxes.slice(Number(gate) - 1, Number(gate)).filter(Boolean);
  else pick = boxes.filter((b) => b.text.toLowerCase().includes(gate.toLowerCase()));
  if (pick.length === 0) throw new BurhanError(`no gate matches "${gate}"`);
  if (pick.length > 1) throw new BurhanError(`more than one gate matches "${gate}": ${pick.map((b) => `"${b.text.slice(0, 40)}"`).join(', ')}`);
  const box = pick[0]!;
  if (box.ticked) { io.stdout(`gate tick: already ticked: ${box.text.slice(0, 60)}\n`); return 0; }

  const check = CHECKS.find(([re]) => re.test(box.text));
  const needs = routeNeeds(planRoute(plan));
  const notNeeded = (/^QC/i.test(box.text) && !needs.qc) || (/^Knowledge review/i.test(box.text) && !needs.knowledge) || (/^Story approved/i.test(box.text) && !needs.story);
  if (notNeeded) {
    if (!/^not needed:\s*\S/i.test(evidence)) throw new BurhanError(`this route does not need "${box.text.slice(0, 40)}": tick it with --evidence "not needed: <why>"`);
  } else if (check !== undefined) {
    const why = check[1]({ plan, story: readOr(join(dir, `${s}-story.md`)), dir, slug: s });
    if (why !== null) throw new BurhanError(`cannot tick "${box.text.slice(0, 40)}": ${why}`);
  } else if (evidence === '') {
    throw new BurhanError(`nothing can check "${box.text.slice(0, 40)}": say what shows it with --evidence "<text>"`);
  }
  const eol = lines[box.line]!.endsWith('\r') ? '\r' : '';
  lines[box.line] = lines[box.line]!.replace(/\r$/, '').replace('- [ ]', '- [x]') + (evidence === '' ? '' : ` — ${evidence}`) + eol;
  assertInside(project, path);
  putFile(path, lines.join('\n'));
  io.stdout(`gate tick: ticked "${box.text.slice(0, 60)}"${check === undefined ? ' (evidence given)' : ''}\n`);
  return 0;
}
