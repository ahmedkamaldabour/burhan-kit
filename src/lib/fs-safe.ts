import { accessSync, constants, cpSync, lstatSync, mkdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { dirname } from 'node:path';
import type { PlatformPath } from 'node:path';

/** Resolve symlinks so writes land on the real file (the link itself stays a link). */
export function realTarget(p: string): string {
  try { return realpathSync(p); } catch { return p; }
}

/** What `resolveWritePath` reads: the path rules of the OS, whether it is Windows, and a path's link text (`null`: there and not a link,
 *  `undefined`: not there). The default is this machine; a test passes another OS's rules and a filesystem in a map. */
export interface WalkSys { path: PlatformPath; win32: boolean; linkText(p: string): string | null | undefined }
/** A link reader from an lstat and a readlink: `undefined` when the path is not there, `null` when it is not a link, else the link text.
 *  Only the lstat is caught: a link whose text cannot be read throws, as before the seam, never read as "not there" (Deviation 2). */
export const linkTextWith = (lstat: (p: string) => { isSymbolicLink(): boolean }, readlink: (p: string) => string) => (p: string): string | null | undefined => {
  let st: { isSymbolicLink(): boolean };
  try { st = lstat(p); } catch { return undefined; }
  return st.isSymbolicLink() ? readlink(p) : null;
};
const NATIVE: WalkSys = { path: nodePath, win32: process.platform === 'win32', linkText: linkTextWith(lstatSync, readlinkSync) };

/** Where a write to `p` would land, resolved the way the OS does it: component by component, a link's text followed from where the
 *  link lives. POSIX takes `..` after a folder link in the link's target; Windows takes `..` in a link's text as text, after the link's
 *  folder (measured on a Windows runner, discovery 2026-10-27). Follows a link to the file, links in parent folders and a dangling link
 *  (a write creates its target); the part of the path that does not exist yet stays under its nearest existing folder. `p` itself must
 *  be a plain path (no `..`: `resolve` folds it by text). `null`: a link loop, or (POSIX) `..` after a part that does not exist (a write would fail). */
export function resolveWritePath(p: string, sys: WalkSys = NATIVE): string | null {
  const P = sys.path;
  const start = P.resolve(p);
  const root = P.parse(start).root;
  let rest = start.slice(root.length).split(P.sep).filter(Boolean);
  let cur = root;
  let absent = false;
  for (let hops = 0; rest.length > 0;) {
    const [part, ...after] = rest as [string, ...string[]];
    rest = after;
    if (part === '.') continue;
    if (part === '..') { if (absent) return null; cur = P.dirname(cur); continue; } // after a missing part the kernel fails: never guess
    const next = P.join(cur, part);
    let text: string | null | undefined = null;
    if (!absent) { text = sys.linkText(next); if (text === undefined) { absent = true; text = null; } }
    if (text === null) { cur = next; continue; }
    if (++hops > 40) return null;
    if (sys.win32) { // Windows: the link's folder joined with its text, `..` folded as text, then walked again from the drive root
      const full = P.resolve(cur, text);
      const r = P.parse(full).root;
      cur = r;
      rest = [...full.slice(r.length).split(P.sep).filter(Boolean), ...rest];
      continue;
    }
    const r = P.parse(text).root;
    if (r !== '') cur = r;
    rest = [...text.slice(r.length).split(P.sep).filter(Boolean), ...rest];
  }
  return cur;
}

/** Replace a file's content in place: keeps symlinks, mode and owner; creates parents. */
export function putFile(dest: string, data: string | Buffer): void {
  const real = realTarget(dest);
  mkdirSync(dirname(real), { recursive: true });
  writeFileSync(real, data);
}

/** Make dest an exact copy of the kit directory src (stale files removed). */
export function replaceDir(src: string, dest: string): void {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}

export function isWritable(p: string): boolean {
  try { accessSync(realTarget(p), constants.W_OK); return true; } catch { return false; }
}
