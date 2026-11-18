import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Io } from '../main.js';
import { formatClosedLine, isOutcome, OUTCOMES, parseClosedLine } from '../hooks/core/state-lines.mjs';
import { readProjectConfig } from './config.js';
import { BurhanError } from './errors.js';
import { putFile, realTarget } from './fs-safe.js';
import { tickCloseOut } from './gate-tick.js';
import { assertInside, isSlug, SLUG_RULE } from './item-io.js';
import { ambiguous, itemFolder, planPath, readOr } from './item-files.js';
import { readItem } from './items.js';
import { matchItem } from '../hooks/core/item-id.mjs';
import { editStateFile } from './state-write.js';
import { docsLocation } from './status.js';

const NOW = /^##\s+Now\s*$/;
const CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f]/; // a tab is allowed; a line break or any other control character is not
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Parts { lines: string[]; ends: string[] } // each line and, apart, its own ending: a changed line keeps its ending
function split(text: string): Parts {
  const parts = text.split(/(\r?\n)/);
  return { lines: parts.filter((_, i) => i % 2 === 0), ends: parts.filter((_, i) => i % 2 === 1) };
}
const joinParts = ({ lines, ends }: Parts): string => lines.map((l, i) => l + (ends[i] ?? '')).join('');

/** The heading and the last non-blank line of the `### <slug>` block under "## Now"; a block ends at the next `##` or `###` heading (`####` stays inside). */
function blockRange(lines: string[], slug: string): { head: number; last: number } | null {
  const now = lines.findIndex((l) => NOW.test(l));
  if (now === -1) return null;
  const heading = new RegExp(`^###\\s+${esc(slug)}(?![\\w.-])`);
  for (let i = now + 1; i < lines.length && !/^##\s/.test(lines[i]!); i++) {
    if (!heading.test(lines[i]!)) continue;
    let end = i + 1;
    while (end < lines.length && !/^#{2,3}\s/.test(lines[end]!)) end++;
    let last = end - 1;
    while (last > i && lines[last]!.trim() === '') last--;
    return { head: i, last };
  }
  return null;
}
const noBlock = (slug: string, where: string): BurhanError => new BurhanError(`there is no "### ${slug}" block under "## Now" in ${where}`);

/** The slugs of the `### ` blocks under Now, in order. */
export function nowSlugs(text: string): string[] {
  const { lines } = split(text);
  const now = lines.findIndex((l) => NOW.test(l));
  const out: string[] = [];
  if (now === -1) return out;
  for (let i = now + 1; i < lines.length && !/^##\s/.test(lines[i]!); i++) { const m = /^###\s+(\S+)/.exec(lines[i]!); if (m) out.push(m[1]!); }
  return out;
}

/** The ids of the `### ` blocks under Now: the run of letters, digits, `.`, `_` and `-` after the marks (what the block matching reads). */
export function headingIds(text: string): string[] {
  const { lines } = split(text);
  const now = lines.findIndex((l) => NOW.test(l));
  const out: string[] = [];
  if (now === -1) return out;
  for (let i = now + 1; i < lines.length && !/^##\s/.test(lines[i]!); i++) { const m = /^###\s+([A-Za-z0-9._-]+)/.exec(lines[i]!); if (m) out.push(m[1]!); }
  return out;
}

/** The heading an argument (the full id, the number or the plain slug) names under Now: none is the no-block error, several are refused with the candidates. */
function headingFor(text: string, arg: string, where: string): string {
  const m = matchItem(arg, headingIds(text));
  if (m.kind === 'many') throw ambiguous(arg, m);
  if (m.kind === 'none') throw noBlock(arg, where);
  return m.id;
}

/** The block's lines (heading to last non-blank line), or null. */
export function showBlock(text: string, slug: string): string | null {
  const { lines } = split(text);
  const r = blockRange(lines, slug);
  return r === null ? null : lines.slice(r.head, r.last + 1).join('\n');
}

/** Replace the line that starts `- **<label>:**` in the block, or add it after the block's last non-blank line. Nothing else changes. */
export function setBlockLine(text: string, slug: string, label: string, value: string, seen?: { added: boolean }): string {
  const parts = split(text);
  const r = blockRange(parts.lines, slug);
  if (r === null) throw noBlock(slug, 'the state file');
  const prefix = `- **${label}:**`;
  const line = `${prefix} ${value}`;
  if (seen !== undefined) seen.added = false;
  for (let i = r.head + 1; i <= r.last; i++) if (parts.lines[i]!.startsWith(prefix)) { parts.lines[i] = line; return joinParts(parts); }
  if (seen !== undefined) seen.added = true;
  const ending = parts.ends[r.last];
  if (ending === undefined) { parts.ends[r.last] = text.includes('\r\n') ? '\r\n' : '\n'; parts.lines.splice(r.last + 1, 0, line); } // the block ends the file with no line ending
  else { parts.lines.splice(r.last + 1, 0, line); parts.ends.splice(r.last + 1, 0, ending); }
  return joinParts(parts);
}

/** Replace the whole block with one line. */
export function closeBlock(text: string, slug: string, closed: string): string {
  const parts = split(text);
  const r = blockRange(parts.lines, slug);
  if (r === null) throw noBlock(slug, 'the state file');
  parts.lines.splice(r.head, r.last - r.head + 1, closed);
  parts.ends.splice(r.head, r.last - r.head);
  return joinParts(parts);
}

function statePathOf(target: string): { project: string; stateRel: string; statePath: string } {
  const project = realTarget(target);
  const stateRel = readProjectConfig(project).values.WF_STATE_FILE || '.burhan/local/PROGRESS.md';
  const statePath = join(project, stateRel);
  if (!existsSync(statePath) || !statSync(statePath).isFile()) throw new BurhanError(`there is no state file at ${stateRel}`);
  assertInside(project, statePath);
  return { project, stateRel, statePath };
}
const checkSlug = (slug: string): void => { if (!isSlug(slug)) throw new BurhanError(`"${slug}" is not an item slug (${SLUG_RULE})`); };

const INTAKE_LINE = /^- Created by `burhan item new`; fill /;
const NEXT_ACTION = '- **Next action:**';

/** The index of the intake line `burhan item new` wrote in the block (`- Created by \`burhan item new\`; fill the story next, …`), or -1. It is true until the story is approved. */
function intakeAt(parts: Parts, r: { head: number; last: number }): number {
  for (let i = r.head + 1; i <= r.last; i++) if (INTAKE_LINE.test(parts.lines[i]!)) return i;
  return -1;
}

/** Remove one line and its own ending; the line that ends the file has none, so the one before it gives up its ending instead. */
function removeLine(parts: Parts, i: number): void {
  parts.lines.splice(i, 1);
  parts.ends.splice(i === parts.lines.length ? i - 1 : i, 1);
}

/** The text with the block's intake line removed and nothing else changed; the same text when the block has none. */
export function dropIntakeLine(text: string, slug: string): string {
  const parts = split(text);
  const r = blockRange(parts.lines, slug);
  if (r === null) return text;
  const at = intakeAt(parts, r);
  if (at === -1) return text;
  removeLine(parts, at);
  return joinParts(parts);
}

/** After the story is approved: the intake line becomes a `**Next action:**` line with `next`; a block that already has a `**Next action:**` line only loses the intake line.
 *  null when the block has no intake line (nothing to change). */
export function retireIntakeLine(text: string, slug: string, next: string): string | null {
  const parts = split(text);
  const r = blockRange(parts.lines, slug);
  if (r === null) return null;
  const at = intakeAt(parts, r);
  if (at === -1) return null;
  const has = parts.lines.slice(r.head + 1, r.last + 1).some((l) => l.startsWith(NEXT_ACTION));
  if (has) removeLine(parts, at); else parts.lines[at] = `${NEXT_ACTION} ${next}`;
  return joinParts(parts);
}

/** After `burhan approve story`: the item's block stops saying "fill the story next". Best effort and never a failure: the approval is already written, so a missing state file or block
 *  (nothing to change) gives null, and any other problem gives a sentence that says what to run instead. Returns the sentence to print, or null. */
export function retireIntakeFor(target: string, slug: string): string | null {
  try {
    const { stateRel, statePath } = statePathOf(target);
    const next = `run \`burhan guide ${slug}\`: it names the next step`;
    const result = editStateFile(statePath, (text) => {
      const m = matchItem(slug, headingIds(text));
      return m.kind === 'one' ? retireIntakeLine(text, m.id, next) : null;
    }, { label: stateRel });
    return result === 'written' ? `state: the intake line of "### ${slug}" no longer sits in ${stateRel}; its Next action line says what comes next` : null;
  } catch (e) {
    const why = (e as Error).message;
    return /^there is no state file/.test(why) ? null : `state: the intake line of "### ${slug}" was not changed (${why}); run burhan state set ${slug} "Next action" "<text>"`;
  }
}

/** True when the state file has exactly one `### ` block that the argument names; false with no state file, no such block or more than one. Reads only. */
export function hasStateBlock(target: string, arg: string): boolean {
  try { return matchItem(arg, headingIds(readFileSync(statePathOf(target).statePath, 'utf8'))).kind === 'one'; } catch { return false; }
}

/** `burhan state show [<slug>]`: reads, writes nothing, takes no lock. */
export function stateShow(target: string, slug: string | undefined, io: Io): number {
  const { stateRel, statePath } = statePathOf(target);
  const text = readFileSync(statePath, 'utf8');
  if (slug === undefined) {
    const slugs = nowSlugs(text);
    io.stdout(slugs.length === 0 ? `state show: no "### " block under Now in ${stateRel}\n` : `${slugs.join('\n')}\n`);
    return 0;
  }
  checkSlug(slug);
  const block = showBlock(text, headingFor(text, slug, stateRel));
  if (block === null) throw noBlock(slug, stateRel);
  io.stdout(`${block}\n`);
  return 0;
}

/** `burhan state set <slug> <Label> <value>`: changes one line of that item's block under the lock. */
export function stateSet(target: string, slug: string, label: string, value: string, io: Io): number {
  checkSlug(slug);
  if (label.trim() === '' || label !== label.trim() || /[*:]/.test(label) || CONTROL.test(label)) throw new BurhanError('the label must be plain text: not empty, with no "*", ":" or line break');
  if (value.trim() === '') throw new BurhanError('the value is empty: write the text of the line');
  if (CONTROL.test(value)) throw new BurhanError('the value holds a line break or another control character: a line is one line');
  const { stateRel, statePath } = statePathOf(target);
  const seen = { added: false };
  let id = slug;
  let dropped = false;
  const result = editStateFile(statePath, (text) => {
    id = headingFor(text, slug, stateRel);
    const set = setBlockLine(text, id, label, value, seen);
    const out = label === 'Next action' ? dropIntakeLine(set, id) : set; // the intake line names a step that is no longer the current one
    dropped = out !== set;
    return out;
  }, { label: stateRel });
  io.stdout(result === 'unchanged' ? `state set: ${id} · ${label} already has that value in ${stateRel}\n` : `state set: ${id} · ${label} ${seen.added ? 'added' : 'changed'} in ${stateRel}\n`);
  if (dropped) io.stdout('  the intake line "Created by burhan item new; fill the story next" is gone: it names a step that is no longer the current one\n');
  return 0;
}

/** Outcomes that end an item as done: only these tick the plan's Close-out box. `Paused`, `Superseded` and any label added later leave it open. */
const TICKS_CLOSE_OUT: readonly string[] = ['QC PASS', 'Done (no QC)'];
const CLOSE_OUT_EVIDENCE = 'closed line in the state file (burhan state close)';

/** After the closed line is written: ticks the plan's Close-out box and returns the one output line. It is a side effect of a close that already
 *  succeeded: it never throws and never undoes the closed line. The plan is read again here, just before its write. */
function tickPlanBox(project: string, dir: string, id: string, outcome: string): string {
  if (!TICKS_CLOSE_OUT.includes(outcome)) return `the Close-out box stays open: ${outcome} does not tick it (only QC PASS and Done (no QC) do)`;
  try {
    const path = planPath(dir, id);
    const plan = readOr(path);
    if (plan === null) return `the Close-out box was not ticked: ${id} has no implementation plan file`;
    const r = tickCloseOut(plan, CLOSE_OUT_EVIDENCE);
    if (r.kind === 'already') return 'the Close-out box was already ticked: left as it is';
    if (r.kind === 'absent') return `the Close-out box was not ticked: ${r.why}`;
    assertInside(project, path);
    putFile(path, r.plan);
    return 'the Close-out box is ticked';
  } catch (e) {
    return `the Close-out box was not ticked: ${String((e as Error).message).split('\n')[0]}; run: burhan gate tick ${id} "Close-out" --evidence "<text>"`;
  }
}

/** `burhan state close <slug> --outcome <o> --commit <id> --folder <path>`: the block becomes the one closed line of the fixed shape. */
export function stateClose(target: string, slug: string, o: { outcome?: string; commit?: string; folder?: string; docs?: string }, io: Io): number {
  checkSlug(slug);
  if (o.outcome === undefined || o.commit === undefined || o.folder === undefined) throw new BurhanError('state close needs --outcome, --commit and --folder');
  if (!isOutcome(o.outcome)) throw new BurhanError(`--outcome "${o.outcome}" is not one of ${OUTCOMES.join(', ')}`);
  if (CONTROL.test(o.commit) || CONTROL.test(o.folder)) throw new BurhanError('--commit and --folder hold a line break or another control character');
  const { project, stateRel, statePath } = statePathOf(target);
  const { slug: id, dir } = itemFolder(docsLocation(project, o.docs).abs, slug, 'state close'); // "has no folder": the route cannot be read without it
  const item = readItem(dir, id, project);
  if (item.typeScope === '—') throw new BurhanError(`the route of item "${id}" cannot be read, so its closed line cannot be written`);
  if (item.state !== o.outcome) throw new BurhanError(`item "${id}" is "${item.state}", not "${o.outcome}": the closed line records where the item really is (finish it or approve its QC first)`);
  const line = formatClosedLine({ slug: id, route: item.typeScope, outcome: o.outcome, commit: o.commit, folder: o.folder });
  if (parseClosedLine(line) === null) throw new BurhanError('that would not be a closed line: --commit is 7 to 40 hex characters or "uncommitted", --folder is a path with no " · " and no space at either end');
  editStateFile(statePath, (text) => closeBlock(text, headingFor(text, id, stateRel), line), { label: stateRel });
  io.stdout(`state close: ${id} is now one line in ${stateRel}\n  ${line}\n  plan: ${tickPlanBox(project, dir, id, o.outcome)}\n`);
  return 0;
}
