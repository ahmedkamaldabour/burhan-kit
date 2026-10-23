import { alt, idx, shellText } from '../../core/jq.mjs';

const eventNames: Record<string, string> = {
  session_start: 'SessionStart',
  prompt: 'UserPromptSubmit',
  pre_shell: 'PreToolUse',
  pre_edit: 'PreToolUse',
  post_edit: 'PostToolUse',
};

const encoded = (value: unknown): string => JSON.stringify(value).replace(/\x7f/gu, '\\u007f') + '\n';

/** Core output -> Codex hook output (port of emit.sh). Stop's schema has no hookSpecificOutput: the model is reached
 *  only through {"decision":"block","reason":…}, which continues the turn once (the core's reentrant guard stops it repeating). */
export function emitCodex(event: string, stdin: string): string {
  try {
    const message = shellText(alt(idx(JSON.parse(stdin), 'message'), null));
    if (message === '') return '';
    if (event === 'turn_end') return encoded({ decision: 'block', reason: message });
    if (!Object.hasOwn(eventNames, event)) return '';
    return encoded({ hookSpecificOutput: { hookEventName: eventNames[event], additionalContext: message } });
  } catch {
    return '';
  }
}
