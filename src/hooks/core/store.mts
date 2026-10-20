/** Private, fail-open session state (ported from the 0.2 bash lib.sh). */
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, win32 } from 'node:path';

type Env = NodeJS.ProcessEnv;

const ledgerOn = (env: Env): boolean => !['off', 'no', 'false', '0'].includes(env.WF_EVIDENCE_LEDGER ?? 'on');
const isWindows = process.platform === 'win32';

/** An evidence-root override is honoured only when absolute: a leading `/`, or a drive/UNC path on Windows. The hooks and
 *  the CLI share this one rule, so they always read and write the same ledger. */
export const isAbsoluteOverride = (path: string): boolean =>
  path.startsWith('/') || (isWindows && (isAbsolute(path) || win32.isAbsolute(path)));

/** wf_evidence_root: the external evidence root, with an absolute override only. */
export function evidenceRoot(env: Env = process.env): string {
  try {
    const configured = env.WF_EVIDENCE_DIR ?? '';
    if (isAbsoluteOverride(configured)) return configured;
    return join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'burhan', 'evidence');
  } catch { return ''; }
}

/** wf_project_key: the first 16 hex characters of the physical project's SHA-256. */
export function projectKey(project: string): string {
  try {
    let physical = project;
    try { physical = realpathSync(project); } catch { /* Bash falls back to the supplied path. */ }
    return createHash('sha256').update(physical).digest('hex').slice(0, 16);
  } catch { return ''; }
}

/** wf_safe_id: whether an id can safely be used as one path component. */
export function safeId(id: string): boolean {
  try { return id !== '' && id !== '.' && id !== '..' && /^[A-Za-z0-9._-]+$/.test(id); } catch { return false; }
}

const sessionDir = (project: string, session: string, env: Env, fingerprint = false): string => {
  if (!safeId(session) || (fingerprint && !ledgerOn(env))) return '';
  const root = evidenceRoot(env);
  const key = projectKey(project);
  return root !== '' && key.length === 16 ? join(root, key, session) : '';
};

/** wf_link_file: path to this session's selected-item link, or no path for an unsafe session. */
export function linkFile(project: string, session: string, env: Env = process.env): string {
  try {
    const dir = sessionDir(project, session, env);
    return dir ? join(dir, 'item') : '';
  } catch { return ''; }
}

/** wf_state_snapshot_file: this session's saved Now-slug list. */
export const stateSnapshotFile = (project: string, session: string, env: Env = process.env): string => {
  const dir = sessionDir(project, session, env);
  return dir ? join(dir, 'now-slugs') : '';
};

const fingerprintFile = (project: string, session: string, env: Env): string => {
  const dir = sessionDir(project, session, env, true);
  return dir ? join(dir, 'state-fingerprint') : '';
};

const privateDir = (dir: string): boolean => {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!isWindows) chmodSync(dir, 0o700);
    return true;
  } catch { return false; }
};

const tempPath = (dir: string, prefix: string): string =>
  join(dir, `.${prefix}.${randomBytes(3).toString('hex')}`);

/** Atomic private write used by wf_link_item, wf_state_snapshot, and wf_state_fingerprint_snapshot. */
export function atomicPrivateWrite(file: string, prefix: string, value: string): boolean {
  let tmp = '';
  try {
    const dir = file.slice(0, Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')));
    if (!dir || !privateDir(dir)) return false;
    for (let attempt = 0; attempt < 10; attempt++) {
      tmp = tempPath(dir, prefix);
      try {
        writeFileSync(tmp, value, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        if (!isWindows) chmodSync(tmp, 0o600);
        renameSync(tmp, file);
        tmp = '';
        if (!isWindows) chmodSync(file, 0o600);
        return true;
      } catch {
        try { if (tmp) unlinkSync(tmp); } catch { /* fail open */ }
        tmp = '';
      }
    }
  } catch { /* fail open */ }
  finally { try { if (tmp) unlinkSync(tmp); } catch { /* fail open */ } }
  return false;
}

/** wf_linked_item: read a live, safe session link; closed Now slugs are deliberately ignored. */
export function linkedItem(project: string, session: string, nowSlugs: string[], env: Env = process.env): string {
  try {
    const file = linkFile(project, session, env);
    if (!file) return '';
    const item = readFileSync(file, 'utf8').split(/\r?\n/, 1)[0] ?? '';
    return safeId(item) && nowSlugs.includes(item) ? item : '';
  } catch { return ''; }
}

/** wf_link_item: atomically store a link only for a safe, currently live item. */
export function linkItem(project: string, session: string, item: string, nowSlugs: string[], env: Env = process.env): void {
  try {
    if (!safeId(item) || !nowSlugs.includes(item)) return;
    const file = linkFile(project, session, env);
    if (file) atomicPrivateWrite(file, 'item', `${item}\n`);
  } catch { /* fail open */ }
}

/** wf_state_snapshot: atomically save this session's Now slug list. */
export function stateSnapshot(project: string, session: string, nowSlugs: string[], env: Env = process.env): void {
  try {
    const file = stateSnapshotFile(project, session, env);
    if (file) atomicPrivateWrite(file, 'now', `${nowSlugs.join('\n')}\n`);
  } catch { /* fail open */ }
}

/** wf_state_fingerprint: hash the configured state file, or report it missing/unreadable. */
export function stateFingerprint(project: string, stateFile: string): string {
  try {
    return `file:${createHash('sha256').update(readFileSync(join(project, stateFile))).digest('hex')}`;
  } catch { return 'missing'; }
}

/** wf_state_fingerprint_snapshot: atomically save the current state-file fingerprint. */
export function fingerprintSnapshot(project: string, session: string, stateFile: string, env: Env = process.env): void {
  try {
    const file = fingerprintFile(project, session, env);
    if (file) atomicPrivateWrite(file, 'state', `${stateFingerprint(project, stateFile)}\n`);
  } catch { /* fail open */ }
}

/** wf_state_fingerprint_changed: whether a stored fingerprint differs; no baseline fails closed. */
export function fingerprintChanged(project: string, session: string, stateFile: string, env: Env = process.env): boolean {
  try {
    const file = fingerprintFile(project, session, env);
    if (!file) return false;
    const before = readFileSync(file, 'utf8').split(/\r?\n/, 1)[0] ?? '';
    const now = stateFingerprint(project, stateFile);
    return before !== '' && before !== now;
  } catch { return false; }
}

/** wf_state_fingerprint_refresh: advance a changed baseline and report whether it had a prior value. */
export function fingerprintRefresh(project: string, session: string, stateFile: string, env: Env = process.env): boolean {
  try {
    const file = fingerprintFile(project, session, env);
    if (!file) return false;
    let before = '';
    try { before = readFileSync(file, 'utf8').split(/\r?\n/, 1)[0] ?? ''; } catch { /* missing baseline */ }
    const now = stateFingerprint(project, stateFile);
    if (before !== now) atomicPrivateWrite(file, 'state', `${now}\n`);
    return before !== '' && before !== now;
  } catch { return false; }
}

// The code skill gate's memory: which of its skills ran in this session while an item was the session's item.
// One file per session (`skills`, lines `<slug>\t<skill>`), read and written by turn-audit only.
const CODE_SKILLS = /(^|:)(test-driven-development|systematic-debugging)$/;
const SKILL_LINES_MAX = 200;
const skillsFile = (project: string, session: string, env: Env): string => {
  const dir = sessionDir(project, session, env);
  return dir ? join(dir, 'skills') : '';
};
const skillLines = (file: string): string[] => {
  try { return readFileSync(file, 'utf8').split('\n').filter((line) => line !== ''); } catch { return []; }
};

/** The code-gate skills remembered for this item in this session ([] for no item, or on any error). */
export function rememberedSkills(project: string, session: string, item: string, env: Env = process.env): string[] {
  try {
    if (!safeId(item)) return [];
    const file = skillsFile(project, session, env);
    if (!file) return [];
    return skillLines(file).filter((line) => line.startsWith(`${item}\t`)).map((line) => line.slice(item.length + 1));
  } catch { return []; }
}

/** Remember this turn's code-gate skills for the item; fail open. */
export function rememberSkills(project: string, session: string, item: string, skills: string[], env: Env = process.env): void {
  try {
    if (!safeId(item)) return;
    const wanted = skills.filter((skill) => CODE_SKILLS.test(skill) && !/[\t\n\r]/.test(skill));
    if (wanted.length === 0) return;
    const file = skillsFile(project, session, env);
    if (!file) return;
    const lines = [...new Set([...skillLines(file), ...wanted.map((skill) => `${item}\t${skill}`)])].slice(-SKILL_LINES_MAX);
    atomicPrivateWrite(file, 'skills', `${lines.join('\n')}\n`);
  } catch { /* fail open */ }
}

/** wf_mtime: whole epoch seconds for a readable path. */
export function mtime(path: string): number | null {
  try { return Math.floor(statSync(path).mtimeMs / 1000); } catch { return null; }
}
