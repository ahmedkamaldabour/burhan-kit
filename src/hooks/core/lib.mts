/** Shared library for the core checks — the Node port of kit/hooks/core/lib.sh.
 *  Contract (tests/CONFORMANCE.md): stdin is a normalized event; stdout is {"message":"…"} or nothing.
 *  Fail open: a check returns its findings; the entry prints them only at the very end, exit 0 always. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HookConfig } from './config.mjs';

/** Everything a check gets. */
export interface Ctx { ev: HookEvent; cfg: HookConfig; project: string; env: NodeJS.ProcessEnv }
/** A check returns its findings in order (wf_say); the entry joins and prints them (wf_emit). */
export type Check = (ctx: Ctx) => string[] | Promise<string[]>;

export interface HookEvent {
  raw: Record<string, unknown>;
  /** wf_get: `jq -r '(<path>) // empty'` captured by $(…) — null/false/absent -> '', trailing newlines dropped. */
  get(path: string): string;
  /** wf_list: the items of an array (none when the value is no array). */
  list(path: string): string[];
}

const at = (root: unknown, path: string): unknown => {
  let v = root;
  for (const k of path.split('.').filter(Boolean)) {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined;
    v = (v as Record<string, unknown>)[k];
  }
  return v;
};
/** One value as `jq -r` prints it (strings raw, everything else as JSON). */
const jqText = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));
/** $(…) drops trailing newlines. */
export const chomp = (s: string): string => s.replace(/\n+$/, '');

/** The event on stdin, or null when it is empty or not a JSON object (the check then stays silent). */
export function parseEvent(stdin: string): HookEvent | null {
  if (stdin === '') return null;
  let v: unknown;
  try { v = JSON.parse(stdin); } catch { return null; }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const raw = v as Record<string, unknown>;
  return {
    raw,
    get: (path) => { const x = at(raw, path); return x === undefined || x === null || x === false ? '' : chomp(jqText(x)); },
    list: (path) => { const x = at(raw, path); return Array.isArray(x) ? x.filter((i) => i !== null).map(jqText) : []; },
  };
}

/** wf_rel_stream: a project-relative, lexically normalised path. "." and empty segments go, ".." pops a real
 *  directory, a leading ".." stays (outside never looks inside). On Windows (W3) backslashes are separators
 *  and the drive letter's case does not matter. */
export function relPath(p: string, project: string, win = process.platform === 'win32'): string {
  if (win) {
    p = p.replace(/\\/g, '/'); project = project.replace(/\\/g, '/');
    const drive = /^[A-Za-z]:/;
    if (drive.test(p) && drive.test(project) && p[0].toLowerCase() === project[0].toLowerCase()) p = project[0] + p.slice(1);
  }
  if (project !== '' && p.startsWith(project + '/')) p = p.slice(project.length + 1);
  const abs = p.startsWith('/');
  const st: string[] = [];
  for (const s of p.split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..' && st.length > 0 && st[st.length - 1] !== '..') { st.pop(); continue; }
    if (s === '..' && abs) continue;
    st.push(s);
  }
  return (abs ? '/' : '') + st.join('/');
}

/** wf_state_now: the "## Now" section of the state file ('' if absent). */
export function stateNow(project: string, cfg: HookConfig): string {
  let text: string;
  try { text = readFileSync(join(project, cfg.WF_STATE_FILE ?? ''), 'utf8'); } catch { return ''; }
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const out: string[] = [];
  let on = false;
  for (const l of lines) {
    if (l.startsWith('## ')) { if (on) break; if (/^## Now[ \t\r\v\f]*$/.test(l)) { on = true; continue; } }
    if (on) out.push(l);
  }
  return chomp(out.join('\n'));
}

// glibc [[:space:]] under a UTF-8 locale (not JS \s: NBSP and U+FEFF are no space there).
const SP = '\\t\\n\\v\\f\\r \\u1680\\u2000-\\u2006\\u2008-\\u200a\\u2028\\u2029\\u205f\\u3000';
const SLUG_HEADING = new RegExp(`^###[${SP}]+[^<${SP}#]`, 'u');

/** Every real item heading in Now, in order. */
export function itemSlugs(now: string): string[] {
  const out: string[] = [];
  for (const l of now.split('\n')) {
    const m = new RegExp(`^###[${SP}]+([^${SP}#<][^${SP}]*)`, 'u').exec(l);
    if (m) out.push(m[1]);
  }
  return out;
}

/** Select a live per-session link, else the only item; multi-item unlinked sessions have no item. */
export function itemResolved(now: string, linked: string): string {
  const slugs = itemSlugs(now);
  if (slugs.includes(linked)) return linked;
  return slugs.length === 1 ? slugs[0] : '';
}

/** wf_item_now without a session link: retained for callers that inspect a bare Now block. */
export function itemNow(now: string): string {
  return itemResolved(now, '');
}

/** wf_item_block: the item in flight — its heading up to the next item or template heading ("####" stays
 *  inside); with no slug heading, the whole Now. */
export function itemBlock(now: string, selected = itemNow(now)): string {
  if (selected === '') return itemSlugs(now).length === 0 ? now : '';
  let n = 0;
  const out: string[] = [];
  for (const l of now.split('\n')) {
    if (SLUG_HEADING.test(l)) {
      const slug = new RegExp(`^###[${SP}]+([^${SP}#<][^${SP}]*)`, 'u').exec(l)?.[1] ?? '';
      n = slug === selected ? 1 : 2;
    }
    else if (new RegExp(`^###([${SP}]|$)`, 'u').test(l) && n >= 1) n = 2;
    if (n === 1) out.push(l);
  }
  return out.join('\n');
}

/** wf_item_field: the value of the item's "**Label:**" field — it opens a list line or follows " · ", and
 *  runs to the next " · " or the end of the line (trimmed). Only the first occurrence counts; a "<…>"
 *  placeholder is no value. */
export function itemField(now: string, label: string): string {
  const L = `**${label}:**`;
  for (const raw of itemBlock(now).split('\n')) {
    const line = raw.replace(/^[ \t\r\v\f]*[-*][ \t\r\v\f]+/, '');
    for (let p of line.split(' · ')) {
      p = p.replace(/^[ \t\r\v\f]+/, '');
      if (p.startsWith(L)) {
        const v = p.slice(L.length).replace(/^[ \t\r\v\f]+|[ \t\r\v\f]+$/g, '');
        return v.startsWith('<') ? '' : v;
      }
    }
  }
  return '';
}

const ROUTE_RE = /^(feature|bug|investigation|change|refactor|release) \/ (spike|bounded|architectural|patch)$/;
/** wf_item_route: "<type> / <scope>" from **Route:** (or the legacy **Type / scope:**), only an exact value. */
export function itemRoute(now: string): string {
  const r = itemField(now, 'Route') || itemField(now, 'Type / scope');
  return ROUTE_RE.test(r) ? r : '';
}

/** wf_emit: findings joined by a blank line, as `jq -c '{message: $m}'` prints them — JSON.stringify
 *  escapes the same way except DEL, which jq writes as \u007f. Nothing to say -> nothing at all. */
export function emit(findings: string[]): string {
  if (findings.length === 0) return '';
  return JSON.stringify({ message: findings.join('\n\n') }).replace(/\x7f/g, '\\u007f') + '\n';
}
