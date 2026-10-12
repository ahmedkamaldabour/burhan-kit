import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const TEAM_CONFIG = '.workflow/workflow.config';
export const LOCAL_CONFIG = '.workflow/local/workflow.config';

export interface ConfigProblem { file: string; line: number; text: string; reason: string }
export interface ParsedConfig { values: Record<string, string>; problems: ConfigProblem[] }

const KEY = '([A-Z_][A-Z0-9_]*)';
const TAIL = '(?:[ \\t]+#.*)?';
// The only forms both bash and this parser read identically.
const FORMS: RegExp[] = [
  new RegExp(`^${KEY}='([^']*)'${TAIL}$`),
  new RegExp(`^${KEY}="([^"$\`\\\\]*)"${TAIL}$`),
  new RegExp(`^${KEY}=([^\\s'"$\`\\\\;&|<>()#~]*)${TAIL}$`),
];
const LITERAL = "not a literal KEY=value line (allowed: KEY=word, KEY='text', KEY=\"text\" without $ ` \\ inside)";

export function parseConfig(text: string, file = ''): ParsedConfig {
  const values: Record<string, string> = {};
  const problems: ConfigProblem[] = [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  lines.forEach((raw, i) => {
    if (raw.endsWith('\r')) { problems.push({ file, line: i + 1, text: raw, reason: 'CRLF line ending — save the file with LF endings' }); return; }
    const line = raw.replace(/^[ \t]+|[ \t]+$/g, ''); // bash trims only blanks; other whitespace makes the line fail below
    if (line === '' || line.startsWith('#')) return;
    for (const re of FORMS) {
      const m = re.exec(line);
      if (m) { values[m[1]] = m[2]; return; }
    }
    problems.push({ file, line: i + 1, text: raw, reason: LITERAL });
  });
  return { values, problems };
}

/** Team config, then the developer's local overrides key by key (WORKFLOW §5 · team use). */
export function readProjectConfig(projectDir: string): ParsedConfig {
  const out: ParsedConfig = { values: {}, problems: [] };
  for (const rel of [TEAM_CONFIG, LOCAL_CONFIG]) {
    const p = join(projectDir, rel);
    if (!existsSync(p)) continue;
    const r = parseConfig(readFileSync(p, 'utf8'), rel);
    Object.assign(out.values, r.values);
    out.problems.push(...r.problems);
  }
  return out;
}
