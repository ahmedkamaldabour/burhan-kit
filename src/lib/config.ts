// The parser lives with the hooks (they ship without the CLI); the CLI uses the same one.
import type { ParsedConfig } from '../hooks/core/config.mjs';
export { TEAM_CONFIG, LOCAL_CONFIG, parseConfig, readProjectConfig } from '../hooks/core/config.mjs';
export type { ConfigProblem, ParsedConfig } from '../hooks/core/config.mjs';

/** When `key` has no value because the parser REFUSED a line that assigns it (a `$` or a backtick inside double quotes, a CRLF line …), the sentence that names the line and says
 *  how to write it when single quotes really fix it, else the parser's own reason; null when the key has an entry in `values` (even `''`: a later valid line made it empty), or has no refused line (a key nobody set is simply empty). A line of another key is never blamed (the key must be followed by `=`).
 *  With several refused lines (team file, then local file) the last is named: it is the one that would have won. The line's text is not repeated, only `file:line`. */
export function refusedLineOf(cfg: ParsedConfig, key: string): string | null {
  if (Object.prototype.hasOwnProperty.call(cfg.values, key)) return null;
  const mine = cfg.problems.filter((p) => {
    const text = p.text.trim();
    return text.startsWith(key) && /^[ \t]*=/.test(text.slice(key.length));
  });
  const p = mine[mine.length - 1];
  if (p === undefined) return null;
  const how = singleQuotesFix(p.text, key) ? `put the value in single quotes, as ${key}='…'` : p.reason;
  return `${key} is empty because its line ${p.file}:${p.line} was refused by the config parser: ${how}`;
}

/** True only when single quotes would make the parser accept the line, for a key of the parser's KEY shape: a double-quoted value (`KEY="…"` with no blanks around `=`, no quote inside, an optional ` # note`) that was refused for a `$`, a backtick or a backslash
 *  (`FORMS` in src/hooks/core/config.mts). The line is trimmed of blanks only, as the parser does; a CRLF line keeps its `\r` and so is never true. */
function singleQuotesFix(raw: string, key: string): boolean {
  const line = raw.replace(/^[ \t]+|[ \t]+$/g, '');
  return /^[A-Z_][A-Z0-9_]*$/.test(key) && line.startsWith(`${key}="`) && /^[^"']*"(?:[ \t]+#.*)?$/.test(line.slice(key.length + 2));
}
