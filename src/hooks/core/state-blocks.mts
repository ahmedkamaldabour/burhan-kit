/** Who works on an item block of the shared state file: another session of this project whose link names the slug and whose ledger moved in
 *  the last 24 h. Read-only: only this session's own files are ever written. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evidenceRoot, mtime, projectKey, safeId } from './store.mjs';

const DAY = 86400;

/** Seconds since the newest ledger file of the newest-active other session working on `slug`, or null when none is live. */
export function liveOwnerAge(project: string, mine: string, slug: string, env: NodeJS.ProcessEnv, nowSeconds = Math.floor(Date.now() / 1000)): number | null {
  const root = join(evidenceRoot(env), projectKey(project));
  let best: number | null = null;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === mine || !safeId(entry.name)) continue;
    const dir = join(root, entry.name);
    try {
      if ((readFileSync(join(dir, 'item'), 'utf8').split('\n')[0] ?? '') !== slug) continue;
      for (const ledger of readdirSync(dir)) {
        if (!ledger.endsWith('.jsonl')) continue;
        const then = mtime(join(dir, ledger));
        if (then === null) continue;
        const age = Math.max(0, nowSeconds - then);
        if (age < DAY && (best === null || age < best)) best = age;
      }
    } catch { /* one malformed foreign session cannot hide another */ }
  }
  return best;
}

/** A slug as printed in a warning: a long one is cut (the state file is a snapshot, but nothing bounds a heading). */
export const slugText = (slug: string): string => (slug.length > 80 ? `${slug.slice(0, 80)}…` : slug);

/** `5s ago`, `3m ago`, `2h ago`. */
export const agoText = (age: number): string => (age < 60 ? `${age}s ago` : age < 3600 ? `${Math.floor(age / 60)}m ago` : `${Math.floor(age / 3600)}h ago`);
