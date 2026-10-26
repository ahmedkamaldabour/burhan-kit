import { alt, idx, rawText, shellText } from '../../core/jq.mjs';
import { loadHookConfig } from '../../core/config.mjs';
import { relPath } from '../../core/lib.mjs';
import { consume, ledgerFile, readCalls } from './ledger.mjs';
import { patchFiles, skillIds } from './patch.mjs';
import { rolloutExits, type CommandExit } from './rollout.mjs';

type Payload = Record<string, unknown>;

const object = (value: unknown): Payload | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Payload : null;

/** bash's `j <filter>`: the value as text, an empty string when the filter fails. */
const j = (filter: () => unknown): string => {
  try { return shellText(filter()); } catch { return ''; }
};

/** The event `base()` builds in normalize.sh: same keys, same order. */
const base = (event: string, payload: Payload, env: NodeJS.ProcessEnv) => ({
  event,
  agent: 'codex',
  project_dir: env.WF_PROJECT_ROOT || j(() => payload.cwd),
  session: j(() => payload.session_id),
  turn_id: j(() => payload.turn_id),
  turn_scope: 'since_last_stop',
  prompt: '' as unknown,
  command: '' as unknown,
  file: '',
  turn: { files_created: [], files_edited: [], shell_commands: [], skills_used: [], assistant_text: '', steps: [] } as Record<string, unknown>,
  reentrant: false,
});

/** jq -c output: compact, DEL escaped as \u007f, newline-terminated. */
const encoded = (value: unknown): string => JSON.stringify(value)!.replace(/\x7f/gu, '\\u007f') + '\n';

/** jq `tostring`. */
const tostring = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value));

/** The text of a record's `.tool_input.command` as `jq -r '… // empty'` prints it ('' for null/false). */
const commandText = (record: Payload): string => rawText(alt(idx(record.tool_input, 'command'), null));

interface Step { kind: string; [key: string]: unknown }

/** jq `test()` accepts strings only; anything else is an error that gives no steps at all. */
const statusText = (status: unknown): string => {
  const value = alt(status, '');
  if (typeof value !== 'string') throw new Error('rollout status is not a string');
  return value;
};

/** The turn's steps, in call order: edits from applied patches (a patch whose response was "Exit code: N", N != 0,
 *  changed nothing) and commands with the exit code the rollout recorded for their tool_use_id. */
function orderedSteps(calls: Payload[], exits: Map<string, CommandExit>): Step[] {
  const steps: Step[] = [];
  for (const call of calls) {
    if (call.tool_name === 'apply_patch') {
      if (alt(call.patch_exit, 0) !== 0) continue;
      const text = tostring(alt(idx(call.tool_input, 'command'), ''));
      const files = [...new Set(patchFiles(text).map((file) => file.path))];
      for (const file of files) steps.push({ kind: 'edit', file, seq: 0 });
    } else if (call.tool_name === 'Bash') {
      const cmd = alt(idx(call.tool_input, 'command'), '');
      const found = exits.get(tostring(alt(call.tool_use_id, '')));
      let outcome: { exit: unknown; status: string };
      if (found === undefined) outcome = { exit: null, status: 'unknown' };
      else if (found.exit !== null && found.exit !== undefined) outcome = found.exit === 0 ? { exit: 0, status: 'ok' } : { exit: found.exit, status: 'failed' };
      // No exit code: trust the rollout status, never a guess ("declined" etc. never ran).
      else if (/declin|reject|denied/iu.test(statusText(found.status))) outcome = { exit: null, status: 'blocked' };
      else if (alt(found.status, '') === 'completed') outcome = { exit: null, status: 'unknown' };
      else outcome = { exit: null, status: 'failed' };
      steps.push({ kind: 'cmd', cmd, ...outcome, seq: 0 });
    }
  }
  return steps.map((step, index) => ({ ...step, seq: index + 1 }));
}

const nonBlank = (value: string): boolean => /\S/u.test(value);

/** What one `jq` pass over the records yields: jq reports an error for a record it cannot read and carries on with the next. */
const collect = <T,>(calls: Payload[], each: (call: Payload) => T[]): T[] =>
  calls.flatMap((call) => { try { return each(call); } catch { return []; } });

const stop = (payload: Payload, env: NodeJS.ProcessEnv): string => {
  const event = base('turn_end', payload, env);
  const calls = readCalls(ledgerFile(env, j(() => payload.session_id), j(() => payload.turn_id)));
  const patches = collect(calls, (call) => (call.tool_name === 'apply_patch' ? [commandText(call)] : [])).filter((text) => text !== '');
  const files = patchFiles(patches.join('\n'));
  const commands = collect(calls, (call) => {
    if (call.tool_name !== 'Bash') return [];
    const value = alt(idx(call.tool_input, 'command'), null);
    return value === null ? [] : [value];
  });
  const exits = calls.length > 0 ? rolloutExits(j(() => payload.transcript_path)) : new Map<string, CommandExit>();
  event.turn = {
    files_created: files.filter((file) => file.kind === 'A' && nonBlank(file.path)).map((file) => file.path),
    files_edited: files.filter((file) => file.kind === 'E' && nonBlank(file.path)).map((file) => file.path),
    shell_commands: commands,
    skills_used: skillIds(commands.map(rawText)),
    assistant_text: rawText(alt(payload.last_assistant_message, '')),
    steps: (() => { try { return orderedSteps(calls, exits); } catch { return []; } })(), // one jq program: any error gives []
  };
  event.reentrant = payload.stop_hook_active === true;
  return encoded(event);
};

/** The skills the turn has read so far (SKILL.md reads in its Bash calls, from the per-turn ledger). */
function ledgerSkills(event: { session: string; turn_id: string }, env: NodeJS.ProcessEnv): string[] {
  const calls = readCalls(ledgerFile(env, event.session, event.turn_id));
  const commands = collect(calls, (call) => {
    if (call.tool_name !== 'Bash') return [];
    const value = alt(idx(call.tool_input, 'command'), null);
    return value === null ? [] : [value];
  });
  return skillIds(commands.map(rawText));
}

/** Codex hook payload -> normalized core events, one line each (a multi-file patch gives one per file). */
export function normalizeCodexEvents(stdin: string, env: NodeJS.ProcessEnv): string[] {
  try {
    const payload = object(JSON.parse(stdin));
    if (!payload) return [];
    const tool = j(() => payload.tool_name);
    switch (j(() => payload.hook_event_name)) {
      case 'SessionStart': return [encoded(base('session_start', payload, env))];
      case 'UserPromptSubmit': {
        const event = base('prompt', payload, env);
        event.prompt = alt(payload.prompt, '');
        return [encoded(event)];
      }
      case 'PreToolUse': {
        if (tool === 'apply_patch') {
          // Before a patch: the files it writes, and the skills read earlier in this turn (from the ledger). The ledger is read only for a
          // project that turned the skills on; a patch of the state file is always passed on (the core takes its baseline). Codex's pre-tool
          // payload has no assistant text, so the patch lane cannot be seen here.
          const first = base('pre_edit', payload, env);
          const project = first.project_dir.length > 1 && first.project_dir.endsWith('/') ? first.project_dir.slice(0, -1) : first.project_dir;
          const cfg = loadHookConfig(project, env);
          const skillsOn = cfg.WF_SKILLS === 'superpowers';
          const state = cfg.WF_STATE_FILE ?? '';
          const skills = skillsOn ? ledgerSkills(first, env) : [];
          const patch = (() => { try { return rawText(alt(idx(payload.tool_input, 'command'), null)); } catch { return ''; } })();
          return patchFiles(patch).filter((file) => nonBlank(file.path))
            .filter((file) => skillsOn || (state !== '' && relPath(file.path, project).replace(/\\/g, '/') === state))
            .map((file) => encoded({ ...first, file: file.path, turn: { ...first.turn, skills_used: skills } }));
        }
        if (tool !== 'Bash') return [];
        const event = base('pre_shell', payload, env);
        event.command = alt(idx(payload.tool_input, 'command'), '');
        // A shell write of a story, plan or review is reminded like a patch: the skills read earlier in this turn come from the ledger, read only
        // for such a command (a text test first) and only for a project that turned the skills on.
        const command = String(event.command);
        if (/>|\btee\b/u.test(command)) {
          const cfg = loadHookConfig(event.project_dir.length > 1 && event.project_dir.endsWith('/') ? event.project_dir.slice(0, -1) : event.project_dir, env);
          const docs = cfg.WF_DOCS_DIR ?? '';
          if (cfg.WF_SKILLS === 'superpowers' && docs !== '' && command.includes(docs)) return [encoded({ ...event, turn: { ...event.turn, skills_used: ledgerSkills(event, env) } })];
        }
        return [encoded(event)];
      }
      case 'PostToolUse': {
        if (tool !== 'apply_patch') return [];
        const text = (() => { try { return rawText(alt(idx(payload.tool_input, 'command'), null)); } catch { return ''; } })();
        return patchFiles(text).map((file) => encoded({ ...base('post_edit', payload, env), file: file.path }));
      }
      case 'Stop': return [stop(payload, env)];
      default: return [];
    }
  } catch {
    return [];
  }
}

export const normalizeCodex = (stdin: string, env: NodeJS.ProcessEnv): string => normalizeCodexEvents(stdin, env).join('');

/** The turn is over: its ledger is consumed (hook.sh, after the checks ran). */
export const consumeTurnLedger = (payload: Payload, env: NodeJS.ProcessEnv): void =>
  consume(ledgerFile(env, j(() => payload.session_id), j(() => payload.turn_id)));
