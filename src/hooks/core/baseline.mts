/**
 * Project memory, read by the hooks and the CLI alike (`burhan memory`, the reminders, doctor): the Baseline line of
 * `.burhan/PROJECT.md` and the fact rows of `.burhan/context/<area>.md`. Formats: kit/templates/{project,context-area}.md
 * and the Baseline row of kit/phases/files.md. Read-only; node: built-ins only (this file is copied into projects).
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ere } from './ere.mjs';

export type BaselineState = 'none' | 'draft' | 'approved' | 'waived' | 'malformed';
export interface Baseline { state: BaselineState; line: number | null; legacy: boolean; name?: string; date?: string }

export const PROJECT_FILE = '.burhan/PROJECT.md';
/** Memory files are short Markdown; anything larger is not read (the hooks call this every turn). */
export const MAX_MEMORY_BYTES = 1024 * 1024;

const isDate = (s: string): boolean => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const FIELD = /^- \*\*(Baseline|Memory status):\*\*(.*)$/;

/** `Approved — <name> · YYYY-MM-DD` / `Waived — …`, parsed without a backtracking regex (the value is team-edited).
 *  Same name rule as "Accepted by" (src/lib/items.ts): the name has a letter and no `<` or `·`. */
function decided(value: string): { state: 'approved' | 'waived'; name: string; date: string } | null {
  const word = value.startsWith('Approved — ') ? 'Approved' : value.startsWith('Waived — ') ? 'Waived' : null;
  if (word === null) return null;
  const rest = value.slice(word.length + 3);
  const cut = rest.lastIndexOf(' · ');
  if (cut === -1) return null;
  const name = rest.slice(0, cut).trim(); const date = rest.slice(cut + 3);
  if (name.includes('<') || name.includes('·') || !/\p{L}/u.test(name) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !isDate(date)) return null;
  return { state: word === 'Approved' ? 'approved' : 'waived', name, date };
}

/** The Baseline line of a PROJECT.md text, exact forms only; anything else is `malformed`. */
export function readBaseline(text: string): Baseline {
  const found: { label: string; value: string; line: number }[] = [];
  text.split('\n').forEach((l, i) => {
    const m = FIELD.exec(l.replace(/\r$/, ''));
    if (m) found.push({ label: m[1]!, value: m[2]!.trim(), line: i + 1 });
  });
  const current = found.filter((f) => f.label === 'Baseline');
  if (current.length > 1) return { state: 'malformed', line: current[1]!.line, legacy: false };
  if (current.length === 1) {
    const { value, line } = current[0]!;
    if (value === 'Draft') return { state: 'draft', line, legacy: false };
    const d = decided(value);
    if (d) return { state: d.state, line, legacy: false, name: d.name, date: d.date };
    return { state: 'malformed', line, legacy: false };
  }
  const legacy = found[0];
  if (legacy === undefined) return { state: 'malformed', line: null, legacy: false };
  const m = /^Approved (\d{4}-\d{2}-\d{2})$/.exec(legacy.value);
  return m && isDate(m[1]!) ? { state: 'approved', line: legacy.line, legacy: true, date: m[1]! } : { state: 'draft', line: legacy.line, legacy: true };
}

/** PROJECT.md's text when it is a regular file (never a followed symlink) within the size cap; else why not. */
export function readProjectFile(project: string): { text: string } | { skip: 'absent' | 'symlink' | 'large' | 'unreadable'; code?: string } {
  const file = join(project, PROJECT_FILE);
  let st;
  try { st = lstatSync(file); } catch { return { skip: 'absent' }; }
  if (st.isSymbolicLink()) return { skip: 'symlink' };
  if (!st.isFile()) return { skip: 'unreadable', code: 'not a file' };
  if (st.size > MAX_MEMORY_BYTES) return { skip: 'large' };
  try { return { text: readFileSync(file, 'utf8') }; } catch (e) { return { skip: 'unreadable', code: (e as NodeJS.ErrnoException).code ?? 'error' }; }
}

/** The project's baseline: `none` without a regular, readable PROJECT.md. Never throws. */
export function baselineState(project: string): BaselineState {
  const r = readProjectFile(project);
  return 'text' in r ? readBaseline(r.text).state : 'none';
}

export type FactState = 'current' | 'disputed' | 'superseded';
export interface Fact { id: string; state: FactState; file: string; line: number; confidence: string; evidence: string; verified: string }
export interface Problem { level: 'fail' | 'warn'; file: string; line: number | null; message: string }

const SECTIONS: Record<string, FactState> = { current: 'current', disputed: 'disputed', superseded: 'superseded' };
const COLUMNS: Record<FactState, number> = { current: 5, disputed: 6, superseded: 7 };
const ID = /^[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONFIDENCE = new Set(['confirmed', 'inferred', 'unresolved']);
// `date @ commit` (the template), `date · commit` (older memory files) or a date alone (no Git).
const VERIFIED = /^(\d{4}-\d{2}-\d{2})(?: [@·] [0-9a-f]{7,40})?$/;

/** Splits a table row on unescaped pipes; null when the line is not a row. */
function cells(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  const out: string[] = []; let cur = '';
  for (let i = 1; i < t.length; i++) {
    const ch = t[i]!;
    if (ch === '\\' && t[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '|') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() !== '') out.push(cur.trim());
  return out;
}

/** The fact rows of one area file, with every problem in their shape. Header, separator and placeholder rows are skipped. */
export function parseFacts(text: string, file: string): { facts: Fact[]; problems: Problem[] } {
  const facts: Fact[] = []; const problems: Problem[] = [];
  let state: FactState | null = null;
  let heading: string | null = null; let warned = false;
  text.split('\n').forEach((raw, i) => {
    const line = i + 1;
    const l = raw.replace(/\r$/, '');
    const h = /^##\s+(.+?)\s*$/.exec(l);
    if (h) { heading = h[1]!; state = SECTIONS[heading.toLowerCase()] ?? null; warned = false; return; }
    const c = cells(l);
    if (c === null || c.length === 0) return;
    if (state === null) {
      if (heading !== null && !warned) { problems.push({ level: 'warn', file, line, message: `table under "## ${heading}" is not read (facts live under Current, Disputed or Superseded)` }); warned = true; }
      return;
    }
    const id = c[0]!;
    if (id === 'ID' || /^:?-+:?$/.test(id) || id.includes('<')) return;
    const fail = (message: string): void => { problems.push({ level: 'fail', file, line, message }); };
    if (c.length !== COLUMNS[state]) { fail(`${COLUMNS[state]} columns expected in ${state}, found ${c.length}`); return; }
    if (!ID.test(id)) { fail(`ID "${id}" is not <AREA>-<slug> (area in capitals, slug in lower-case letters, digits and -)`); return; }
    const [, , confidence = '', evidence = '', verified = ''] = c;
    if (!CONFIDENCE.has(confidence)) { fail(`${id}: confidence must be confirmed, inferred or unresolved`); return; }
    if (evidence === '') { fail(`${id}: evidence is empty`); return; }
    for (const m of evidence.matchAll(/sha256:(\S*)/g)) {
      if (!/^[0-9a-f]{16}$/.test(m[1]!)) { fail(`${id}: hash must be sha256: and 16 lower-case hex characters`); return; }
    }
    if (state !== 'disputed') {
      const v = VERIFIED.exec(verified);
      if (!v || !isDate(v[1]!)) { fail(`${id}: Verified must be YYYY-MM-DD @ <commit>, or YYYY-MM-DD`); return; }
    }
    facts.push({ id, state, file, line, confidence, evidence, verified: state === 'disputed' ? '' : verified });
  });
  return { facts, problems };
}

// ---- The tree: `burhan inspect` and the per-turn brownfield check ----

/** A project with at least this many source files has existing code to understand (brownfield). */
export const BROWNFIELD_MIN_SOURCE_FILES = 10;
export const INSPECT_MAX_DEPTH = 12;
export const INSPECT_MAX_ENTRIES = 20_000;
/** The hooks look at fewer entries per turn than `burhan inspect`, and stop after HOOK_MAX_MS (then: not brownfield). */
export const HOOK_MAX_ENTRIES = 5_000;
export const HOOK_MAX_MS = 1000;
/** `burhan inspect` stops after this long and says so. */
export const INSPECT_MAX_MS = 10_000;
/** At most this many entries of one folder are read, so one huge folder cannot use up the walk. */
export const DIR_MAX_ENTRIES = 1000;
/** Never descended into: version control, burhan, dependencies, build output, caches, editor folders. */
export const SKIP_DIRS = new Set(['.git', '.hg', '.svn', '.burhan', 'node_modules', 'vendor', 'bower_components', 'dist', 'build', 'out',
  'target', 'obj', '.next', '.nuxt', '.venv', 'venv', 'env', '__pycache__', '.tox', '.mypy_cache', '.pytest_cache', 'coverage',
  '.gradle', '.idea', '.vscode', 'Pods', '.terraform', '.cache', 'tmp']);
// Built-in source extensions, used when WF_CODE_REGEX is not set (or cannot be read).
const SOURCE_EXT = new Set(['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'scala',
  'cs', 'fs', 'vb', 'c', 'h', 'cc', 'cpp', 'hpp', 'm', 'mm', 'swift', 'php', 'pl', 'lua', 'dart', 'ex', 'exs', 'erl', 'clj', 'hs',
  'ml', 'r', 'jl', 'sh', 'bash', 'ps1', 'sql', 'vue', 'svelte', 'groovy', 'zig', 'nim', 'sol']);

export interface Walk {
  sourceFiles: number; entries: number; symlinks: number; unreadable: string[];
  truncated: { depth: boolean; entries: boolean; wide: boolean; time: boolean }; stopped: boolean;
}

/** A source-file test: WF_CODE_REGEX on the project-relative path when it is set and usable, else the built-in list. */
export function sourceTest(codeRegex: string): { kind: 'regex' | 'builtin'; test: (rel: string) => boolean } {
  const m = codeRegex === '' ? null : ere(codeRegex);
  if (m !== null) return { kind: 'regex', test: (rel) => m.test(rel) };
  return { kind: 'builtin', test: (rel) => { const dot = rel.lastIndexOf('.'); return dot > rel.lastIndexOf('/') && SOURCE_EXT.has(rel.slice(dot + 1).toLowerCase()); } };
}

/** Walks the tree breadth-first in name order (deterministic), reading names only: symlinks are counted, never followed;
 *  SKIP_DIRS are not entered; it stops at the depth and entry limits (and says so), or once `stopAt` source files are seen. */
export function walkTree(project: string, o: { isSource: (rel: string) => boolean; maxDepth?: number; maxEntries?: number; maxMs?: number; stopAt?: number; onEntry?: (rel: string, kind: 'file' | 'dir' | 'link') => void }): Walk {
  const maxDepth = o.maxDepth ?? INSPECT_MAX_DEPTH; const maxEntries = o.maxEntries ?? INSPECT_MAX_ENTRIES;
  const deadline = o.maxMs === undefined ? Infinity : Date.now() + o.maxMs;
  const w: Walk = { sourceFiles: 0, entries: 0, symlinks: 0, unreadable: [], truncated: { depth: false, entries: false, wide: false, time: false }, stopped: false };
  let level: string[] = [''];
  for (let depth = 1; level.length > 0; depth++) {
    const next: string[] = [];
    for (const dir of level) {
      let names: import('node:fs').Dirent[];
      try { names = readdirSync(join(project, dir), { withFileTypes: true }); } catch { w.unreadable.push(dir); continue; }
      names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      if (names.length > DIR_MAX_ENTRIES) { w.truncated.wide = true; names = names.slice(0, DIR_MAX_ENTRIES); }
      for (const e of names) {
        if (w.entries >= maxEntries) { w.truncated.entries = true; return w; }
        if (Date.now() > deadline) { w.truncated.time = true; return w; }
        w.entries++;
        const rel = dir === '' ? e.name : `${dir}/${e.name}`;
        if (e.isSymbolicLink()) { w.symlinks++; o.onEntry?.(rel, 'link'); continue; }
        if (e.isDirectory()) {
          o.onEntry?.(rel, 'dir');
          if (SKIP_DIRS.has(e.name)) continue;
          if (depth >= maxDepth) { w.truncated.depth = true; continue; }
          next.push(rel); continue;
        }
        if (!e.isFile()) continue;
        o.onEntry?.(rel, 'file');
        if (o.isSource(rel) && ++w.sourceFiles >= (o.stopAt ?? Infinity)) { w.stopped = true; return w; }
      }
    }
    level = next;
  }
  return w;
}

/** The per-turn check: does the project have existing code? Stops at the threshold; bounded by HOOK_MAX_ENTRIES; never throws. */
export function isBrownfield(project: string, codeRegex: string, maxEntries = HOOK_MAX_ENTRIES): boolean {
  try { return walkTree(project, { isSource: sourceTest(codeRegex).test, maxEntries, maxMs: HOOK_MAX_MS, stopAt: BROWNFIELD_MIN_SOURCE_FILES }).stopped; } catch { return false; }
}
