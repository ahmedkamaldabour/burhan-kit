import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

export interface HookEntry { type?: string; command?: string; timeout?: number; [k: string]: unknown }
export interface HookGroup { matcher?: string; hooks: HookEntry[]; [k: string]: unknown }
export interface Settings { hooks?: Record<string, HookGroup[]> | null; [k: string]: unknown }
export interface ExistingHook {
  agent: 'claude' | 'codex';
  event: string;
  command: string;
  matcher?: string;
  groupIndex: number;
  hookIndex: number;
  hookJson: string;
}

const HOOKS_FILE = { claude: '.claude/settings.json', codex: '.codex/hooks.json' } as const;
const BURHAN_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};

const validEntry = (e: unknown): boolean => isObject(e) && (e.command === undefined || typeof e.command === 'string');
const validGroup = (g: unknown): boolean =>
  isObject(g) && (g.hooks === undefined || (Array.isArray(g.hooks) && g.hooks.every(validEntry)));

/** Settings whose "hooks" (if present) maps event names to arrays of groups, each group an object
 *  whose "hooks" (if present) is an array of entries with a string "command" (if present). */
export function validHooksFile(v: unknown): v is Settings {
  if (!isObject(v)) return false;
  const h = v.hooks;
  if (h === undefined || h === null) return true;
  return isObject(h) && Object.values(h).every((groups) => Array.isArray(groups) && groups.every(validGroup));
}

/** Reads user commands on events burhan uses. Bad or missing files are left for install's validation. */
export function readExistingHooks(target: string, agents: readonly ('claude' | 'codex')[]): ExistingHook[] {
  const out: ExistingHook[] = [];
  let root: string;
  try { root = realpathSync(target); } catch { return out; }
  for (const agent of agents) {
    const file = join(root, HOOKS_FILE[agent]);
    let realFile: string;
    try { realFile = realpathSync(file); } catch { continue; }
    if (!inside(root, realFile)) continue;
    let settings: unknown;
    try { settings = JSON.parse(readFileSync(realFile, 'utf8')); } catch { continue; }
    if (!isObject(settings) || !isObject(settings.hooks)) continue;
    const marker = `.workflow/hooks/adapters/${agent}/hook.sh`;
    for (const [event, groups] of Object.entries(settings.hooks)) {
      if (!BURHAN_EVENTS.has(event) || !Array.isArray(groups)) continue;
      for (const [groupIndex, group] of groups.entries()) {
        if (!isObject(group) || !Array.isArray(group.hooks)) continue;
        const matcher = typeof group.matcher === 'string' ? group.matcher : undefined;
        for (const [hookIndex, entry] of group.hooks.entries()) {
          if (!isObject(entry) || typeof entry.command !== 'string' || entry.command.includes(marker)) continue;
          out.push({ agent, event, command: entry.command, ...(matcher === undefined ? {} : { matcher }), groupIndex, hookIndex, hookJson: JSON.stringify(entry) });
        }
      }
    }
  }
  return out;
}

/** Our entries (commands containing `marker`) are replaced by the snippet's; everything else is kept. */
export function mergeHooks(current: Settings, snippet: Settings, marker: string, preCommitTimeout: number): Settings {
  const ours = structuredClone(snippet.hooks ?? {});
  for (const g of ours.PreToolUse ?? [])
    for (const e of g.hooks) if ((e.command ?? '').includes('pre-commit-check')) e.timeout = preCommitTimeout;
  const out = structuredClone(current);
  const hooks: Record<string, HookGroup[]> = { ...(out.hooks ?? {}) };
  for (const [event, groups] of Object.entries(ours)) {
    const kept = (hooks[event] ?? []).flatMap((g) => {
      if (!Array.isArray(g.hooks)) return [g];
      const rest = g.hooks.filter((e) => !(e.command ?? '').includes(marker));
      return rest.length ? [{ ...g, hooks: rest }] : [];
    });
    hooks[event] = [...kept, ...groups];
  }
  out.hooks = hooks;
  return out;
}

/** `current` without our entries (a command exactly equal to one in `commands`, whatever its timeout). Groups and events left empty by that
 *  disappear, and so does an empty "hooks" key. null → nothing else is left in the file (delete it). */
export function removeHooks(current: Settings, commands: readonly string[]): Settings | null {
  const ours = new Set(commands);
  const out = structuredClone(current);
  if (isObject(out.hooks)) {
    const hooks: Record<string, HookGroup[]> = {};
    for (const [event, groups] of Object.entries(out.hooks)) {
      const kept = groups.flatMap((g) => {
        if (!Array.isArray(g.hooks)) return [g];
        const rest = g.hooks.filter((e) => !(typeof e.command === 'string' && ours.has(e.command)));
        if (rest.length === g.hooks.length) return [g];
        return rest.length ? [{ ...g, hooks: rest }] : [];
      });
      if (kept.length) hooks[event] = kept;
    }
    if (Object.keys(hooks).length) out.hooks = hooks; else delete out.hooks;
  } else if (out.hooks === null) delete out.hooks;
  return Object.keys(out).length ? out : null;
}
