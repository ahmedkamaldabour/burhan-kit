import { statSync } from 'node:fs';
import { JqError, alt, idx, rawText, shellText } from '../../core/jq.mjs';
import { loadHookConfig } from '../../core/config.mjs';
import { readAuditMark, type AuditMark } from '../../core/store.mjs';
import { readRecords, turnWindow, type TurnData } from './transcript.mjs';
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

/** What a Stop should audit: after the last real prompt, minus what an earlier Stop of that prompt already audited
 *  (`since`), with subagent steps spliced in — or nothing when jq would have aborted. */
const turnOf = (path: string, since: AuditMark | null): { turn: Partial<TurnData>; sliced: boolean; mark: AuditMark | null } => {
  const none = { turn: {}, sliced: false, mark: null };
  if (path === '' || !isFile(path)) return none;
  try {
    const window = turnWindow(readRecords(path), since);
    const counts: Record<string, number> = {};
    const turn = withSubagentSteps(window.turn, `${path.replace(/\.jsonl$/u, '')}/subagents`, window.sliced && since ? since.agents : {}, counts);
    const key = typeof turn.turn_key === 'string' ? turn.turn_key : '';
    // The gates ask "this turn": a skill used in an earlier part of the same user turn still counts in a later part.
    if (window.sliced && since) turn.skills_used = [...new Set([...since.skills, ...(turn.skills_used ?? [])])];
    const skills = (turn.skills_used ?? []).slice(-100);
    return { turn, sliced: window.sliced, mark: key !== '' && window.upTo !== '' ? { turn: key, upTo: window.upTo, agents: counts, skills } : null };
  } catch (error) {
    if (error instanceof JqError) return none;
    throw error;
  }
};

/** The environment the session store is read and written with: the core's own (the project's workflow.config over the
 *  process environment), so the mark lives where the ledger does — WF_EVIDENCE_DIR and WF_EVIDENCE_LEDGER may be set in the config. */
export function storeEnv(project: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  try { return { ...env, ...loadHookConfig(project, env) }; } catch { return env; }
}
export const plainProject = (project: string): string => (project.length > 1 && project.endsWith('/') ? project.slice(0, -1) : project);

/** The normalized Stop event, and the mark to save once the core has audited it. */
export interface StopWindow { event: string; mark: AuditMark | null; project: string; session: string }

const stop = (payload: Payload, env: NodeJS.ProcessEnv): StopWindow => {
  const event = base('turn_end', payload, env);
  const project = event.project_dir;
  const since = readAuditMark(plainProject(project), event.session, storeEnv(plainProject(project), env));
  const found = turnOf(j(() => payload.transcript_path), since);
  const { turn_key, ...turn } = { ...event.turn, ...found.turn } as TurnData;
  event.turn = turn;
  event.turn_id = alt(turn_key, '');
  if (found.sliced) event.turn_scope = 'since_last_stop';
  event.reentrant = payload.stop_hook_active === true;
  // The Stop payload carries the final message, which may not be in the transcript yet (read as `jq -j` writes it).
  const last = rawText(alt(payload.last_assistant_message, ''));
  if (last !== '') {
    const current = event.turn.assistant_text;
    event.turn.assistant_text = (current.endsWith(last) ? current : `${current}\n${last}`).replace(/^\n/u, '');
  }
  return { event: encoded(event), mark: found.mark, project, session: event.session };
};

/** Claude Code hook payload -> the normalized event and, for a Stop, the audit mark to save afterwards (`prepareClaude`). */
export function prepareClaude(stdin: string, env: NodeJS.ProcessEnv): StopWindow {
  const none: StopWindow = { event: '', mark: null, project: '', session: '' };
  try {
    const payload = object(JSON.parse(stdin));
    if (!payload) return none;
    const tool = j(() => payload.tool_name);
    const plain = (event: string): StopWindow => ({ ...none, event });
    switch (j(() => payload.hook_event_name)) {
      case 'SessionStart': return plain(encoded(base('session_start', payload, env)));
      case 'UserPromptSubmit': {
        const event = base('prompt', payload, env);
        event.prompt = alt(payload.prompt, '');
        return plain(encoded(event));
      }
      case 'PreToolUse': {
        if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
          // Before a write: the file, and what this user turn has used so far (skills, the assistant's own text). Only for a project that
          // turned the skills on: nothing else reads it, and the transcript is not parsed for nothing on every write.
          const event = base('pre_edit', payload, env);
          if (loadHookConfig(plainProject(event.project_dir), env).WF_SKILLS !== 'superpowers') return none;
          event.file = j(() => alt(idx(payload.tool_input, 'file_path'), idx(payload.tool_input, 'notebook_path')));
          const { turn_key: _key, ...turn } = { ...event.turn, ...turnOf(j(() => payload.transcript_path), null).turn } as TurnData;
          event.turn = turn;
          // Set when the write comes from a subagent: it has no Skill tool, so the check says nothing to it.
          return plain(encoded({ ...event, agent_id: j(() => payload.agent_id) }));
        }
        if (tool !== 'Bash') return none;
        const event = base('pre_shell', payload, env);
        event.command = alt(idx(payload.tool_input, 'command'), '');
        // A shell write of a story, plan or review is reminded like an edit-tool write: the transcript is read only then (a text test first,
        // so an ordinary command costs nothing), and only for a project that turned the skills on.
        const command = String(event.command);
        if (/>|\btee\b/u.test(command)) {
          const cfg = loadHookConfig(plainProject(event.project_dir), env);
          const docs = cfg.WF_DOCS_DIR ?? '';
          if (cfg.WF_SKILLS === 'superpowers' && docs !== '' && command.includes(docs)) {
            const { turn_key: _key, ...turn } = { ...event.turn, ...turnOf(j(() => payload.transcript_path), null).turn } as TurnData;
            return plain(encoded({ ...event, turn, agent_id: j(() => payload.agent_id) }));
          }
        }
        return plain(encoded(event));
      }
      case 'PostToolUse': {
        if (!['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) return none;
        const event = base('post_edit', payload, env);
        event.file = j(() => alt(idx(payload.tool_input, 'file_path'), alt(idx(payload.tool_input, 'notebook_path'), idx(payload.tool_response, 'filePath'))));
        return plain(encoded(event));
      }
      case 'Stop': return stop(payload, env);
      default: return none;
    }
  } catch {
    return none;
  }
}

/** Claude Code hook payload -> normalized core event (port of normalize.sh); no output for irrelevant or malformed payloads. */
export const normalizeClaude = (stdin: string, env: NodeJS.ProcessEnv): string => prepareClaude(stdin, env).event;
