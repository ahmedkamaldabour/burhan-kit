import { alt, idx, shellText } from '../../core/jq.mjs';

const eventNames: Record<string, string> = {
  session_start: 'SessionStart',
  prompt: 'UserPromptSubmit',
  pre_shell: 'PreToolUse',
  pre_edit: 'PreToolUse',
  post_edit: 'PostToolUse',
  turn_end: 'Stop',
};

/** Core output -> Claude Code hook output (port of emit.sh). Invalid input, an empty message and unsupported
 *  events are deliberately silent; the message is read as `$(jq -r '.message // empty')` reads it. */
export function emitClaude(event: string, stdin: string): string {
  try {
    const message = shellText(alt(idx(JSON.parse(stdin), 'message'), null));
    if (message === '' || !Object.hasOwn(eventNames, event)) return '';
    return JSON.stringify({ hookSpecificOutput: { hookEventName: eventNames[event], additionalContext: message } }).replace(/\x7f/gu, '\\u007f') + '\n';
  } catch {
    return '';
  }
}
