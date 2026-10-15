import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { kitDir } from './kit.js';

export interface HookEntry { type?: string; command?: string; args?: string[]; timeout?: number; [k: string]: unknown }
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

const validEntry = (e: unknown): boolean => isObject(e) && (e.command === undefined || typeof e.command === 'string')
  && (e.args === undefined || (Array.isArray(e.args) && e.args.every((a) => typeof a === 'string')));
const validGroup = (g: unknown): boolean =>
  isObject(g) && (g.hooks === undefined || (Array.isArray(g.hooks) && g.hooks.every(validEntry)));

/** Who owns a hook entry: its command and, for the exec form (Claude Code: `command` + `args`, no shell), its args.
 *  Every Node entry starts with `node`, so the command alone could not tell ours from a user's own `node` hook. */
export const hookKey = (e: HookEntry): string => (e.args === undefined ? (e.command ?? '') : `${e.command ?? ''}\u0000${JSON.stringify(e.args)}`);

/** The keys of every command entry in a snippet. */
export const snippetKeys = (s: Settings): string[] =>
  Object.values(s.hooks ?? {}).flatMap((groups) => groups.flatMap((g) => (g.hooks ?? []).flatMap((e) => typeof e.command === 'string' ? [hookKey(e)] : [])));

/** Settings whose "hooks" (if present) maps event names to arrays of groups, each group an object
 *  whose "hooks" (if present) is an array of entries with a string "command" and an array of string "args" (if present). */
export function validHooksFile(v: unknown): v is Settings {
  if (!isObject(v)) return false;
  const h = v.hooks;
  if (h === undefined || h === null) return true;
  return isObject(h) && Object.values(h).every((groups) => Array.isArray(groups) && groups.every(validGroup));
}

/** Everything burhan has ever written for this agent: the kit's bash and Node snippets, and the bash snippet an
 *  older install left in the project — so an upgrade from any layout replaces the old entries instead of duplicating them. */
export function burhanHookKeys(target: string, agent: 'claude' | 'codex'): string[] {
  const name = agent === 'claude' ? 'settings' : 'hooks';
  const rels = [`hooks/adapters/${agent}/${name}.snippet.json`, `hooks/adapters/${agent}/${name}.node.snippet.json`];
  // The kit's snippets, the bash one an older project holds, and the Node one this project was installed with (kept so a later
  // release that changes an entry still recognises the old one as ours).
  return [...rels.map((r) => join(kitDir(), r)), join(target, '.burhan', rels[0]), join(target, '.burhan/hooks/node/snippets', `${agent}.snippet.json`)].flatMap((file) => {
    try {
      const settings: unknown = JSON.parse(readFileSync(file, 'utf8'));
      return validHooksFile(settings) ? snippetKeys(settings) : [];
    } catch { return []; }
  });
}

/** True when the agent's hook file holds one of our entries (any layout burhan ever wrote). A file that is no longer valid
 *  JSON still counts when it mentions our installed entry, so a broken file is reported rather than forgotten. */
export function ownsHooks(target: string, agent: 'claude' | 'codex'): boolean {
  let text: string;
  try { text = readFileSync(join(target, HOOKS_FILE[agent]), 'utf8'); } catch { return false; }
  let v: unknown;
  try { v = JSON.parse(text); } catch { return /\.burhan[/'](?:,'|\/)?hooks/u.test(text) && /main\.mjs|hook\.sh/u.test(text); }
  if (!validHooksFile(v)) return false;
  const keys = new Set(burhanHookKeys(target, agent));
  return Object.values(v.hooks ?? {}).some((groups) => groups.some((g) => (g.hooks ?? []).some((e) => typeof e.command === 'string' && keys.has(hookKey(e)))));
}

/** Whether burhan is installed for this agent: its bash adapter directory (0.2 layout), one of our hook entries, or the
 *  files only burhan writes for it (Claude Code: the managed /burhan commands; Codex: the AGENTS.md block). */
export function agentInstalled(target: string, agent: 'claude' | 'codex'): boolean {
  if (existsSync(join(target, '.burhan/hooks/adapters', agent)) || ownsHooks(target, agent)) return true;
  if (agent === 'claude') return existsSync(join(target, '.claude/commands/burhan/e2e.md'));
  try { return readFileSync(join(target, 'AGENTS.md'), 'utf8').includes('<!-- burhan:start -->'); } catch { return false; }
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
    const owned = new Set(burhanHookKeys(root, agent));
    for (const [event, groups] of Object.entries(settings.hooks)) {
      if (!BURHAN_EVENTS.has(event) || !Array.isArray(groups)) continue;
      for (const [groupIndex, group] of groups.entries()) {
        if (!isObject(group) || !Array.isArray(group.hooks)) continue;
        const matcher = typeof group.matcher === 'string' ? group.matcher : undefined;
        for (const [hookIndex, entry] of group.hooks.entries()) {
          if (!isObject(entry) || typeof entry.command !== 'string' || owned.has(hookKey(entry as HookEntry))) continue;
          out.push({ agent, event, command: entry.command, ...(matcher === undefined ? {} : { matcher }), groupIndex, hookIndex, hookJson: JSON.stringify(entry) });
        }
      }
    }
  }
  return out;
}

/** Exact owned commands are replaced by the snippet's; everything else is kept. */
export function mergeHooks(current: Settings, snippet: Settings, keys: readonly string[], preCommitTimeout: number): Settings {
  const ours = structuredClone(snippet.hooks ?? {});
  for (const g of ours.PreToolUse ?? [])
    for (const e of g.hooks) if ((e.command ?? '').includes('pre-commit-check') || (e.args ?? []).includes('pre-commit-check')) e.timeout = preCommitTimeout;
  const out = removeHooks(current, keys) ?? {};
  const hooks: Record<string, HookGroup[]> = { ...(out.hooks ?? {}) };
  for (const [event, groups] of Object.entries(ours)) {
    hooks[event] = [...(hooks[event] ?? []), ...groups];
  }
  out.hooks = hooks;
  return out;
}

/** `current` without our entries (an entry whose key is one of `keys`, whatever its timeout). Groups and events left empty by that
 *  disappear, and so does an empty "hooks" key. null → nothing else is left in the file (delete it). */
export function removeHooks(current: Settings, keys: readonly string[]): Settings | null {
  const ours = new Set(keys);
  const out = structuredClone(current);
  let removed = false;
  if (isObject(out.hooks)) {
    const hooks: Record<string, HookGroup[]> = {};
    for (const [event, groups] of Object.entries(out.hooks)) {
      const kept = groups.flatMap((g) => {
        if (!Array.isArray(g.hooks)) return [g];
        const rest = g.hooks.filter((e) => !(typeof e.command === 'string' && ours.has(hookKey(e))));
        if (rest.length === g.hooks.length) return [g];
        removed = true;
        return rest.length ? [{ ...g, hooks: rest }] : [];
      });
      if (kept.length || groups.length === 0) hooks[event] = kept;
    }
    if (removed) {
      if (Object.keys(hooks).length) out.hooks = hooks; else delete out.hooks;
    }
  }
  return !removed || Object.keys(out).length ? out : null;
}
