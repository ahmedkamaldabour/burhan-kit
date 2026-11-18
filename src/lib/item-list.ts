import { existsSync } from 'node:fs';
import type { Io } from '../main.js';
import { realTarget } from './fs-safe.js';
import { listItems } from './items.js';
import { docsLocation } from './status.js';

/** `burhan item list [dir] [--docs <path>]`: one line per work item, `<id> · <route> · <state>`: the rows of `burhan status`, in the same order, read-only (no index is written). */
export function itemList(o: { target: string; docs?: string }, io: Io): number {
  const target = realTarget(o.target);
  const { rel, abs } = docsLocation(target, o.docs);
  const items = existsSync(abs) ? listItems(abs, target) : [];
  if (items.length === 0) { io.stdout(`no work items under ${rel}/\n`); return 0; }
  io.stdout(items.map((i) => `${i.slug} · ${i.typeScope} · ${i.state}\n`).join(''));
  return 0;
}
