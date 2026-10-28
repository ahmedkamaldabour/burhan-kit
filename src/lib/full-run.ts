import { evidenceMatches } from '../hooks/core/evidence-cmd.mjs';
import { readProjectConfig } from './config.js';
import { ereToJs, isPiped, readLedger, type LedgerRecord } from './evidence.js';

/** Whether the ledger holds a passing run of the whole test suite after the last code edit.
 *  yes: one does · no: the last code edit came after the last one · none: no passing full run is recorded · unknown: the ledger cannot tell. */
export interface FullRun {
  state: 'yes' | 'no' | 'none' | 'unknown';
  command?: string; at?: string;
  /** the last code edit the ledger knows of (null: none recorded) */
  edit?: { file: string; at: string } | null;
  /** a full run started in the background after the last code edit and after the last passing run: the ledger has no result for it */
  background?: { command: string; at: string };
  /** both code patterns are empty or not usable, so every edit counted as code */
  everyEdit?: true;
  why?: string;
}

const compile = (ere: string | undefined): RegExp | null => { try { return ere ? new RegExp(ereToJs(ere)) : null; } catch { return null; } };

/** `recs`: the project's ledger, oldest first. A code edit is an edit of a path matching `code` or `test`; with neither usable every edit counts.
 *  A full run is a command a line runs (not a mention) that matches `full`, passed, and was not piped; a run with status `background` has no result and never counts. */
export function fullRunOf(recs: LedgerRecord[], cfg: { code?: string; test?: string; full?: string }): FullRun {
  const full = compile(cfg.full);
  if (full === null) return { state: 'unknown', why: 'WF_FULL_TEST_REGEX is empty or not usable, so the ledger cannot tell a full run from a run of one file' };
  if (recs.length === 0) return { state: 'unknown', why: 'the evidence ledger has no record for this project yet' };
  const code = compile(cfg.code);
  const test = compile(cfg.test);
  const isCode = (file: string): boolean => (code === null && test === null) || (code !== null && code.test(file)) || (test !== null && test.test(file));
  let lastEdit = -1;
  let lastRun = -1;
  let lastBackground = -1;
  recs.forEach((r, i) => {
    if (r.kind === 'edit' && r.file !== undefined && isCode(r.file)) lastEdit = i;
    if (r.kind !== 'cmd' || isPiped(r.cmd ?? '') || !evidenceMatches(full, r.cmd ?? '')) return;
    if (r.status === 'ok') lastRun = i;
    else if (r.status === 'background') lastBackground = i;
  });
  const every = code === null && test === null ? { everyEdit: true as const } : {};
  const e = lastEdit >= 0 ? recs[lastEdit]! : null;
  const edit = e === null ? null : { file: e.file ?? '', at: e.ts };
  const run = lastRun >= 0 ? recs[lastRun]! : null;
  if (run !== null && lastRun > lastEdit) return { state: 'yes', command: run.cmd, at: run.ts, edit, ...every };
  const bg = lastBackground > lastEdit && lastBackground > lastRun ? recs[lastBackground]! : null;
  const background = bg === null ? {} : { background: { command: bg.cmd ?? '', at: bg.ts } };
  return run === null ? { state: 'none', edit, ...every, ...background } : { state: 'no', command: run.cmd, at: run.ts, edit, ...every, ...background };
}

/** The project's full-run answer, from its ledger and its own patterns. */
export function fullRunFor(target: string, env: NodeJS.ProcessEnv = process.env): FullRun {
  const v = readProjectConfig(target).values;
  return fullRunOf(readLedger(target, env), { code: v.WF_CODE_REGEX, test: v.WF_TEST_REGEX, full: v.WF_FULL_TEST_REGEX });
}

/** A command as one short piece of a line: its first line, cut at 80 characters (a run can sit inside a long script). */
const shown = (cmd: string | undefined): string => { const first = (cmd ?? '').split('\n')[0]!; return first.length > 80 ? `${first.slice(0, 80)}…` : first; };

const BLIND = 'not seen by the ledger: shell edits (sed -i, scripts), edits outside the session, the current turn';

export function fullRunLine(f: FullRun): string {
  const every = f.everyEdit ? '; every edit counts: WF_CODE_REGEX and WF_TEST_REGEX are empty or not usable' : '';
  const waiting = f.background === undefined ? '' : `; a full run started in the background at ${f.background.at} (${shown(f.background.command)}) has no result in the ledger: read its log before you run it again`;
  switch (f.state) {
    case 'yes': return `full run: yes — ${shown(f.command)} passed at ${f.at}${f.edit ? ` after the last code edit (${f.edit.file}, ${f.edit.at})` : ' and no code edit is in the ledger'}${every}; ${BLIND}`;
    case 'no': return `full run: no — the last code edit is ${f.edit?.file} at ${f.edit?.at} and no passing full run follows it (the last one, ${shown(f.command)}, was at ${f.at})${every}${waiting}; ${BLIND}`;
    case 'none': return `full run: none — no passing full run is in the ledger${f.edit ? ` (the last code edit is ${f.edit.file} at ${f.edit.at})` : ''}${every}${waiting}`;
    default: return `full run: cannot tell — ${f.why}`;
  }
}
