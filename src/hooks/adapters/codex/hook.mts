import { alt, idx, shellText } from '../../core/jq.mjs';
import { consumeTurnLedger, normalizeCodexEvents } from './normalize.mjs';
import { emitCodex } from './emit.mjs';
import { prune, recordCall } from './ledger.mjs';

export type CoreRunner = (check: string, stdin: string, env: NodeJS.ProcessEnv) => Promise<string>;

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const text = (value: unknown): string => { try { return shellText(value); } catch { return ''; } };

/** Codex entry (port of hook.sh): a PostToolUse is first appended to the per-turn ledger; then
 *  payload -> events -> the core check -> one message -> Codex output. `record` stops after the ledger (tests).
 *  `isCheck` says whether a core check of that name exists. */
export async function hookCodex(check: string | undefined, stdin: string, rawEnv: NodeJS.ProcessEnv, runCore: CoreRunner, isCheck: (name: string) => boolean, root = ''): Promise<string> {
  try {
    // The project is where the kit is installed, not the session cwd (Codex may start in a subdirectory).
    const env = root === '' ? rawEnv : { ...rawEnv, WF_PROJECT_ROOT: root };
    const payload = object(JSON.parse(stdin));
    if (!payload) return '';
    const event = text(payload.hook_event_name);
    const session = text(payload.session_id);
    const turn = text(payload.turn_id);
    if (event === 'PostToolUse') recordCall(env, session, turn, payload);
    if (check === 'record') return '';
    if (!check || !isCheck(check)) return '';

    let messages = '';
    let kind = '';
    try {
      for (const line of normalizeCodexEvents(stdin, env)) {
        try {
          const out = await runCore(check, line, env);
          if (out === '') continue;
          const message = text(alt(idx(JSON.parse(out), 'message'), null));
          if (message === '') continue;
          kind = text(object(JSON.parse(line))?.event);
          if (!messages.includes(message)) messages = messages === '' ? message : `${messages}\n\n${message}`;
        } catch { /* one event failing must not drop what the others said */ }
      }
    } finally {
      if (event === 'Stop') { consumeTurnLedger(payload, env); prune(env); }
    }
    return messages === '' ? '' : emitCodex(kind, JSON.stringify({ message: messages }));
  } catch {
    return '';
  }
}
