import { sep } from 'node:path';
import { BurhanError } from './errors.js';
import { realTarget, resolveWritePath } from './fs-safe.js';

/** The commands that write item files only write inside the project: where `dest` would really land (links followed, as the kernel does)
 *  must be under the project's real path. A link that leaves the project is refused, as the installer does. */
export function assertInside(project: string, dest: string): void {
  const where = resolveWritePath(dest);
  const root = realTarget(project);
  if (where === null || (where !== root && !where.startsWith(root + sep))) throw new BurhanError(`refusing to write ${dest}: it leads outside the project`);
}

/** Today as YYYY-MM-DD in local time. */
export function today(now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const SLUG = /^[A-Za-z0-9._-]+$/;
/** A plain folder name that every OS keeps: letters, digits, . _ - ; up to 100 characters; not starting or ending with a dot, not a Windows reserved name. */
export const SLUG_RULE = 'letters, digits, . _ -; up to 100 characters; not a Windows reserved name, not starting or ending with a dot';
export const isSlug = (s: string | undefined): s is string =>
  s !== undefined && s.length <= 100 && SLUG.test(s) && !/^\.+$/.test(s) && !s.startsWith('.') && !s.endsWith('.') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s);

/** An argument that must be one line: no control character (a line break would add lines to a file). Its length is not limited. */
export function oneLine(value: string | undefined, flag: string): string {
  const v = (value ?? '').trim();
  if (/[\u0000-\u001f\u007f\u0085\u2028\u2029]/.test(v)) throw new BurhanError(`${flag} is one line, with no control character`);
  return v;
}

/** A multi-line argument with every kind of line end made a plain "\n", and other control characters removed. */
export const normalizeLines = (text: string): string => text.replace(/\r\n|[\r\u0085\u2028\u2029]/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '');
