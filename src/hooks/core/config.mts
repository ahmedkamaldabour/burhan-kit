import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** workflow.config: one parser for the CLI and the hooks (src/lib/config.ts re-exports it). */
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

/** WF_* values a check reads; a key nobody set is absent (read it as `cfg.KEY ?? ''`). */
export type HookConfig = Record<string, string | undefined>;

/** wf_cfgpath: a config path without leading ./ and without a trailing / */
export function cfgPath(p: string): string {
  while (p.startsWith('./')) p = p.slice(2);
  return p.endsWith('/') ? p.slice(0, -1) : p;
}

function fileValues(p: string): Record<string, string> {
  try { return existsSync(p) ? parseConfig(readFileSync(p, 'utf8')).values : {}; } catch { return {}; }
}

/** wf_init's config: WF_* from the environment (bash sees it), the team file — or WF_CONFIG — then the local
 *  file key by key unless WF_CONFIG is set (WF_CHECK_TIMEOUT stays the team's), then the defaults, which
 *  also replace empty values (`:=`). Only literal lines are read (D2). */
export function loadHookConfig(project: string, env: NodeJS.ProcessEnv): HookConfig {
  const c: HookConfig = {};
  for (const [k, v] of Object.entries(env)) if (k.startsWith('WF_') && v !== undefined) c[k] = v;
  const explicit = env.WF_CONFIG ?? '';
  Object.assign(c, fileValues(explicit || join(project, TEAM_CONFIG)));
  if (!explicit) {
    const local = fileValues(join(project, LOCAL_CONFIG));
    const team = c.WF_CHECK_TIMEOUT;
    Object.assign(c, local);
    if (team !== undefined) c.WF_CHECK_TIMEOUT = team; else delete c.WF_CHECK_TIMEOUT;
  }
  const def = (k: string, v: string): void => { if (!c[k]) c[k] = v; };
  def('WF_DOCS_DIR', 'AI_SPEC/docs');
  def('WF_DISCOVERY_DIR', 'AI_SPEC/discovery');
  def('WF_STATE_FILE', '.workflow/local/PROGRESS.md');
  def('WF_STATE_BUDGET', '80');
  def('WF_CHECK_TIMEOUT', '60');
  def('WF_SKILLS', 'none');
  for (const k of ['WF_DOCS_DIR', 'WF_DISCOVERY_DIR', 'WF_STATE_FILE']) c[k] = cfgPath(c[k]!);
  if (!/^[0-9]+$/.test(c.WF_CHECK_TIMEOUT!)) c.WF_CHECK_TIMEOUT = '60';
  if (!/^[0-9]+$/.test(c.WF_STATE_BUDGET!)) c.WF_STATE_BUDGET = '80';
  return c;
}
