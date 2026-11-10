import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { acceptedForm, deviationCell, fenced, rowCells } from '../hooks/core/item-model.mjs';
import { readOr, reviewHeadingUnits } from './item-files.js';

export type Severity = 'Critical' | 'Important' | 'Minor';
export type Decision = 'fixed' | 'discovery' | 'accepted';
export type Kind = 'review' | 'qc';
export const SEVERITIES: Severity[] = ['Critical', 'Important', 'Minor'];
export const NONE_LINE = 'No findings.';
/** The findings table: one shape for a review section and for a QC report (kit/templates/review.md, qc.md). */
export const TABLE_HEAD = ['| # | Severity | Finding (file:line) | Decision | Pointer or reason | Decided by |', '|---|----------|---------------------|----------|-------------------|------------|'];
/** The plan line `burhan item new` writes: an item with it must have every finding decided before `item finish`. A plan without it is old and not gated. */
export const GATE_LINE = '- **Findings gate:** on';

export interface Finding { id: number; severity: Severity; text: string; decision: Decision | ''; pointer: string; by: string; kind: Kind; file: string; line: number; where: string; spec: string }
export interface Problem { file: string; line: number; message: string }
/** One review section (`## Sub-unit N …`) or one QC report. `heading` is the section's heading line (−1 for a QC report: the whole file), `end` the line after its last line (0-based indexes). */
export interface Scope { kind: Kind; file: string; where: string; spec: string; units: number[]; heading: number; end: number; state: 'table' | 'none' | 'missing'; findings: Finding[]; problems: Problem[]; superseded: boolean; badIds?: number[] }
export interface ItemFindings { scopes: Scope[]; findings: Finding[]; problems: Problem[]; maxId: number }

/** Does the plan carry the line `- **Findings gate:** on` (outside a code fence)? */
export function findingsGated(plan: string): boolean {
  const lines = plan.split('\n');
  const inFence = fenced(lines);
  return lines.some((l, i) => !inFence[i] && /^- \*\*Findings gate:\*\*[ \t]*on[ \t]*\r?$/.test(l));
}

const FINDINGS_HEAD = /^#{2,6}[ \t]+(?:\d+\.[ \t]+)?Findings[ \t]*$/;

/** The first `Findings` heading of lines [from, to) outside a fence, and the line where its region ends (the next heading of any level, or `to`). */
function region(lines: string[], inFence: boolean[], from: number, to: number): { head: number; end: number } | null {
  for (let i = from; i < to; i++) {
    if (inFence[i] || !FINDINGS_HEAD.test(lines[i]!.replace(/\r$/, ''))) continue;
    let end = to;
    for (let j = i + 1; j < to; j++) if (!inFence[j] && /^#{1,6}[ \t]/.test(lines[j]!)) { end = j; break; }
    return { head: i, end };
  }
  return null;
}

const words = (s: string): number => s.split(/\s+/).filter((w) => w !== '').length;

/** The rows, the `No findings.` line and the malformed rows of one region. A table with a header and no row is `missing`: it says nothing. */
function readRegion(c: { kind: Kind; file: string; where: string; spec: string }, lines: string[], r: { head: number; end: number }): Pick<Scope, 'state' | 'findings' | 'problems' | 'badIds'> {
  const findings: Finding[] = [];
  const badIds: number[] = []; // the number of a malformed row is still taken: a new finding must not reuse it
  const problems: Problem[] = [];
  let none = false;
  for (let i = r.head + 1; i < r.end; i++) {
    const raw = lines[i]!.replace(/\r$/, '').trim();
    if (raw === NONE_LINE) { none = true; continue; }
    const cells = rowCells(raw);
    if (cells === null || (cells[0] ?? '') === '#' || cells.every((x) => /^:?-+:?$/.test(x) || x === '')) continue;
    const bad = (message: string): void => { problems.push({ file: c.file, line: i + 1, message }); };
    if (cells.length !== 6) { bad(`a finding row has ${cells.length} cells, not 6 (# | Severity | Finding | Decision | Pointer or reason | Decided by)`); continue; }
    const [id = '', sev = '', text = '', dec = '', pointer = '', by = ''] = cells;
    if (/^[1-9]\d{0,5}$/.test(id)) badIds.push(Number(id));
    const severity = SEVERITIES.find((s) => s.toLowerCase() === sev.toLowerCase());
    const decision = dec.toLowerCase();
    if (!/^[1-9]\d{0,5}$/.test(id)) { bad(`the # cell "${id}" is not a whole number from 1 to 999999`); continue; }
    if (severity === undefined) { bad(`finding ${id}: the severity "${sev}" is not Critical, Important or Minor`); continue; }
    if (text === '') { bad(`finding ${id} has no text`); continue; }
    if (decision !== '' && decision !== 'fixed' && decision !== 'discovery' && decision !== 'accepted') { bad(`finding ${id}: the decision "${dec}" is not fixed, discovery or accepted`); continue; }
    if (decision !== '') {
      if (pointer === '') { bad(`finding ${id}: the decision ${decision} has no pointer or reason`); continue; }
      if (!acceptedForm(by)) { bad(`finding ${id}: Decided by is not "<name> · YYYY-MM-DD": "${by}"`); continue; }
      if (severity === 'Critical' && decision === 'accepted') { bad(`finding ${id} is Critical and cannot be accepted: it is fixed, or a discovery for code this item did not change`); continue; }
    }
    findings.push({ id: Number(id), severity, text, decision: decision as Decision | '', pointer, by, kind: c.kind, file: c.file, line: i + 1, where: c.where, spec: c.spec });
  }
  const state = findings.length > 0 || problems.length > 0 ? 'table' : none ? 'none' : 'missing';
  return { state, findings, problems, badIds };
}

const eachLine = (text: string): { lines: string[]; inFence: boolean[] } => { const lines = text.split('\n'); return { lines, inFence: fenced(lines) }; };

/** The sections of a review file, one per `Sub-unit N …` or `Sub-units A–B …` heading of level 2 to 4 (the same headings `item set reviewed` looks for). A section is `superseded` when a later one names a sub-unit of it (a re-review). */
export function reviewScopes(file: string, text: string): Scope[] {
  const { lines, inFence } = eachLine(text);
  const out: Scope[] = [];
  for (let start = 0; start < lines.length; start++) {
    if (inFence[start] || !/^#{2,4}[ \t]/.test(lines[start]!)) continue;
    const units = reviewHeadingUnits(lines[start]!.replace(/\r$/, ''));
    if (units.length === 0) continue;
    const depth = /^#+/.exec(lines[start]!)![0].length;
    let end = lines.length;
    for (let j = start + 1; j < lines.length; j++) if (!inFence[j] && new RegExp(`^#{1,${depth}}[ \\t]`).test(lines[j]!)) { end = j; break; }
    const where = `review Sub-unit${units.length > 1 ? 's' : ''} ${units.join(', ')}`;
    const c = { kind: 'review' as const, file, where, spec: `review:${units[0]}` };
    const r = region(lines, inFence, start + 1, end);
    out.push({ ...c, units, heading: start, end, superseded: false, ...(r === null ? { state: 'missing' as const, findings: [], problems: [] } : readRegion(c, lines, r)) });
  }
  out.forEach((s, i) => { s.superseded = out.slice(i + 1).some((later) => later.units.some((n) => s.units.includes(n))); });
  return out;
}

/** A QC report: the whole file is one scope. `round` 1 is `<slug>-qc.md`. */
export function qcScope(file: string, text: string, round: number): Scope {
  const { lines, inFence } = eachLine(text);
  const c = { kind: 'qc' as const, file, where: round === 1 ? 'QC' : `QC round ${round}`, spec: round === 1 ? 'qc' : `qc:${round}` };
  const r = region(lines, inFence, 0, lines.length);
  return { ...c, units: [], heading: -1, end: lines.length, superseded: false, ...(r === null ? { state: 'missing' as const, findings: [], problems: [] } : readRegion(c, lines, r)) };
}

/** Every finding of the item: its review file, then each QC report in round order. A second row with an id already used is a problem, not a finding. */
export function readItemFindings(dir: string, slug: string): ItemFindings {
  const scopes: Scope[] = [];
  const review = readOr(join(dir, 'reviews', `${slug}-review.md`));
  if (review !== null) scopes.push(...reviewScopes(`reviews/${slug}-review.md`, review));
  let names: string[] = [];
  try { names = readdirSync(join(dir, 'reviews')); } catch { /* no reviews yet */ }
  const esc = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rounds = names.map((n) => ({ n, m: new RegExp(`^${esc}-qc(?:-r(\\d+))?\\.md$`).exec(n) })).filter((x) => x.m !== null).map((x) => ({ n: x.n, round: Number(x.m![1] ?? 1) })).sort((a, b) => a.round - b.round);
  for (const q of rounds) {
    const text = readOr(join(dir, 'reviews', q.n));
    if (text !== null) scopes.push(qcScope(`reviews/${q.n}`, text, q.round));
  }
  const findings: Finding[] = [];
  const problems: Problem[] = [];
  const seen = new Set<number>();
  let maxId = 0;
  for (const s of scopes) {
    problems.push(...s.problems);
    for (const b of s.badIds ?? []) maxId = Math.max(maxId, b);
    for (const f of s.findings) {
      maxId = Math.max(maxId, f.id);
      if (seen.has(f.id)) { problems.push({ file: f.file, line: f.line, message: `finding ${f.id}: the number is used twice in this item (each finding has its own number)` }); continue; }
      seen.add(f.id);
      findings.push(f);
    }
  }
  return { scopes, findings, problems, maxId };
}

export interface Gate { undecided: Finding[]; problems: Problem[]; missing: Scope[]; noSection: number[] }
/** What stops the step: `review` gates `item finish` (every Reviewed sub-unit has a section, every section a table or `No findings.`), `qc` gates `approve qc` (every QC report). */
export function gateOf(f: ItemFindings, kind: Kind, reviewed: number[] = []): Gate {
  const mine = f.scopes.filter((s) => s.kind === kind);
  const files = new Set(mine.map((s) => s.file));
  return {
    undecided: f.findings.filter((x) => x.kind === kind && x.decision === ''),
    problems: f.problems.filter((p) => files.has(p.file)),
    missing: mine.filter((s) => s.state === 'missing' && !s.superseded),
    noSection: kind === 'review' ? reviewed.filter((n) => !mine.some((s) => s.units.includes(n))) : [],
  };
}
export const gateOpen = (g: Gate): number => g.undecided.length + g.problems.length + g.missing.length + g.noSection.length;

/** The one sentence a refusal gives: what is open and the command that shows the question. */
export function gateSentence(slug: string, g: Gate): string {
  const parts: string[] = [];
  if (g.undecided.length > 0) parts.push(`${g.undecided.length} without a decision (${g.undecided.map((x) => `#${x.id} ${x.severity}`).join(', ')})`);
  for (const p of g.problems) parts.push(`malformed row ${p.file}:${p.line} (${p.message})`);
  for (const s of g.missing) parts.push(`${s.where} (${s.file}) has neither a findings table nor "${NONE_LINE}" (burhan finding add ${slug} --in ${s.spec} --none, or one row per finding)`);
  if (g.noSection.length > 0) parts.push(`${g.noSection.map((n) => `Sub-unit ${n}`).join(', ')} ha${g.noSection.length > 1 ? 've' : 's'} no review section`);
  return `findings are not all decided: ${parts.join('; ')} (burhan finding list ${slug} puts the question to the owner; the owner decides, never --evidence)`;
}

// ---- writers: pure text in, text out ----------------------------------------------------------------------------------------------

/** A cell of a finding row on one line: line ends become a space and a pipe is escaped. */
export const cell = deviationCell;

export const rowLine = (r: { id: number; severity: string; text: string; decision?: string; pointer?: string; by?: string }): string =>
  `| ${r.id} | ${r.severity} | ${cell(r.text)} | ${r.decision ?? ''} | ${cell(r.pointer ?? '')} | ${cell(r.by ?? '')} |`;

type Where = Pick<Scope, 'kind' | 'heading' | 'end'>;
const level = (s: Where, lines: string[]): string => (s.kind === 'qc' ? '##' : '#'.repeat(Math.min(6, /^#+/.exec(lines[s.heading]!)![0].length + 1)));

/** The text with one more row in the section's findings table. With no `Findings` heading yet, one is made at the end of the section; a `No findings.` line is replaced by the table. */
export function addRow(text: string, scope: Where, row: string): string {
  const crlf = text.includes('\r\n');
  const mark = (s: string): string => (crlf ? `${s}\r` : s);
  const { lines, inFence } = eachLine(text);
  const r = region(lines, inFence, scope.heading + 1, scope.end);
  if (r === null) {
    let at = scope.end;
    while (at - 1 > scope.heading && lines[at - 1]!.trim() === '') at--;
    lines.splice(at, 0, ...['', `${level(scope, lines)} Findings`, '', ...TABLE_HEAD, row].map(mark));
    return lines.join('\n');
  }
  let last = -1;
  let noneAt = -1;
  for (let i = r.head + 1; i < r.end; i++) {
    const t = lines[i]!.replace(/\r$/, '').trim();
    if (t.startsWith('|')) last = i;
    else if (t === NONE_LINE) noneAt = i;
  }
  if (last !== -1) lines.splice(last + 1, 0, mark(row));
  else if (noneAt !== -1) lines.splice(noneAt, 1, ...(lines[noneAt - 1]!.trim() === '' ? [] : ['']).concat(...TABLE_HEAD, row).map(mark));
  else lines.splice(r.head + 1, 0, ...['', ...TABLE_HEAD, row].map(mark));
  return lines.join('\n');
}

/** The text with `No findings.` in the section's findings region (a heading is made when there is none). */
export function addNone(text: string, scope: Where): string {
  const crlf = text.includes('\r\n');
  const mark = (s: string): string => (crlf ? `${s}\r` : s);
  const { lines, inFence } = eachLine(text);
  const r = region(lines, inFence, scope.heading + 1, scope.end);
  if (r === null) {
    let at = scope.end;
    while (at - 1 > scope.heading && lines[at - 1]!.trim() === '') at--;
    lines.splice(at, 0, ...['', `${level(scope, lines)} Findings`, '', NONE_LINE].map(mark));
  } else lines.splice(r.head + 1, 0, ...['', NONE_LINE].map(mark));
  return lines.join('\n');
}

/** The text with the finding on 1-based `line` decided. */
export function withDecision(text: string, f: Pick<Finding, 'id' | 'severity' | 'text' | 'line'>, decision: Decision, pointer: string, by: string): string {
  const lines = text.split('\n');
  const old = lines[f.line - 1]!;
  lines[f.line - 1] = rowLine({ id: f.id, severity: f.severity, text: f.text, decision, pointer, by }) + (old.endsWith('\r') ? '\r' : '');
  return lines.join('\n');
}
