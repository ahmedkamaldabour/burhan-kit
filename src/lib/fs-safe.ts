import { accessSync, constants, cpSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Resolve symlinks so writes land on the real file (the link itself stays a link). */
export function realTarget(p: string): string {
  try { return realpathSync(p); } catch { return p; }
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
