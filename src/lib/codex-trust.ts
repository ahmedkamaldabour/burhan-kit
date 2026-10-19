import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import { realTarget } from './fs-safe.js';

/** Codex hook trust, read from ~/.codex/config.toml by table NAME only — never a value: the file is the
 *  user's and private. Trust itself is the user's act in Codex (`/hooks`); burhan reads names and advises. */
export const MAX_CODEX_CONFIG_BYTES = 1024 * 1024;
export type CodexConfigSkip = 'absent' | 'symlink' | 'not a file' | 'large' | 'unreadable';

/** The file's text when it is a regular file of at most 1 MiB and neither it nor ~/.codex is a symlink. */
export function readCodexConfig(home: string): { text: string } | { skip: CodexConfigSkip } {
  const dir = join(home, '.codex');
  const file = join(dir, 'config.toml');
  const missing = (e: unknown): CodexConfigSkip => ['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '') ? 'absent' : 'unreadable';
  try { if (lstatSync(dir).isSymbolicLink()) return { skip: 'symlink' }; } catch (e) { return { skip: missing(e) }; }
  let st: Stats;
  try { st = lstatSync(file); } catch (e) { return { skip: missing(e) }; }
  if (st.isSymbolicLink()) return { skip: 'symlink' };
  if (!st.isFile()) return { skip: 'not a file' };
  if (st.size > MAX_CODEX_CONFIG_BYTES) return { skip: 'large' };
  let fd: number | undefined;
  try {
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const s = fstatSync(fd);
    if (!s.isFile()) return { skip: 'not a file' };
    const buf = Buffer.alloc(MAX_CODEX_CONFIG_BYTES + 1);
    let n = 0;
    for (;;) {
      const r = readSync(fd, buf, n, buf.length - n, null);
      if (r === 0) break;
      n += r;
      if (n > MAX_CODEX_CONFIG_BYTES) return { skip: 'large' };
    }
    return { text: buf.subarray(0, n).toString('utf8') };
  } catch (e) {
    return { skip: (e as NodeJS.ErrnoException).code === 'ELOOP' ? 'symlink' : 'unreadable' };
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* closing a read-only fd cannot lose data */ }
  }
}

// TOML whitespace is space and tab only.
const HEADER = /^[ \t]*\[[ \t]*hooks[ \t]*\.[ \t]*state[ \t]*\.[ \t]*/;
const TAIL = /^[ \t]*\][ \t]*(#.*)?$/;
// TOML 1.0 basic-string escapes (AC-02); `\e` and `\x` are TOML 1.1 and count as malformed here.
const ESC: Record<string, string> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };

/** A TOML basic string's body decoded, or null on a bad escape. */
function decodeBasic(body: string): string | null {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\') { out += body[i]; continue; }
    const c = body[++i];
    if (c !== undefined && Object.hasOwn(ESC, c)) { out += ESC[c]; continue; }
    const len = c === 'u' ? 4 : c === 'U' ? 8 : 0;
    const hex = body.slice(i + 1, i + 1 + len);
    if (!len || !new RegExp(`^[0-9A-Fa-f]{${len}}$`).test(hex)) return null;
    const cp = Number.parseInt(hex, 16);
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    out += String.fromCodePoint(cp);
    i += len;
  }
  return out;
}

/** The key of a `[hooks.state.<key>]` header, given the text after `state.`; null when malformed. */
function headerKey(rest: string): string | null {
  if (rest[0] === "'") {
    const end = rest.indexOf("'", 1);
    return end > 0 && TAIL.test(rest.slice(end + 1)) ? rest.slice(1, end) : null;
  }
  if (rest[0] !== '"') return null;
  let i = 1;
  while (i < rest.length && rest[i] !== '"') i += rest[i] === '\\' ? 2 : 1;
  if (i >= rest.length || !TAIL.test(rest.slice(i + 1))) return null;
  return decodeBasic(rest.slice(1, i));
}

/** Where a multi-line string closes on this line (index of the delimiter), or -1. */
function closeAt(line: string, from: number, d: '"""' | "'''"): number {
  if (d === "'''") return line.indexOf(d, from);
  for (let i = from; i <= line.length - 3; i++) {
    if (line[i] === '\\') { i++; continue; }
    if (line.startsWith(d, i)) return i;
  }
  return -1;
}

/** Scans a line outside any string; returns the multi-line delimiter still open at its end, or null. */
function openAtEnd(line: string): '"""' | "'''" | null {
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '#') return null;
    if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
      const d = line.slice(i, i + 3) as '"""' | "'''";
      const end = closeAt(line, i + 3, d);
      if (end === -1) return d;
      i = end + 3;
    } else if (c === '"') {
      i++;
      while (i < line.length && line[i] !== '"') i += line[i] === '\\' ? 2 : 1;
      i++;
    } else if (c === "'") {
      const end = line.indexOf("'", i + 1);
      i = end === -1 ? line.length : end + 1;
    } else i++;
  }
  return null;
}

/** The names of `[hooks.state.<key>]` tables, in file order. Values, comments, other tables, array tables
 *  and lines inside multi-line strings are never returned. */
export function stateTableNames(text: string): string[] {
  const names: string[] = [];
  let open: '"""' | "'''" | null = null;
  // A leading BOM is not part of the first line; LF, CRLF and a lone CR all end a line.
  for (const line of text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)) {
    if (open) {
      const end = closeAt(line, 0, open);
      if (end !== -1) open = openAtEnd(line.slice(end + 3));
      continue;
    }
    const h = HEADER.exec(line);
    if (h) { const key = headerKey(line.slice(h[0].length)); if (key !== null) names.push(key); continue; }
    open = openAtEnd(line);
  }
  return names;
}

/** On Windows `\` and `/` alike and case folded; on POSIX a `\` is part of a name. No trailing separator (a root keeps its own). */
export function normalisePath(p: string, windows: boolean): string {
  let s = windows ? p.replace(/\\/g, '/') : p;
  while (s.length > 1 && s.endsWith('/') && !/^[A-Za-z]:\/$/.test(s)) s = s.slice(0, -1);
  return windows ? s.toLowerCase() : s;
}

const KEY_WINDOWS = /^(.*)[\\/]\.codex[\\/]hooks\.json:([a-z_]+):(\d+):(\d+)$/;
const KEY_POSIX = /^(.*)\/\.codex\/hooks\.json:([a-z_]+):(\d+):(\d+)$/;

/** The events (snake case) that have a trust table for one of `projectPaths`, matched as written or as resolved. */
export function trustedEvents(names: string[], projectPaths: string[], events: string[], windows: boolean): Set<string> {
  const mine = new Set(projectPaths.map((p) => normalisePath(p, windows)));
  const real = new Map<string, string>();
  const found = new Set<string>();
  for (const name of names) {
    const m = (windows ? KEY_WINDOWS : KEY_POSIX).exec(name);
    if (!m || !events.includes(m[2])) continue;
    // A project at a root: the key starts `/.codex/…` (POSIX) or `C:\.codex\…` (Windows).
    const dir = m[1] === '' ? '/' : /^[A-Za-z]:$/.test(m[1]) ? `${m[1]}/` : m[1];
    if (!real.has(dir)) real.set(dir, realTarget(dir));
    if (mine.has(normalisePath(dir, windows)) || mine.has(normalisePath(real.get(dir)!, windows))) found.add(m[2]);
  }
  return found;
}
