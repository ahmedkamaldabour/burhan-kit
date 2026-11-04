import { evidenceMatches } from '../hooks/core/evidence-cmd.mjs';
import { readProjectConfig } from './config.js';
import { ereToJs, isPiped, tryReadLedger, type LedgerRecord } from './evidence.js';
import { editAfter, itemRecordsQuiet, judgeVerify, type ItemRecords, type VerifyJudgement } from './verify.js';

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
  /** set only when a `burhan verify` record decided (absent: the ledger decided, as before) */
  by?: 'verify record';
  /** what the item's records said: set when the item has records */
  record?: RecordSaid;
  /** set with `by`: what the ledger said (its state and the details its line needs) */
  ledger?: Omit<FullRun, 'by' | 'record' | 'ledger'>;
}

/** What the item's `burhan verify` records said about a full run, judged by the function `item finish` uses (judgeVerify), with the full-run pattern as the proof pattern.
 *  proven: the latest run on the current code state passed · failed: it failed · stated: a pass with no code state · none: no record counts (`note` says why). */
export interface RecordSaid { kind: 'proven' | 'failed' | 'stated' | 'none'; command?: string; at?: string; exit?: number | null; why?: string; note?: string }

/** How the `why` of a ledger answer starts when the ledger folder could not be listed; `fullRunLine` reads it to say the ledger was not looked at. */
export const UNREADABLE = 'the evidence ledger could not be read';

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

/** The ledger's answer and the item's records together, in the order `item finish` reads them: a record that counts decides (it is taken against the files as they are now,
 *  so a shell edit or the current turn cannot hide from it), and the ledger decides when none does. The answer keeps both: `by` names the deciding source and `ledger` the other.
 *  A pass with no code state counts only when the ledger shows no code edit after it. */
export function withRecords(ledger: FullRun, judged: VerifyJudgement): FullRun {
  if (judged.kind === 'none' && judged.note === '') return ledger; // the item has no record: nothing to say
  if (judged.kind === 'stated' && ledger.edit && editAfter(ledger.edit.at, judged.rec.ts)) {
    const note = ` (the burhan verify run ${judged.rec.cmd} at ${judged.rec.ts} has no code state and the ledger shows a code edit after it: ${ledger.edit.file} at ${ledger.edit.at})`;
    return { ...ledger, record: { kind: 'none', note } };
  }
  const { by: _by, record: _record, ledger: _ledger, ...own } = ledger;
  switch (judged.kind) {
    case 'none': return { ...ledger, record: { kind: 'none', note: judged.note } };
    case 'failed': return { state: 'no', command: judged.rec.cmd, at: judged.rec.ts, edit: ledger.edit ?? null, by: 'verify record', record: { kind: 'failed', command: judged.rec.cmd, at: judged.rec.ts, exit: judged.rec.exit }, ledger: own };
    case 'stated': return { state: 'yes', command: judged.rec.cmd, at: judged.rec.ts, edit: ledger.edit ?? null, by: 'verify record', record: { kind: 'stated', command: judged.rec.cmd, at: judged.rec.ts, why: judged.why }, ledger: own };
    default: return { state: 'yes', command: judged.rec.cmd, at: judged.rec.ts, edit: ledger.edit ?? null, by: 'verify record', record: { kind: 'proven', command: judged.rec.cmd, at: judged.rec.ts }, ledger: own };
  }
}

/** The project's full-run answer, from its ledger and its own patterns; with `slug`, also from that item's `burhan verify` records (WF_FULL_TEST_REGEX picks the commands that count).
 *  `records` are the item's records already read (null: it has none); left out, they are read here. */
export function fullRunFor(target: string, env: NodeJS.ProcessEnv = process.env, o: { slug?: string; docs?: string; records?: ItemRecords | null } = {}): FullRun {
  const v = readProjectConfig(target).values;
  const read = tryReadLedger(target, env);
  const ledger: FullRun = read.error !== undefined ? { state: 'unknown', why: `${UNREADABLE} (${read.error})` } : fullRunOf(read.recs, { code: v.WF_CODE_REGEX, test: v.WF_TEST_REGEX, full: v.WF_FULL_TEST_REGEX });
  const full = compile(v.WF_FULL_TEST_REGEX);
  if (o.slug === undefined || full === null) return ledger; // no pattern: judgeVerify would take every run of every command for a full run
  const seen = o.records === undefined ? itemRecordsQuiet(target, o.slug, o.docs) : o.records;
  if (seen === null) return ledger;
  return withRecords(ledger, judgeVerify(seen.records, seen.current, full, 'WF_FULL_TEST_REGEX'));
}

/** A command as one short piece of a line: its first line, cut at 80 characters (a run can sit inside a long script). */
const shown = (cmd: string | undefined): string => { const first = (cmd ?? '').split('\n')[0]!; return first.length > 80 ? `${first.slice(0, 80)}…` : first; };

const BLIND = 'not seen by the ledger: shell edits (sed -i, scripts), edits outside the session, the current turn';

/** What the ledger said, as a clause of the line a record decided. */
const ledgerSaid = (l: NonNullable<FullRun['ledger']>): string => {
  switch (l.state) {
    case 'yes': return `${shown(l.command)} passed at ${l.at}${l.edit ? ` after the last code edit (${l.edit.file}, ${l.edit.at})` : ' and no code edit is in the ledger'}`;
    case 'no': return `a code edit (${l.edit?.file} at ${l.edit?.at}) came after its last passing full run (${shown(l.command)}, ${l.at})`;
    case 'none': return `no passing full run is recorded${l.edit ? ` (the last code edit is ${l.edit.file} at ${l.edit.at})` : ''}`;
    default: return `cannot tell — ${l.why}`;
  }
};
const RECORD_LIMIT = 'a record shows that a command ran and how it ended, not that it tests the right thing';

export function fullRunLine(f: FullRun): string {
  if (f.by === 'verify record' && f.record !== undefined) {
    const r = f.record;
    const other = `the ledger: ${f.ledger ? ledgerSaid(f.ledger) : 'not read'}`;
    if (r.kind === 'failed') return `full run: no — by burhan verify record: the latest run of ${shown(r.command)} on the current code state FAILED (exit ${r.exit ?? 'none'}) at ${r.at}; ${other}; ${RECORD_LIMIT}`;
    if (r.kind === 'stated') {
      const unread = f.ledger?.state === 'unknown' && f.ledger.why?.startsWith(UNREADABLE) === true;
      const empty = f.ledger?.state === 'unknown' && !unread;
      const seen = unread ? 'the ledger could not be read, so a code edit after it was not looked for'
        : empty ? 'the ledger holds no step for this project, so a code edit after it was not looked for'
          : `the ledger shows no code edit after it (${BLIND})`;
      return `full run: yes (stated) — by burhan verify record: ${shown(r.command)} passed at ${r.at} with no code state (${r.why}), so it cannot be compared with the files now, and ${seen}; ${other}; ${RECORD_LIMIT}`;
    }
    return `full run: yes — by burhan verify record: ${shown(r.command)} passed at ${r.at} on the current code state (the files now are the files it ran on); ${other}; ${RECORD_LIMIT}`;
  }
  const every = f.everyEdit ? '; every edit counts: WF_CODE_REGEX and WF_TEST_REGEX are empty or not usable' : '';
  const waiting = f.background === undefined ? '' : `; a full run started in the background at ${f.background.at} (${shown(f.background.command)}) has no result in the ledger: read its log before you run it again`;
  const recs = f.record?.kind === 'none' ? `; no burhan verify record counts${f.record.note}` : '';
  switch (f.state) {
    case 'yes': return `full run: yes — ${shown(f.command)} passed at ${f.at}${f.edit ? ` after the last code edit (${f.edit.file}, ${f.edit.at})` : ' and no code edit is in the ledger'}${every}; ${BLIND}${recs}`;
    case 'no': return `full run: no — the last code edit is ${f.edit?.file} at ${f.edit?.at} and no passing full run follows it (the last one, ${shown(f.command)}, was at ${f.at})${every}${waiting}; ${BLIND}${recs}`;
    case 'none': return `full run: none — no passing full run is in the ledger${f.edit ? ` (the last code edit is ${f.edit.file} at ${f.edit.at})` : ''}${every}${waiting}${recs}`;
    default: return `full run: cannot tell — ${f.why}${recs}`;
  }
}
