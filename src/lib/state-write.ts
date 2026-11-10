import { randomBytes } from 'node:crypto';
import { accessSync, chmodSync, closeSync, constants, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { BurhanError } from './errors.js';
import { realTarget } from './fs-safe.js';

/** The one writer of the state file (item state-file-safe-write). Every CLI write of it goes through `editStateFile`: it takes the lock
 *  `<state>.lock`, reads the bytes inside the lock, lets the caller change the text, writes a temp file in the same folder and renames it over the
 *  file only when the file still has the bytes that were read. It cannot stop a hand edit, which ignores the lock; the byte compare catches
 *  one that lands before the rename. */
export const LOCK_WAIT_MS = 5000;  // a writer waits this long for a lock, then refuses
export const LOCK_STALE_MS = 4000; // a lock older than this is a leftover and is taken over (shorter than the wait, so a dead lock recovers inside it)
const POLL_MS = 25;
const EDIT_TRIES = 3;
const RENAME_TRIES = 5;
const RENAME_PAUSE_MS = 20;

/** The temp write or the rename failed; the old file is unchanged. `code` is the system error code. */
export class ReplaceFailed extends BurhanError {
  code: string;
  constructor(message: string, code: string) { super(message); this.code = code; }
}

/** The seams are for tests; a caller passes at most `label` (the name printed in messages). */
export interface WriteOptions {
  waitMs?: number;
  staleMs?: number;
  rename?: (from: string, to: string) => void;
  beforeRename?: () => void;
  writeToken?: (fd: number, token: string) => void;
  label?: string;
}

const sleepSync = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const codeOf = (e: unknown): string => (e as NodeJS.ErrnoException).code ?? 'error';
const quiet = (f: () => void): void => { try { f(); } catch { /* best effort */ } };

/** Creates `lock` with `wx`; waits up to `waitMs`; takes over a lock older than `staleMs`. Returns the release, which removes the lock only when it still holds this writer's token. */
function takeLock(lock: string, waitMs: number, staleMs: number, writeToken: (fd: number, token: string) => void): () => void {
  const token = `${process.pid} ${Date.now()} ${randomBytes(4).toString('hex')}\n`;
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      const fd = openSync(lock, 'wx');
      try { writeToken(fd, token); } catch (e) { quiet(() => closeSync(fd)); quiet(() => unlinkSync(lock)); throw e; }
      closeSync(fd);
      return () => quiet(() => { if (readFileSync(lock, 'utf8') === token) unlinkSync(lock); });
    } catch (e) {
      if (codeOf(e) !== 'EEXIST') throw new BurhanError(`cannot create the lock ${lock} (${codeOf(e)}): nothing was written`);
    }
    let age: number;
    try { age = Date.now() - statSync(lock).mtimeMs; } catch { continue; } // it was removed meanwhile: try to take it at once
    if (age > staleMs) { // one renamer wins; a loser's rename finds nothing and the loop tries `wx` again
      const gone = `${lock}.stale-${randomBytes(3).toString('hex')}`;
      quiet(() => renameSync(lock, gone));
      quiet(() => unlinkSync(gone));
      continue;
    }
    if (Date.now() >= until) throw new BurhanError(`the state file is locked by another writer (${lock}): run the command again in a moment; if no burhan command is running, delete that file`);
    sleepSync(POLL_MS);
  }
}

/** Temp file in the same folder, the old file's mode, the byte compare, the rename. Returns false (and writes nothing) when `before` is given and the file no longer has those bytes. */
function replaceAtomically(real: string, data: string | Buffer, o: WriteOptions, before?: Buffer): boolean {
  const label = o.label ?? basename(real);
  const tmp = join(dirname(real), `.${basename(real)}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    writeFileSync(tmp, data, { flag: 'wx' });
    if (process.platform !== 'win32') quiet(() => chmodSync(tmp, statSync(real).mode & 0o7777)); // a file that is not there yet keeps the default mode
    o.beforeRename?.();
    if (before !== undefined && !readFileSync(real).equals(before)) { unlinkSync(tmp); return false; }
    const rename = o.rename ?? renameSync;
    for (let n = 1; ; n++) {
      try { rename(tmp, real); return true; } catch (e) {
        const code = codeOf(e);
        if (n < RENAME_TRIES && (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) { sleepSync(RENAME_PAUSE_MS); continue; } // Windows: a reader holds the file for a moment
        throw new ReplaceFailed(`could not replace ${label} (${code}): the old file is unchanged`, code);
      }
    }
  } catch (e) {
    quiet(() => unlinkSync(tmp));
    if (e instanceof BurhanError) throw e;
    throw new ReplaceFailed(`could not write ${label} (${codeOf(e)}): the old file is unchanged`, codeOf(e));
  }
}

/** Change the state file under the lock. `edit` gets the file's text and returns the new text, or null (or the same text) to write nothing.
 *  Refuses a file that is not valid UTF-8 and a file that is not writable. A symlinked state file stays a link: the target is written. */
export function editStateFile(statePath: string, edit: (text: string) => string | null, o: WriteOptions = {}): 'written' | 'unchanged' {
  const real = realTarget(statePath);
  const label = o.label ?? basename(real);
  const release = takeLock(`${real}.lock`, o.waitMs ?? LOCK_WAIT_MS, o.staleMs ?? LOCK_STALE_MS, o.writeToken ?? ((fd, token) => { writeSync(fd, token); }));
  try {
    for (let attempt = 1; ; attempt++) {
      let raw: Buffer;
      try { raw = readFileSync(real); } catch (e) { throw new BurhanError(`cannot read ${label} (${codeOf(e)}): nothing was written`); }
      const text = raw.toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(raw)) throw new BurhanError(`${label} is not valid UTF-8: nothing was written (fix the file, then run the command again)`);
      try { accessSync(real, constants.W_OK); } catch (e) { throw new ReplaceFailed(`cannot write ${label} (${codeOf(e)}): the file is not writable: nothing was written`, codeOf(e)); }
      const next = edit(text);
      if (next === null || next === text) return 'unchanged';
      if (replaceAtomically(real, next, { ...o, label }, raw)) return 'written';
      if (attempt >= EDIT_TRIES) throw new BurhanError(`${label} kept changing while it was being written: nothing was written; run the command again`);
    }
  } finally { release(); }
}

/** The same temp file and rename for a file that nobody else edits (the `.bak` of `state compact`); no lock. */
export function writeFileAtomic(path: string, data: string | Buffer, o: WriteOptions = {}): void {
  replaceAtomically(realTarget(path), data, o);
}
