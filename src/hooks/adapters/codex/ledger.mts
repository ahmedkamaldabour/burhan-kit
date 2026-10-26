import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { alt } from '../../core/jq.mjs';

/** The per-turn ledger of Codex tool calls (port of ledger.sh): outside the project, private, command lines only. */
const MARKER = '.burhan-ledger';
const PRUNE_AFTER_DAYS = 2;

const isFile = (path: string): boolean => { try { return statSync(path).isFile(); } catch { return false; } };

export const ledgerDir = (env: NodeJS.ProcessEnv): string =>
  env.WF_CODEX_LEDGER_DIR || join(env.XDG_STATE_HOME || join(env.HOME || homedir(), '.local/state'), 'burhan/codex');

/** A session or turn id becomes a path component: a safe charset only, never . or .. */
export const validId = (id: string): boolean => id !== '' && id !== '.' && id !== '..' && /^[A-Za-z0-9._-]+$/u.test(id);

export const ledgerFile = (env: NodeJS.ProcessEnv, session: string, turn: string): string =>
  validId(session) && validId(turn) ? join(ledgerDir(env), session, `${turn}.jsonl`) : '';

const payloadExit = (payload: Record<string, unknown>): number | null => {
  if (payload.tool_name !== 'apply_patch') return null;
  const response = alt(payload.tool_response, '');
  const text = typeof response === 'string' ? response : JSON.stringify(response);
  const match = /^Exit code: ([0-9]+)/u.exec(text);
  return match ? Number(match[1]) : null;
};

/** Appends what the turn audit needs of one PostToolUse — the call, its id and a patch's exit code — never the output. */
export function recordCall(env: NodeJS.ProcessEnv, session: string, turn: string, payload: Record<string, unknown>): void {
  const file = ledgerFile(env, session, turn);
  if (file === '') return;
  try {
    const root = ledgerDir(env);
    if (!existsSync(root)) { mkdirSync(root, { recursive: true, mode: 0o700 }); writeFileSync(join(root, MARKER), '', { mode: 0o600 }); }
    mkdirSync(join(root, session), { recursive: true, mode: 0o700 });
    // A patch names files relative to the session folder; keep that folder only when it is not the project root (the common case stays unchanged).
    const patchCwd = payload.tool_name === 'apply_patch' && typeof payload.cwd === 'string' && payload.cwd !== '' && (env.WF_PROJECT_ROOT ?? '') !== '' && payload.cwd !== env.WF_PROJECT_ROOT ? { cwd: payload.cwd } : {};
    const record = { tool_name: payload.tool_name ?? null, tool_input: payload.tool_input ?? null, tool_use_id: payload.tool_use_id ?? null, patch_exit: payloadExit(payload), ...patchCwd };
    appendFileSync(file, JSON.stringify(record).replace(/\x7f/gu, '\\u007f') + '\n', { mode: 0o600 });
  } catch { /* no ledger, never a broken hook */ }
}

/** The turn's records, in call order; a torn or corrupted line is skipped. */
export function readCalls(file: string): Record<string, unknown>[] {
  if (file === '') return [];
  let text: string;
  try { text = readFileSync(file, 'utf8'); } catch { return []; }
  const calls: Record<string, unknown>[] = [];
  for (const line of text.split('\n')) {
    try {
      const value: unknown = JSON.parse(line);
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) calls.push(value as Record<string, unknown>);
    } catch { /* skip */ }
  }
  return calls;
}

/** The turn is over: its ledger is consumed. */
export function consume(file: string): void {
  if (file === '') return;
  try { rmSync(file, { force: true }); } catch { /* fail open */ }
}

/** Removes session dirs older than two days — only inside a directory this kit created (it carries the marker), only
 *  safe-id dirs that hold nothing but turn ledgers, never "/" or $HOME themselves. */
export function prune(env: NodeJS.ProcessEnv, now = Date.now()): void {
  try {
    const root = realpathSync(ledgerDir(env));
    let home = '';
    try { home = realpathSync(env.HOME || homedir()); } catch { /* no home */ }
    if (root === '/' || root === home || !isFile(join(root, MARKER))) return;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !validId(entry.name)) continue;
      const dir = join(root, entry.name);
      // find -mtime +2: whole days elapsed, rounded down, greater than 2
      if (Math.floor((now - statSync(dir).mtimeMs) / 86_400_000) <= PRUNE_AFTER_DAYS) continue;
      // find -mindepth 1 ! -name '*.jsonl': anything at any depth that is not a ledger file blocks the removal
      if (readdirSync(dir, { recursive: true }).some((name) => !basename(String(name)).endsWith('.jsonl'))) continue;
      rmSync(dir, { recursive: true, force: true });
    }
  } catch { /* fail open */ }
}
