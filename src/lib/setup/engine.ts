import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { applyPlan, planInstall, type InstallPlan, type PlannedFile } from '../install.js';
import { BurhanError } from '../errors.js';
import { parseConfig, TEAM_CONFIG } from '../config.js';
import { cfgPath } from '../../hooks/core/config.mjs';
import { putFile, realTarget } from '../fs-safe.js';
import { kitDir, nodeHooksDir } from '../kit.js';
import { readExistingHooks, type ExistingHook } from '../hooks-merge.js';
import { PRIVATE_DISCOVERY, PRIVATE_DOCS, SHARED_DISCOVERY, SHARED_DOCS, type SetupAnswers } from './answers.js';
import { assertWritable, setConfigKeys } from './config-write.js';

export { recommended, currentAnswers } from './answers.js';
export type { DocsChoice, SetupAnswers } from './answers.js';
export { renderSummary } from './summary.js';

export interface SetupPlan {
  answers: SetupAnswers;
  /** User hook commands on burhan's events, read without changing the settings file. */
  existingHooks: ExistingHook[];
  /** The full team workflow.config text to write. */
  config: string;
  /** The full bindings.md text to write, or null when nothing in it changes. */
  bindings: string | null;
  install: InstallPlan;
  skills: 'superpowers' | 'none';
  superpowersAvailable: boolean;
  /** An explicit project setting keeps detected Superpowers disabled. */
  superpowersDisabled: boolean;
  /** Everything setup writes: the install's files plus the config, bindings and private-folder files it adds. */
  files: PlannedFile[];
}

/** Config write seam; callers use the real operation by default. */
export interface SetupFilesystem {
  put(path: string, data: string): void;
}

const realSetupFilesystem: SetupFilesystem = { put: putFile };

function filesBelow(target: string, rel: string): string[] {
  const path = join(target, rel);
  let entries;
  try { entries = readdirSync(path, { withFileTypes: true }); } catch { return []; }
  return entries.flatMap((entry) => {
    const child = `${rel.replace(/\/$/, '')}/${entry.name}`;
    return entry.isDirectory() ? filesBelow(target, child) : entry.isFile() ? [child] : [];
  });
}

/** Files setup expects in git, excluding per-user state and the intentional private-work ignore file. */
function committedSetupFiles(target: string, planned?: readonly PlannedFile[]): string[] {
  const privateFile = (rel: string): boolean => /^\.burhan\/(local|work|discovery)(\/|$)/.test(rel);
  if (planned) return planned.flatMap((file) => {
    if (file.action === 'remove' || privateFile(file.rel)) return [];
    if (!file.rel.endsWith('/')) return [file.rel];
    const kitRel = file.rel.replace(/^\.burhan\//, '').replace(/\/$/, '');
    if (kitRel === 'hooks/node') return filesBelow(nodeHooksDir(), '').map((rel) => `.burhan/hooks/node${rel}`);
    return file.rel.startsWith('.burhan/')
      ? filesBelow(kitDir(), kitRel).map((rel) => `.burhan/${rel}`)
      : filesBelow(target, file.rel);
  });
  const files = filesBelow(target, '.burhan');
  for (const rel of ['.claude/settings.json', '.claude/commands/burhan/e2e.md', '.claude/commands/burhan/qc.md', '.claude/commands/burhan/onboard.md', '.claude/agents/burhan-reviewer.md', '.claude/skills/burhan-verify/SKILL.md', '.codex/hooks.json', 'CLAUDE.md', 'AGENTS.md']) {
    try { if (statSync(join(target, rel)).isFile()) files.push(rel); } catch { /* absent is fine */ }
  }
  return files.filter((rel) => !privateFile(rel));
}

/** AC-18: exact negate lines for setup-owned committed files that git currently ignores. */
export function ignoredCommittedSetupFiles(target: string, planned?: readonly PlannedFile[]): string[] {
  if (spawnSync('git', ['-C', target, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' }).status !== 0) return [];
  const isIgnored = (rel: string): boolean => spawnSync('git', ['-C', target, 'check-ignore', '--quiet', '--no-index', '--', rel], { encoding: 'utf8' }).status === 0;
  const ignored: string[] = [];
  const add = (line: string): void => { if (!ignored.includes(line)) ignored.push(line); };
  for (const rel of new Set(committedSetupFiles(target, planned))) {
    if (!isIgnored(rel)) continue;
    const parts = rel.split('/');
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join('/');
      if (isIgnored(ancestor)) {
        add(`!/${ancestor}/`);
        add(`/${ancestor}/*`);
      }
    }
    add(`!/${rel}`);
  }
  return ignored;
}

export const BRANCH_RULE = 'feature branches + pull requests; commit only after the a/b/c checkpoint';

/** R-6: read-only look for a plugin folder named `superpowers`, at most 4 levels under ~/.claude/plugins. Symlinks are not followed. */
function superpowersPresent(home: string): boolean {
  const walk = (dir: string, depth: number): boolean => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return false; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === 'superpowers') return true;
      if (depth < 4 && walk(join(dir, e.name), depth + 1)) return true;
    }
    return false;
  };
  return walk(join(home, '.claude', 'plugins'), 1);
}

/** The folder rule. Custom: the docs folder is the path; discovery files go beside it in `<path>-discovery`
 *  (never inside it, so a work item can never collide with the discovery folder). Always project-relative. */
function folders(a: SetupAnswers): { docs: string; discovery: string } {
  const d = a.docs;
  if (d.kind === 'private') return { docs: PRIVATE_DOCS, discovery: PRIVATE_DISCOVERY };
  if (d.kind === 'shared') return { docs: SHARED_DOCS, discovery: SHARED_DISCOVERY };
  const path = d.path.trim().replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  const bad = (why: string): never => { throw new BurhanError(`the work files folder "${d.path}" ${why} — type a folder inside this project, like docs/work`); };
  if (path === '') bad('is empty');
  if (/^\/|^[A-Za-z]:|\\|^~/.test(path)) bad('is not a path inside this project');
  if (path.split('/').some((s) => s === '..' || s === '')) bad('leaves this project');
  if (path.split('/').some((s) => s === '.')) bad('has a "." step — type the folder plainly, like docs/work');
  // Never the project root itself, git's internals or burhan's own folder.
  if (/^\.?$|^\.git(\/|$)|^\.burhan(\/|$)/.test(path)) bad('is a folder burhan or git keeps for itself');
  if (/[$`"]/.test(path)) bad('has a character that cannot be saved');
  assertWritable('the work files folder', path);
  return { docs: path, discovery: `${path}-discovery` };
}

/** The one folder rule, for a prompt to check a typed path with (undefined = fine). */
export function docsPathError(path: string): string | undefined {
  try { folders({ agents: [], mode: 'step', lang: 'en', docs: { kind: 'custom', path } }); return undefined; }
  catch (e) { if (e instanceof BurhanError) return e.message; throw e; }
}

const ROW = (name: string, tail: string): RegExp => new RegExp(`^(\\| \\*\\*${name}\\*\\* \\| )(.*?)( \\| ${tail} \\|)$`);
const placeholder = (v: string): boolean => /^\*\(.*\)\*$/.test(v.trim());

/** Fill the two rows only while they are still the template's placeholders; null = nothing to change. */
function planBindings(existing: string | null, kitText: string, docsLabel: string): string | null {
  const text = existing ?? kitText;
  const rows: [RegExp, string][] = [[ROW('Work-item docs location', '`WF_DOCS_DIR`'), docsLabel], [ROW('Branching rule', '—'), BRANCH_RULE]];
  let changed = existing === null;
  const lines = text.split('\n').map((l) => {
    for (const [re, value] of rows) {
      const m = re.exec(l);
      if (m && placeholder(m[2])) { changed = true; return `${m[1]}${value}${m[3]}`; }
    }
    return l;
  });
  return changed ? lines.join('\n') : null;
}

/** Validates and plans; writes nothing. */
export function planSetup(target: string, a: SetupAnswers, home: string): SetupPlan {
  const kit = kitDir();
  const real = realTarget(target);
  const configPath = join(real, TEAM_CONFIG);
  const existingConfig = existsSync(configPath) ? readFileSync(configPath, 'utf8') : null;
  const have = parseConfig(existingConfig ?? '').values;
  const { docs, discovery } = folders(a);

  const superpowersAvailable = superpowersPresent(home);
  const superpowersDisabled = have.WF_SKILLS === 'none';
  const skills: 'superpowers' | 'none' = existingConfig !== null && (have.WF_SKILLS ?? '') !== '' ? (have.WF_SKILLS === 'superpowers' ? 'superpowers' : 'none') : superpowersAvailable ? 'superpowers' : 'none';
  const base = existingConfig ?? readFileSync(join(kit, 'workflow.config.example'), 'utf8');
  const values: Record<string, string> = {
    WF_MODE_DEFAULT: a.mode,
    WF_REVIEWER_AGENT: a.agents.length > 1 ? (a.reviewer ?? have.WF_REVIEWER_AGENT ?? 'same') : 'same',
  };
  values.WF_DOCS_DIR = docs;
  values.WF_DISCOVERY_DIR = cfgPath(have.WF_DOCS_DIR || PRIVATE_DOCS) === docs && (have.WF_DISCOVERY_DIR ?? '') !== '' ? have.WF_DISCOVERY_DIR : discovery;
  if (!(existingConfig !== null && (have.WF_SKILLS ?? '') !== '')) values.WF_SKILLS = skills === 'superpowers' ? 'superpowers' : 'none';
  else values.WF_SKILLS = have.WF_SKILLS;
  const checkEmpty = (have.WF_CHECK_CMD ?? '') === '';
  if (checkEmpty && have.WF_STACK_SETUP !== 'done') values.WF_STACK_SETUP = 'pending';
  const config = setConfigKeys(base, values);

  const bf = join(real, '.burhan/bindings.md');
  const label = a.docs.kind === 'private' ? `\`${docs}/\` (private, git-ignored)` : a.docs.kind === 'shared' ? `\`${docs}/\` (shared in git)` : `\`${docs}/\` (your folder)`;
  const bindings = planBindings(existsSync(bf) ? readFileSync(bf, 'utf8') : null, readFileSync(join(kit, 'templates/bindings.md'), 'utf8'), label);

  // setup writes the config and bindings itself (before the install): the install must not create them from the templates.
  const install = planInstall({ mode: existsSync(join(real, '.burhan/WORKFLOW.md')) ? 'upgrade' : 'init', target, agents: a.agents, apply: true, bootstrap: true, keepProjectFiles: true });
  const existingHooks = readExistingHooks(real, a.agents);

  const files = [...install.files];
  const add = (rel: string, existed: boolean, kind: PlannedFile['kind']): void => {
    if (!files.some((f) => f.rel === rel)) files.push({ rel, existed, action: existed ? 'modify' : 'create', kind });
  };
  if (existingConfig !== null && config !== existingConfig) add('.burhan/workflow.config', true, 'config');
  if (existsSync(bf) && bindings !== null) add('.burhan/bindings.md', true, 'config');
  return { answers: { ...a }, existingHooks, config, bindings, install, skills, superpowersAvailable, superpowersDisabled, files };
}

/** Writes config → bindings → the install, once. A blocked plan is refused before anything is written. */
export function applySetup(p: SetupPlan, fs: SetupFilesystem = realSetupFilesystem): void {
  const { blocked, target } = p.install;
  if (blocked.length) throw new BurhanError(`${blocked[0]} — nothing was changed`);
  const configPath = join(target, TEAM_CONFIG);
  if (!existsSync(configPath) || readFileSync(configPath, 'utf8') !== p.config) fs.put(configPath, p.config);
  if (p.bindings !== null) putFile(join(target, '.burhan/bindings.md'), p.bindings);
  applyPlan(p.install);
}
