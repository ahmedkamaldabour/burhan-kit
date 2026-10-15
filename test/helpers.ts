import type { Io } from '../src/main.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

const registeredTmpDirs = new Set<string>();

process.on('exit', () => {
  for (const dir of registeredTmpDirs) rmSync(dir, { recursive: true, force: true });
});

/** Creates a test temp directory and removes it when this test process exits. */
export function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  registeredTmpDirs.add(dir);
  return dir;
}

/** An Io that records what a command printed. */
export function capture(cwd = process.cwd()): { o: { out: string; err: string }; io: Io } {
  const o = { out: '', err: '' };
  return { o, io: { stdout: (s) => { o.out += s; }, stderr: (s) => { o.err += s; }, cwd } };
}

/** A path as it appears inside JSON text (a Windows path's backslashes doubled), so substituting a path into a JSON
 *  template keeps the template valid JSON. */
export const jsonText = (path: string): string => JSON.stringify(path).slice(1, -1);

/** Replaces every spelling of `path` in `text` (JSON-escaped and raw) with `token`. */
export const maskPath = (text: string, path: string, token: string): string =>
  text.replaceAll(jsonText(path), token).replaceAll(path, token);

/** A relative path with `/` separators, whatever the OS (the key of a file in a golden tree). */
export const slashes = (path: string): string => path.split(sep).join('/');

/** `skip` option for a test that cannot run on Windows: the reason is printed in the test log, so a skip is never anonymous. */
export const notOnWindows = (reason: string): string | false => (process.platform === 'win32' ? reason : false);

/** `skip` option for tests whose subject is a POSIX permission bit (chmod, mode): Windows has no such bits, so the test says nothing there. */
export const posixOnly: string | false = process.platform === 'win32' ? 'POSIX permission bits do not exist on Windows' : false;
