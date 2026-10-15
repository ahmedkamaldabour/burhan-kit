import { statSync } from 'node:fs';
import { JqError, alt, idx, rawText, shellText } from '../../core/jq.mjs';
import { readRecords, turnFromRecords, type TurnData } from './transcript.mjs';
import { withSubagentSteps } from './subagents.mjs';

type Payload = Record<string, unknown>;

const object = (value: unknown): Payload | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Payload : null;

/** bash's `j <filter>`: the value as text, and an empty string when the filter fails. */
const j = (filter: () => unknown): string => {
  try { return shellText(filter()); } catch { return ''; }
};

/** The event `base()` builds in normalize.sh: same keys, same order. */
const base = (event: string, payload: Payload, env: NodeJS.ProcessEnv) => ({
  event,
  agent: 'claude',
  project_dir: env.CLAUDE_PROJECT_DIR || j(() => payload.cwd),
  session: j(() => payload.session_id),
  turn_id: '' as unknown,
  turn_scope: 'whole',
  prompt: '' as unknown,
  command: '' as unknown,
  file: '',
  turn: { files_created: [], files_edited: [], shell_commands: [], skills_used: [], assistant_text: '', steps: [] } as Omit<TurnData, 'turn_key'>,
  reentrant: false,
});

/** jq -c output: compact, DEL escaped as \u007f, newline-terminated. */
const encoded = (value: unknown): string => JSON.stringify(value)!.replace(/\x7f/gu, '\\u007f') + '\n';

const isFile = (path: string): boolean => {
  try { return statSync(path).isFile(); } catch { return false; }
};

/** Everything after the last real prompt, with subagent steps spliced in — or nothing when jq would have aborted. */
const turnOf = (path: string): Partial<TurnData> => {
  if (path === '' || !isFile(path)) return {};
  try {
    return withSubagentSteps(turnFromRecords(readRecords(path)), `${path.replace(/\.jsonl$/u, '')}/subagents`);
  } catch (error) {
    if (error instanceof JqError) return {};
    throw error;
  }
};

const stop = (payload: Payload, env: NodeJS.ProcessEnv): string => {
  const event = base('turn_end', payload, env);
  const { turn_key, ...turn } = { ...event.turn, ...turnOf(j(() => payload.transcript_path)) } as TurnData;
  event.turn = turn;
  event.turn_id = alt(turn_key, '');
  event.reentrant = payload.stop_hook_active === true;
  // The Stop payload carries the final message, which may not be in the transcript yet (read as `jq -j` writes it).
  const last = rawText(alt(payload.last_assistant_message, ''));
  if (last !== '') {
    const current = event.turn.assistant_text;
    event.turn.assistant_text = (current.endsWith(last) ? current : `${current}\n${last}`).replace(/^\n/u, '');
  }
  return encoded(event);
};

/** Claude Code hook payload -> normalized core event (port of normalize.sh); no output for irrelevant or malformed payloads. */
export function normalizeClaude(stdin: string, env: NodeJS.ProcessEnv): string {
  try {
    const payload = object(JSON.parse(stdin));
    if (!payload) return '';
    const tool = j(() => payload.tool_name);
    switch (j(() => payload.hook_event_name)) {
      case 'SessionStart': return encoded(base('session_start', payload, env));
      case 'UserPromptSubmit': {
        const event = base('prompt', payload, env);
        event.prompt = alt(payload.prompt, '');
        return encoded(event);
      }
      case 'PreToolUse': {
        if (tool !== 'Bash') return '';
        const event = base('pre_shell', payload, env);
        event.command = alt(idx(payload.tool_input, 'command'), '');
        return encoded(event);
      }
      case 'PostToolUse': {
        if (!['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) return '';
        const event = base('post_edit', payload, env);
        event.file = j(() => alt(idx(payload.tool_input, 'file_path'), alt(idx(payload.tool_input, 'notebook_path'), idx(payload.tool_response, 'filePath'))));
        return encoded(event);
      }
      case 'Stop': return stop(payload, env);
      default: return '';
    }
  } catch {
    return '';
  }
}
