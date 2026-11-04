import { appendFileSync, lstatSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Io } from '../main.js';
import { evidenceMatches } from '../hooks/core/evidence-cmd.mjs';
import { readProjectConfig } from './config.js';
import { BurhanError } from './errors.js';
import { codeState, type CodeState } from './fingerprint.js';
import { realTarget } from './fs-safe.js';
import { itemFolder } from './item-files.js';
import { assertInside, isSlug } from './item-io.js';
import { docsLocation } from './status.js';
import { launchFor, runLaunch } from './verify-run.js';

/** One line of `<slug>-verify.jsonl`. Only `burhan verify` writes it; a failed run is recorded too and no line is ever deleted. */
export interface VerifyRecord {
  schema: 1; ts: string; cmd: string; argv: string[]; exit: number | null; status: 'ok' | 'failed' | 'not-started';
  /** the code state before the run (`fp1:…`), or null with `why` */
  fingerprint: string | null; files: number; why?: string; platform: string; node: string;
}

export const verifyFile = (dir: string, slug: string): string => join(dir, `${slug}-verify.jsonl`);

/** The code state a record is compared with: every listed file except the docs location (the records live there), the state file and `.burhan/local/`. */
export function currentCodeState(target: string, docs?: string): CodeState {
  const values = readProjectConfig(realTarget(target)).values;
  const inside = (rel: string): string | null => {
    const r = rel.split('\\').join('/').replace(/^\.\//, '').replace(/\/+$/, '');
    return r === '' || r === '.' || r === '..' || r.startsWith('../') ? null : r;
  };
  const exclude = [docsLocation(target, docs).rel, values.WF_STATE_FILE || '.burhan/local/PROGRESS.md', '.burhan/local'].map(inside).filter((r): r is string => r !== null);
  return codeState(realTarget(target), exclude);
}

const isRecord = (r: unknown): r is VerifyRecord => {
  const x = r as Partial<VerifyRecord> | null;
  return x !== null && typeof x === 'object' && x.schema === 1 && typeof x.ts === 'string' && typeof x.cmd === 'string' && (x.exit === null || typeof x.exit === 'number')
    && (x.status === 'ok' || x.status === 'failed' || x.status === 'not-started') && (x.status !== 'ok' || x.exit === 0) && (x.fingerprint === null || typeof x.fingerprint === 'string');
};

/** The item's records, oldest first; a line that is not a record (torn, hand-written in another shape) is skipped. */
export function readVerifyRecords(dir: string, slug: string): VerifyRecord[] {
  const file = verifyFile(dir, slug);
  let text = '';
  try {
    if (!lstatSync(file).isFile()) return [];
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out: VerifyRecord[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try { const r: unknown = JSON.parse(line); if (isRecord(r)) out.push(r); } catch { /* not a record */ }
  }
  return out;
}

export type VerifyJudgement =
  | { kind: 'proven'; rec: VerifyRecord }
  | { kind: 'failed'; rec: VerifyRecord }
  | { kind: 'stated'; rec: VerifyRecord; why: string }
  | { kind: 'none'; note: string };

/** Which record decides: among the runs of a proof command (every run when `proof` is null), the latest one taken on the current code state. It proves when it
 *  passed and stops the finish when it failed. With no code state now, the latest run that had none either decides too: a pass is only stated, a failure stops
 *  the finish. `note` says why none counts. */
export function judgeVerify(recs: VerifyRecord[], current: CodeState, proof: RegExp | null): VerifyJudgement {
  if (recs.length === 0) return { kind: 'none', note: '' };
  const proofs = recs.filter((r) => proof === null || evidenceMatches(proof, r.cmd));
  if (proofs.length === 0) return { kind: 'none', note: ` (no burhan verify record runs a proof command: ${recs.length} record(s), none matches WF_EVIDENCE_REGEX)` };
  const latest = proofs[proofs.length - 1]!;
  if (current.value === null) {
    if (latest.fingerprint !== null) return { kind: 'none', note: ` (the code state cannot be taken now: ${current.why ?? 'no file list'})` };
    return latest.status === 'ok' ? { kind: 'stated', rec: latest, why: current.why ?? 'no file list' } : { kind: 'failed', rec: latest };
  }
  const same = proofs.filter((r) => r.fingerprint === current.value);
  if (same.length === 0) {
    const run = `the latest burhan verify run, ${latest.cmd} at ${latest.ts}`;
    return { kind: 'none', note: latest.fingerprint === null ? ` (${run}, has no code state and the project has one now, so it cannot be compared: run burhan verify again)` : ` (${run}, was on another code state: the code changed since)` };
  }
  const last = same[same.length - 1]!;
  return last.status === 'ok' ? { kind: 'proven', rec: last } : { kind: 'failed', rec: last };
}

/** True when the item's record file would really be inside the project, links followed: the check `burhan verify` makes before it writes. An item folder that is a link
 *  leading outside the project is not read, so a record planted there never counts. */
export function recordsInside(project: string, dir: string, slug: string): boolean {
  try { assertInside(project, verifyFile(dir, slug)); return true; } catch { return false; }
}

/** An item's records and the code state they are compared with (taken only when there is a record to compare). The one reading `item finish`, `guide` and `evidence` share. */
export interface ItemRecords { records: VerifyRecord[]; current: CodeState }
export function itemRecords(target: string, dir: string, slug: string, docs?: string): ItemRecords {
  const records = recordsInside(target, dir, slug) ? readVerifyRecords(dir, slug) : [];
  return { records, current: records.length > 0 ? currentCodeState(target, docs) : { value: null, files: 0 } };
}

/** The item's folder under the docs location, or null when the slug or the docs location is not usable: the commands that only report never fail on it. */
export function itemDirQuiet(target: string, slug: string, docs?: string): string | null {
  if (!isSlug(slug)) return null;
  try { return join(docsLocation(target, docs).abs, slug); } catch { return null; }
}

/** True unless the edit provably came no later than the record: a time that cannot be read counts as later, the safe side (a stated record then does not count). */
export const editAfter = (editAt: string, recordAt: string): boolean => !(Date.parse(editAt) <= Date.parse(recordAt));

/** `burhan verify <slug> -- <command> [args]`: runs the command in the project without a shell, shows its output and how it ended, and appends one record to the item's
 *  `<slug>-verify.jsonl`: the command, exit code, time and the code state before the run. Exit 0 on a pass, 1 on a failure or a command that could not start, 2 on a
 *  refusal (nothing is recorded then). It runs with the user's rights: it is not a sandbox. */
export function verify(target: string, slug: string | undefined, argv: string[], io: Io, o: { docs?: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {}): number {
  const project = realTarget(target);
  const { slug: s, dir } = itemFolder(docsLocation(target, o.docs).abs, slug, 'verify');
  if (argv.length === 0 || argv[0] === '') throw new BurhanError(`verify needs a command after --: burhan verify ${s} -- <command> [args]`);
  const platform = o.platform ?? process.platform;
  const env = o.env ?? process.env;
  const launch = launchFor(argv, { platform, env, cwd: project });
  const file = verifyFile(dir, s);
  assertInside(project, file);
  let kind: 'none' | 'file' | 'other' = 'none';
  try { kind = lstatSync(file).isFile() ? 'file' : 'other'; } catch { /* not there yet */ }
  if (kind === 'other') throw new BurhanError(`refusing to write ${file}: it is not a plain file`);
  const cmd = argv.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
  const before = currentCodeState(target, o.docs);
  io.stdout(`verify: ${s} — running ${cmd} (no shell)\n`);
  const run = runLaunch(launch, project, o.env);
  const after = currentCodeState(target, o.docs);
  const why = [run.why, before.why].filter((w): w is string => w !== undefined).join('; ');
  const rec: VerifyRecord = { schema: 1, ts: new Date().toISOString(), cmd, argv, exit: run.exit, status: run.status, fingerprint: before.value, files: before.files, ...(why !== '' ? { why } : {}), platform, node: process.version };
  appendFileSync(file, `${JSON.stringify(rec)}\n`);
  const where = relative(target, file).split(sep).join('/');
  const ended = run.status === 'ok' ? 'passed' : run.status === 'failed' ? 'FAILED' : 'could not start';
  const state = before.value === null ? `no code state (${before.why ?? 'no file list'})` : `code state ${before.value.slice(0, 16)}… over ${before.files} files`;
  io.stdout(`verify: ${ended} — exit ${run.exit ?? 'none'}${run.why !== undefined ? ` (${run.why})` : ''} · ${state} · recorded in ${where}\n`);
  if (before.value !== null && after.value !== before.value) io.stdout('verify: the command changed files the code state covers, so item finish will not match this record: add what it writes to .gitignore, or run burhan verify again (the next record holds the state with those files)\n');
  io.stdout(run.status === 'ok' ? `next: burhan item finish ${s} once every sub-unit is Reviewed and the gates are ticked\n` : `next: fix the failure and run burhan verify ${s} -- ${cmd} again (this run stays recorded)\n`);
  return run.status === 'ok' ? 0 : 1;
}
