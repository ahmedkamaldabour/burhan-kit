import { accessSync, constants, cpSync, lstatSync, mkdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve, sep } from 'node:path';

/** Resolve symlinks so writes land on the real file (the link itself stays a link). */
export function realTarget(p: string): string {
  try { return realpathSync(p); } catch { return p; }
}

/** Where a write to `p` would land, resolved the way the kernel does it: component by component, a link's text
 *  followed from where the link lives (so `..` after a folder link is taken in the link's target, not in the text).
 *  Follows a link to the file, links in parent folders and a dangling link (a write creates its target); the part of
 *  the path that does not exist yet stays under its nearest existing folder. `p` itself must be a plain path (no `..`: `resolve` folds it by text). `null`: a link loop, or `..` after a part that does not exist (a write would fail). */
export function resolveWritePath(p: string): string | null {
  const start = resolve(p);
  const root = parse(start).root;
  let rest = start.slice(root.length).split(sep).filter(Boolean);
  let cur = root;
  let absent = false;
  for (let hops = 0; rest.length > 0;) {
    const [part, ...after] = rest as [string, ...string[]];
    rest = after;
    if (part === '.') continue;
    if (part === '..') { if (absent) return null; cur = dirname(cur); continue; } // after a missing part the kernel fails: never guess
    const next = join(cur, part);
    let link = false;
    if (!absent) {
      try { link = lstatSync(next).isSymbolicLink(); } catch { absent = true; }
    }
    if (!link) { cur = next; continue; }
    if (++hops > 40) return null;
    const text = readlinkSync(next);
    const r = parse(text).root;
    if (r !== '') cur = r;
    rest = [...text.slice(r.length).split(sep).filter(Boolean), ...rest];
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
