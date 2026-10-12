export interface HookEntry { type?: string; command?: string; timeout?: number; [k: string]: unknown }
export interface HookGroup { matcher?: string; hooks: HookEntry[]; [k: string]: unknown }
export interface Settings { hooks?: Record<string, HookGroup[]> | null; [k: string]: unknown }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

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
