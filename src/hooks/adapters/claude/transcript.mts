import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs';
import { JqError } from '../../core/jq.mjs';
import type { AuditMark } from '../../core/store.mjs';

/** `performed_by`: the text this edit wrote (Write content, Edit new_string …) has a `Performed by:` line — the mark of a review. Never the text itself. */
export type EditStep = { kind: 'edit'; file: string; seq: number; _ts?: unknown; by?: string; performed_by?: true };
export type CommandStep = { kind: 'cmd'; cmd: string; exit: number | null; status: 'background' | 'unknown' | 'ok' | 'failed' | 'blocked'; seq: number; _ts?: unknown; by?: string };
export type AgentStep = { kind: 'agent'; tool_id: string; agent_id: string | null; async: boolean; by: string; seq: number; _ts?: unknown };
export type Step = EditStep | CommandStep | AgentStep;

export type TurnData = {
  files_created: string[];
  files_edited: string[];
  shell_commands: string[];
  skills_used: string[];
  assistant_text: string;
  steps: Step[];
  /** The prompt record's uuid as it is (jq passes any JSON value through), '' when there is none. */
  turn_key: unknown;
};

type Result = { err: boolean; kind: unknown; agent: string | null; async: boolean; text: string };

const CHUNK = 64 * 1024;
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const fallback = <T,>(value: T | null | undefined | false, otherwise: T): T => value === null || value === undefined || value === false ? otherwise : value;
const string = (value: unknown): string => typeof value === 'string' ? value : '';
const key = (value: unknown): string => String(fallback(value as string | null | undefined | false, ''));
/** `.input` of a tool call: null means no fields, anything else that is no object makes jq abort the whole program. */
const input = (part: Record<string, unknown>): Record<string, unknown> => {
  if (part.input === null || part.input === undefined) return {};
  const value = object(part.input);
  if (!value) throw new JqError(`tool_use input of ${String(part.name)} is not an object`);
  return value;
};

/** Last maxLines physical lines, parsed fail-open as JSON objects. */
export function readRecords(path: string, maxLines = 20_000): Record<string, unknown>[] {
  if (maxLines <= 0) return [];
  let fd: number | undefined;
  try {
    if (!statSync(path).isFile()) return []; // `[ -f ]` — a FIFO or a directory is not read (opening a FIFO would block)
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    if (size === 0) return [];
    const final = Buffer.allocUnsafe(1);
    readSync(fd, final, 0, 1, size - 1);
    const wantedNewlines = maxLines + (final[0] === 0x0a ? 1 : 0);
    let at = size;
    let seen = 0;
    let start = 0;
    while (at > 0) {
      const length = Math.min(CHUNK, at);
      at -= length;
      const chunk = Buffer.allocUnsafe(length);
      readSync(fd, chunk, 0, length, at);
      for (let index = length - 1; index >= 0; index--) {
        if (chunk[index] !== 0x0a) continue;
        seen++;
        if (seen === wantedNewlines) {
          start = at + index + 1;
          at = 0;
          break;
        }
      }
    }
    const length = size - start;
    const bytes = Buffer.allocUnsafe(length);
    readSync(fd, bytes, 0, length, start);
    const records: Record<string, unknown>[] = [];
    for (const line of bytes.toString('utf8').replaceAll('\0', '').split('\n')) {
      try {
        const parsed = JSON.parse(line);
        const row = object(parsed);
        if (row) records.push(row);
      } catch { /* Garbage transcript lines are deliberately ignored. */ }
    }
    return records;
  } catch {
    return [];
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* fail open */ }
  }
}

const promptLike = (record: Record<string, unknown>): boolean => {
  if (record.type !== 'user' || record.isMeta === true || record.isSidechain === true || record.isCompactSummary === true) return false;
  const content = object(record.message)?.content;
  if (typeof content === 'string') return !/^\s*<task-notification>/u.test(content);
  if (!Array.isArray(content)) return false;
  const parts = content.map(object).filter((part): part is Record<string, unknown> => part !== null);
  return !parts.some((part) => part.type === 'tool_result') && parts.some((part) => part.type === 'text' || part.type === 'image');
};

const results = (records: Record<string, unknown>[]): Map<string, Result> => {
  const out = new Map<string, Result>();
  for (const record of records) {
    if (record.type !== 'user') continue;
    const content = object(record.message)?.content;
    if (!Array.isArray(content)) continue;
    const toolUseResult = object(record.toolUseResult);
    for (const item of content) {
      const part = object(item);
      if (!part || part.type !== 'tool_result') continue;
      const raw = part.content;
      const text = typeof raw === 'string' ? raw : Array.isArray(raw)
        ? raw.map(object).filter((value): value is Record<string, unknown> => value !== null).map((value) => string(fallback(value.text as string | null | undefined | false, ''))).join('\n')
        : '';
      out.set(key(part.tool_use_id), {
        err: part.is_error === true,
        kind: fallback(toolUseResult?.type, null),
        agent: typeof toolUseResult?.agentId === 'string' ? toolUseResult.agentId : null,
        async: toolUseResult?.isAsync === true || fallback(toolUseResult?.status, '') === 'async_launched',
        text,
      });
    }
  }
  return out;
};

const toolParts = (records: Record<string, unknown>[]): Record<string, unknown>[] => {
  const parts: Record<string, unknown>[] = [];
  for (const record of records) {
    if (record.type !== 'assistant') continue;
    const content = object(record.message)?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      const part = object(item);
      if (part) parts.push({ ...part, _ts: record.timestamp ?? null });
    }
  }
  return parts;
};

const steps = (parts: Record<string, unknown>[], byId: Map<string, Result>): Step[] => {
  const out: Step[] = [];
  for (const part of parts) {
    if (part.type !== 'tool_use') continue;
    const result = byId.get(key(part.id));
    const name = part.name;
    const ts = part._ts;
    if (name === 'Write' || name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') {
      if (result?.err === true) continue;
      const toolInput = input(part);
      const edits = Array.isArray(toolInput.edits) ? toolInput.edits.map(object).filter((e): e is Record<string, unknown> => e !== null).map((e) => string(e.new_string)) : [];
      const written = [string(toolInput.content), string(toolInput.new_string), ...edits, string(toolInput.new_source)].join('\n');
      out.push({ kind: 'edit', file: string(fallback(toolInput.file_path as string | null | undefined | false, fallback(toolInput.notebook_path as string | null | undefined | false, ''))), seq: 0, _ts: ts, ...(/performed by:/iu.test(written) ? { performed_by: true } : {}) });
    } else if (name === 'Bash') {
      const toolInput = input(part);
      const cmd = string(fallback(toolInput.command as string | null | undefined | false, ''));
      let exit: number | null;
      let status: CommandStep['status'];
      if (fallback(toolInput.run_in_background as boolean | null | undefined | false, false) === true) { exit = null; status = 'background'; }
      else if (!result) { exit = null; status = 'unknown'; }
      else if (!result.err) { exit = 0; status = 'ok'; }
      else {
        const match = /^\s*(?:Error: )?Exit code ([0-9]+)/u.exec(result.text);
        if (match) { exit = Number(match[1]); status = 'failed'; }
        else if (/was blocked|requires? approval|can.t be checked before it runs|denied|not allowed|permission|tool use was rejected|doesn.t want to proceed/iu.test(result.text)) { exit = null; status = 'blocked'; }
        else { exit = null; status = 'failed'; }
      }
      out.push({ kind: 'cmd', cmd, exit, status, seq: 0, _ts: ts });
    } else if (name === 'Agent' || name === 'Task') {
      const toolInput = input(part);
      const rawBy = String(fallback(toolInput.subagent_type as string | null | undefined | false, '')).replace(/[\t\n\r]/g, ' ');
      out.push({ kind: 'agent', tool_id: key(part.id), agent_id: result?.agent ?? null,
        async: (result?.async ?? false) || fallback(toolInput.run_in_background as boolean | null | undefined | false, false) === true,
        by: /^\s*$/u.test(rawBy) ? 'subagent' : rawBy, seq: 0, _ts: ts });
    }
  }
  return out.map((step, index) => ({ ...step, seq: index + 1 }) as Step);
};

/** Builds evidence steps from a complete transcript without applying turn slicing. */
export function stepsOfRecords(records: Record<string, unknown>[]): Step[] {
  return steps(toolParts(records), results(records));
}

/** Builds the main-turn fields; Agent placeholders remain for the subagent splice. */
export function turnFromRecords(records: Record<string, unknown>[]): TurnData {
  return turnWindow(records, null).turn;
}

/** The turn as one Stop should audit it. With the mark of an earlier Stop of the same prompt, only the records after that
 *  Stop's last record count (`sliced`); the Agent launches from before it stay, so an agent that finishes later is still
 *  spliced in (its already-audited steps are skipped by the caller). A mark that does not match gives the whole turn. */
export function turnWindow(records: Record<string, unknown>[], since: AuditMark | null): { turn: TurnData; sliced: boolean; upTo: string } {
  let promptIndex = -1;
  for (let index = 0; index < records.length; index++) if (promptLike(records[index])) promptIndex = index;
  const turnKey = promptIndex >= 0 ? fallback(records[promptIndex].uuid as unknown, '') : '';
  const window = records.slice(promptIndex + 1);
  let start = 0;
  let sliced = false;
  if (since !== null && since.turn === turnKey) {
    const at = window.findIndex((record) => record.uuid === since.upTo);
    if (at >= 0) { start = at + 1; sliced = true; }
  }
  const isMain = (record: Record<string, unknown>): boolean => record.isSidechain !== true;
  const turn = window.slice(start).filter(isMain);
  const earlyAgents = toolParts(window.slice(0, start).filter(isMain)).filter((part) => part.type === 'tool_use' && (part.name === 'Agent' || part.name === 'Task'));
  const parts = toolParts(turn);
  const byId = results(window.filter(isMain));
  const successful = parts.filter((part) => part.type === 'tool_use' && byId.get(key(part.id))?.err !== true);
  /** A tool input's first present field among `keys` (jq `.a // .b // empty`): '' is a value, null and false are absent. */
  const field = (part: Record<string, unknown>, keys: string[]): string[] => {
    const toolInput = input(part);
    const present = keys.find((k) => fallback(toolInput[k] as string | null | undefined | false, null) !== null);
    return present === undefined ? [] : [string(toolInput[present])];
  };
  const created = successful.filter((part) => part.name === 'Write' && fallback(byId.get(key(part.id))?.kind, 'create') !== 'update');
  const edited = successful.filter((part) => part.name === 'Edit' || part.name === 'MultiEdit' || part.name === 'NotebookEdit' || (part.name === 'Write' && byId.get(key(part.id))?.kind === 'update'));
  const last = [...records].reverse().find((record) => typeof record.uuid === 'string' && record.uuid !== '');
  return {
    turn: {
      files_created: created.flatMap((part) => field(part, ['file_path'])),
      files_edited: edited.flatMap((part) => field(part, part.name === 'Write' ? ['file_path'] : ['file_path', 'notebook_path'])),
      shell_commands: successful.filter((part) => part.name === 'Bash').flatMap((part) => field(part, ['command'])),
      skills_used: successful.filter((part) => part.name === 'Skill').flatMap((part) => field(part, ['skill'])),
      assistant_text: parts.filter((part) => part.type === 'text').map((part) => string(part.text)).join('\n'),
      steps: steps([...earlyAgents, ...parts], byId),
      turn_key: turnKey,
    },
    sliced,
    upTo: last === undefined ? '' : String(last.uuid),
  };
}
