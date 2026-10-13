import type { Io } from '../src/main.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
