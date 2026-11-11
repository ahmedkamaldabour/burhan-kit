/** The identity of a work item: its folder name. A numbered item is `NNN-slug` (3 digits, a dash, the slug); an older item is just its slug.
 *  Pure: no file system, so the CLI (folder names) and the hooks (state block headings) read an argument the same way. */

const FULL = /^(\d{3})-(.+)$/;
const NUMBER = /^\d{1,3}$/;

export interface ParsedId { number: string | null; slug: string }

/** `012-state-file` -> number `012`, slug `state-file`; `old-item` -> no number, slug `old-item`. */
export function parseId(name: string): ParsedId {
  const m = FULL.exec(name);
  return m === null ? { number: null, slug: name } : { number: m[1]!, slug: m[2]! };
}

/** `#012 · state-file` for reading (the index, guide, messages); the name itself when it has no number. Never matched by any reader. */
export function displayId(name: string): string {
  const p = parseId(name);
  return p.number === null ? name : `#${p.number} · ${p.slug}`;
}

/** Does a slug typed at `item new` read as an item number or as a full id? Such a slug is refused. */
export const readsAsNumber = (slug: string): boolean => /^\d+$/.test(slug) || FULL.test(slug);

export type Match =
  | { kind: 'one'; id: string }
  | { kind: 'none' }
  | { kind: 'many'; ids: string[]; by: 'number' | 'slug' };

/** Which of `names` (folder names or block headings) an argument names: the full id exactly, a number (`12` or `012`), or the plain slug.
 *  More than one candidate is `many`: it is never guessed. */
export function matchItem(arg: string, names: readonly string[]): Match {
  if (FULL.test(arg)) return names.includes(arg) ? { kind: 'one', id: arg } : { kind: 'none' };
  const byNumber = NUMBER.test(arg);
  // An exact unnumbered name (an older item's folder or heading) wins over the plain slug of a numbered one: `x` is the old `x`, not `012-x`.
  if (!byNumber && names.includes(arg)) return { kind: 'one', id: arg };
  const padded = arg.padStart(3, '0');
  const ids = [...new Set(names.filter((n) => (byNumber ? parseId(n).number === padded || n === arg : parseId(n).slug === arg)))].sort();
  if (ids.length === 0) return { kind: 'none' };
  return ids.length === 1 ? { kind: 'one', id: ids[0]! } : { kind: 'many', ids, by: byNumber ? 'number' : 'slug' };
}

/** The block heading `burhan use <arg>` links: the heading itself when it is in Now, else the one block the number or the plain slug names; null when none or several. */
export function linkTarget(arg: string, live: readonly string[]): string | null {
  if (live.includes(arg)) return arg;
  const m = matchItem(arg, live);
  return m.kind === 'one' ? m.id : null;
}

/** The numbers (3 digits) used by more than one item, each with its ids, in order. */
export function sharedNumbers(names: readonly string[]): Array<{ number: string; ids: string[] }> {
  const by = new Map<string, string[]>();
  for (const n of names) { const p = parseId(n).number; if (p !== null) by.set(p, [...(by.get(p) ?? []), n]); }
  return [...by].filter(([, ids]) => ids.length > 1).map(([number, ids]) => ({ number, ids: ids.sort() })).sort((a, b) => (a.number < b.number ? -1 : 1));
}

/** The next number: the highest 3-digit prefix among `names` + 1, as 3 digits; `001` when none has one. null when 999 is used. */
export function nextNumber(names: readonly string[]): string | null {
  let top = 0;
  for (const n of names) { const p = parseId(n).number; if (p !== null) top = Math.max(top, Number(p)); }
  return top >= 999 ? null : String(top + 1).padStart(3, '0');
}
