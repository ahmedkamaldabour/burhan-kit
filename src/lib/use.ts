import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Io } from '../main.js';
import { readProjectConfig } from './config.js';
import { BurhanError } from './errors.js';
import { realTarget } from './fs-safe.js';

function slugs(text: string): string[] {
  const out: string[] = [];
  let inNow = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^##\s/.test(line)) { inNow = /^##\s+Now\s*$/.test(line); continue; }
    const m = inNow ? /^###\s+([^\s#<][^\s]*)/.exec(line) : null;
    if (m) out.push(m[1]);
  }
  return out;
}

/** Validate the requested item only.  The end-of-turn hook performs the external link write. */
export function useItem(target: string, slug: string | undefined, io: Io): number {
  if (!slug || !/^[A-Za-z0-9._-]+$/.test(slug)) throw new BurhanError('use needs an item slug');
  const project = realTarget(target);
  const stateRel = readProjectConfig(project).values.WF_STATE_FILE || '.burhan/local/PROGRESS.md';
  const state = join(project, stateRel);
  const available = existsSync(state) ? slugs(readFileSync(state, 'utf8')) : [];
  if (!available.includes(slug)) throw new BurhanError(`item "${slug}" is not in Now; available: ${available.join(', ') || '(none)'}`);
  io.stdout('linked at the end of this turn\n');
  return 0;
}
