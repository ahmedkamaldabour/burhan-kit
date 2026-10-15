/** Private, fail-open evidence ledger (ports lib.sh:325-390). */
import { chmodSync, existsSync, mkdirSync, readdirSync, realpathSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { itemResolved, itemSlugs, stateNow, stripProject, type Ctx } from './lib.mjs';
import { atomicPrivateWrite, evidenceRoot, linkedItem, projectKey, safeId } from './store.mjs';

const OFF = new Set(['off', 'no', 'false', '0']);
const isWindows = process.platform === 'win32';
const DAY = 24 * 60 * 60 * 1000;

const privateDir = (dir: string): boolean => {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!isWindows) chmodSync(dir, 0o700);
    return true;
  } catch { return false; }
};

const string = (value: unknown): string => typeof value === 'string' ? value : '';
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** wf_phase_now: first Sub-unit field in Now, limited to 80 characters (not UTF-16 units). */
export function phaseNow(now: string): string {
  for (const line of now.split('\n')) {
    const at = line.indexOf('**Sub-unit:**');
    if (at >= 0) return Array.from(line.slice(at + '**Sub-unit:**'.length).replace(/^[ \t\r\v\f]+/, '')).slice(0, 80).join('');
  }
  return '';
}

/** wf_evidence_prune: remove only old safe session directories below a marked, private ledger root. */
export function evidencePrune(root: string, now = new Date()): void {
  try {
    const physical = realpathSync(root);
    let home = '';
    try { home = realpathSync(homedir()); } catch { /* an unreadable home is never a reason to prune more */ }
    if (physical === '/' || physical === home || !statSync(join(physical, '.burhan-evidence')).isFile()) return;
    for (const project of readdirSync(physical, { withFileTypes: true })) {
      if (!project.isDirectory() || !/^[0-9a-f]{16}$/.test(project.name)) continue;
      const projectDir = join(physical, project.name);
      for (const session of readdirSync(projectDir, { withFileTypes: true })) {
        if (!session.isDirectory() || !safeId(session.name)) continue;
        const dir = join(projectDir, session.name);
        if (Math.floor((now.getTime() - statSync(dir).mtimeMs) / DAY) <= 30 || !ledgerFilesOnly(dir)) continue; // find -mtime +30: whole days, rounded down
        try { unlinkTree(dir); } catch { /* fail open */ }
      }
    }
  } catch { /* fail open */ }
}

const ledgerFilesOnly = (dir: string): boolean => {
  try {
    return readdirSync(dir, { withFileTypes: true }).every((entry) => entry.isFile() && (entry.name.endsWith('.jsonl') || entry.name.startsWith('.turn.')));
  } catch { return false; }
};

const unlinkTree = (dir: string): void => {
  // The caller has already established this is a safe, leaf session directory containing only ledger files.
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) throw new Error('not a ledger leaf');
    unlinkSync(join(dir, entry.name));
  }
  // rmdirSync is deliberately local: the prune target can never be the root or a project directory.
  rmdirSync(dir);
};

const ensureRoot = (root: string): boolean => {
  try {
    if (existsSync(root)) return true;
    if (!privateDir(root)) return false;
    const marker = join(root, '.burhan-evidence');
    try {
      writeFileSync(marker, '', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      if (!isWindows) chmodSync(marker, 0o600);
    } catch { /* Bash also continues when its best-effort marker write fails. */ }
    return true;
  } catch { return false; }
};

/** wf_evidence_record: one atomic JSONL file per whole turn or Codex stop-part; no failure escapes the hook. */
export function evidenceRecord(ctx: Ctx): void {
  try {
    if (OFF.has(ctx.env.WF_EVIDENCE_LEDGER ?? 'on')) return;
    const session = ctx.ev.get('.session');
    const turn = ctx.ev.get('.turn_id');
    if (!safeId(session) || !safeId(turn)) return;
    const turnData = object(ctx.ev.raw.turn);
    const steps = Array.isArray(turnData?.steps) ? turnData.steps : [];
    if (steps.length === 0) return;
    const key = projectKey(ctx.project);
    const root = evidenceRoot(ctx.env);
    if (key.length !== 16 || root === '' || !ensureRoot(root)) return;
    const sessionDir = join(root, key, session);
    if (!privateDir(sessionDir)) return;

    const scoped = ctx.ev.get('.turn_scope') === 'since_last_stop';
    let part = 0;
    let name = `${turn}.jsonl`;
    if (scoped) {
      part = 1;
      while (existsSync(join(sessionDir, `${turn}.${part}.jsonl`))) part++;
      name = `${turn}.${part}.jsonl`;
    }

    const now = stateNow(ctx.project, ctx.cfg);
    const item = itemResolved(now, linkedItem(ctx.project, session, itemSlugs(now), ctx.env)) || null;
    const phase = phaseNow(now) || null;
    const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const lines: string[] = [];
    for (const raw of steps) {
      const step = object(raw);
      const kind = string(step?.kind);
      if (!step || (kind !== 'edit' && kind !== 'cmd')) continue;
      const line: Record<string, unknown> = { ts, agent: ctx.ev.get('.agent'), session, turn, part, seq: step.seq, kind };
      if (kind === 'edit') {
        const file = string(step.file);
        line.file = stripProject(file, ctx.project);
      } else {
        line.cmd = step.cmd;
        line.exit = step.exit;
        line.status = step.status;
      }
      if (step.by !== undefined && step.by !== null && step.by !== false && step.by !== '') line.by = step.by;
      line.item = item; line.phase = phase; line.project = ctx.project;
      lines.push(JSON.stringify(line).replace(/\x7f/g, '\\u007f'));
    }
    atomicPrivateWrite(join(sessionDir, name), 'turn', lines.join('\n') + (lines.length ? '\n' : ''));
    evidencePrune(root);
  } catch { /* wf_evidence_record fails open. */ }
}
