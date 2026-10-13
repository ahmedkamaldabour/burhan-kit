import { parseConfig } from '../config.js';
import { BurhanError } from '../errors.js';

/** Set KEY='value' lines in workflow.config text: replace the first live line for KEY, else append. Comments and order are kept. */
export function setConfigKeys(text: string, values: Record<string, string>): string {
  const lines = text.split('\n');
  const trailing = lines[lines.length - 1] === '';
  if (trailing) lines.pop();
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}='${value}'`;
    // "live" = the parser reads it as KEY=…; a comment or an unparsable line is never touched
    const at = lines.findIndex((l) => key in parseConfig(l).values);
    if (at >= 0) lines[at] = line; else lines.push(line);
  }
  return lines.length ? lines.join('\n') + '\n' : '';
}

const ERE_SPECIAL = /[.[\]()*+?{}|^$\\]/g;
const esc = (s: string): string => s.replace(ERE_SPECIAL, '\\$&');

/** R-3: sensitive paths -> one ERE, anchored at the project root: `^(p1|p2)`. Empty list -> ''. */
export function sensitiveRegex(paths: string[]): string {
  const ps = paths.map((p) => p.trim().replace(/^(\.\/)+/, '').replace(/\/$/, '')).filter(Boolean);
  return ps.length ? `^(${ps.map(esc).join('|')})(/|$)` : ''; // the path itself or below it, never a longer name
}

/** R-4: the config holds only literal single-quoted values on one line, so a value with `'`, a line break, CR or NUL cannot be written. */
export function assertWritable(key: string, value: string): void {
  if (value.includes("'")) throw new BurhanError(`${key} cannot contain a single quote (') — put the command in a small script and use that instead`);
  // One literal line per key: a line break would split the value (the parser rejects both halves, while bash
  // would read them as one) — the CLI and the hooks would then disagree on the config.
  if (/[\n\r\0]/.test(value)) throw new BurhanError(`${key} must fit on one line (no line break, CR or NUL character)`);
}
