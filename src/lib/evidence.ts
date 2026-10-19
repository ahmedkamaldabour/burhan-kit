import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Io } from '../main.js';
import { readProjectConfig } from './config.js';
import { BurhanError } from './errors.js';
import { realTarget } from './fs-safe.js';
import { isAbsoluteOverride } from '../hooks/core/store.mjs';

/** One step of a turn, as the turn-audit hook records it (src/hooks/core/turn-audit.mts). */
export interface LedgerRecord {
  ts: string; agent: string; session: string; turn: string; part?: number; seq: number; kind: 'edit' | 'cmd';
  file?: string; cmd?: string; exit?: number | null; status?: string; item: string | null; project: string;
  /** The subagent type that ran the step (a delegated build); absent for the main agent. */
  by?: string;
}
export interface LedgerSummary { commands: number; failed: number; evidenceRuns: number; evidencePassed: number; itemsWithPassingEvidence: string[] }

type Env = Record<string, string | undefined>;

/** Same key as the hooks' wf_project_key: sha256 of the physical project path, 16 hex chars. */
export const projectKey = (target: string): string => createHash('sha256').update(realTarget(target)).digest('hex').slice(0, 16);

/** Same order as the hooks: a config line (sourced after the environment, so even an empty one wins),
 *  then the environment, then the default. An empty value means the default, like ${VAR:-…} in bash. */
export const evidenceRoot = (env: Env = process.env, configured?: string): string => {
  const chosen = configured !== undefined ? configured : env.WF_EVIDENCE_DIR || '';
  // Absolute only — a relative value is ignored, exactly like the hooks' wf_evidence_root.
  return isAbsoluteOverride(chosen) ? chosen : join(env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'burhan/evidence');
};

/** WF_EVIDENCE_REGEX is a POSIX ERE (the hooks use grep -E); translate its bracket classes for JS. */
const POSIX: Record<string, string> = { space: '\\s', digit: '0-9', alpha: 'A-Za-z', alnum: 'A-Za-z0-9', upper: 'A-Z', lower: 'a-z', blank: ' \\t', punct: '!-/:-@\\[-`{-~', xdigit: '0-9A-Fa-f', word: '\\w' };
export const ereToJs = (re: string): string => re
  .replace(/\[:([a-z]+):\]/g, (m, c: string) => POSIX[c] ?? m)
  .replace(/\\[<>]/g, '\\b')          // GNU grep word boundaries
  .replace(/\{,(\d+)\}/g, '{0,$1}');   // ERE {,n}; JS reads it literally

/** The project a path belongs to: the nearest ancestor holding .burhan/ (else the path itself). */
export function projectRoot(target: string): string {
  let d = realTarget(target);
  for (;;) {
    if (existsSync(join(d, '.burhan'))) return d;
    const up = dirname(d);
    if (up === d) return realTarget(target);
    d = up;
  }
}

/** Every recorded step for this project, oldest first. Unreadable files and torn lines are skipped. */
export function readLedger(target: string, env: Env = process.env): LedgerRecord[] {
  const dir = join(evidenceRoot(env, readProjectConfig(target).values.WF_EVIDENCE_DIR), projectKey(target));
  if (!existsSync(dir)) return [];
  const out: LedgerRecord[] = [];
  for (const s of readdirSync(dir, { withFileTypes: true })) {
    if (!s.isDirectory()) continue;
    for (const f of readdirSync(join(dir, s.name))) {
      if (!f.endsWith('.jsonl')) continue;
      let text = '';
      try { text = readFileSync(join(dir, s.name, f), 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        try { const r = JSON.parse(line) as LedgerRecord; if (r && typeof r === 'object' && typeof r.seq === 'number') out.push(r); } catch { /* torn line */ }
      }
    }
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts) || a.session.localeCompare(b.session) || a.turn.localeCompare(b.turn)
    || (a.part ?? 0) - (b.part ?? 0) || a.seq - b.seq);
}

export function summarizeLedger(recs: LedgerRecord[], evidenceRegex: string): LedgerSummary {
  let re: RegExp | null = null;
  try { re = evidenceRegex ? new RegExp(ereToJs(evidenceRegex)) : null; } catch { re = null; }
  const cmds = recs.filter((r) => r.kind === 'cmd');
  const ev = re ? cmds.filter((r) => re!.test(r.cmd ?? '')) : [];
  const passed = ev.filter((r) => r.status === 'ok');
  return {
    commands: cmds.length,
    failed: cmds.filter((r) => r.status === 'failed').length,
    evidenceRuns: ev.length,
    evidencePassed: passed.length,
    itemsWithPassingEvidence: [...new Set(passed.map((r) => r.item).filter((i): i is string => !!i))].sort(),
  };
}

const line = (r: LedgerRecord): string =>
  `${r.ts}  ${r.agent}  ${r.session}/${r.turn}${r.part ? `.${r.part}` : ''} #${r.seq}  ` +
  (r.kind === 'edit' ? `edit  ${r.file ?? ''}` : `cmd  exit ${r.exit ?? '?'}  ${r.status ?? 'unknown'}  ${r.cmd ?? ''}`) +
  (r.by ? `  (${r.by})` : '') + (r.item ? `  [${r.item}]` : '');

export function evidence(o: { target: string; item?: string; session?: string; last?: string; json: boolean }, io: Io): number {
  const target = projectRoot(o.target);
  let n: number | undefined;
  if (o.last !== undefined) {
    if (!/^\d+$/.test(o.last)) throw new BurhanError(`--last needs a number: ${o.last}`);
    n = Number(o.last);
  }
  let recs = readLedger(target).filter((r) => (!o.item || r.item === o.item) && (!o.session || r.session === o.session));
  if (n !== undefined) recs = n === 0 ? [] : recs.slice(-n);
  if (o.json) { io.stdout(JSON.stringify(recs, null, 2) + '\n'); return 0; }
  if (recs.length === 0) {
    io.stdout(o.item || o.session
      ? `no evidence recorded for ${o.item ? `item "${o.item}"` : `session "${o.session}"`}\n`
      : 'no evidence recorded for this project yet (it is written by the turn-audit hook at the end of each turn)\n');
    return 0;
  }
  io.stdout(recs.map(line).join('\n') + '\n');
  return 0;
}

/** For `burhan stats`: the ledger summary with the project's own evidence pattern. */
export function ledgerSummaryFor(target: string): LedgerSummary | null {
  const recs = readLedger(target);
  return recs.length ? summarizeLedger(recs, readProjectConfig(target).values.WF_EVIDENCE_REGEX ?? '') : null;
}
