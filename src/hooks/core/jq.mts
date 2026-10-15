/** The few jq behaviours the bash adapters rely on, so the ports match them on odd input.
 *  `.a.b` on a value that is neither an object nor null is an error that aborts the whole filter; `a // b` falls
 *  through on null and false only (an empty string or 0 is a value); `jq -r` prints a non-string as JSON and
 *  `$(…)` then drops NUL characters and trailing newlines. */

export class JqError extends Error {}

/** `.key` — null for a missing key or a null value; an error for anything that is not an object. */
export function idx(value: unknown, key: string): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new JqError(`cannot index ${typeof value} with "${key}"`);
  return Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] ?? null : null;
}

/** `a // b`. */
export const alt = (a: unknown, b: unknown): unknown => (a === null || a === undefined || a === false ? b : a);

/** `jq -r` of one value: strings raw, null/false absent (`// empty`), everything else as pretty JSON. */
export const rawText = (value: unknown): string =>
  value === null || value === undefined || value === false ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);

/** The same text as read by `$(…)`: NUL characters and trailing newlines dropped. */
export const shellText = (value: unknown): string => rawText(value).replaceAll('\u0000', '').replace(/\n+$/u, '');
