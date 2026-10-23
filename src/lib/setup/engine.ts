import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, sep } from 'node:path';
import { applyPlan, KIT_COMMAND, planInstall, type InstallPlan, type PlannedFile } from '../install.js';
import { BurhanError } from '../errors.js';
import { parseConfig, TEAM_CONFIG } from '../config.js';
import { cfgPath } from '../../hooks/core/config.mjs';
import { putFile, realTarget, resolveWritePath } from '../fs-safe.js';
import { kitDir, nodeHooksDir } from '../kit.js';
import { readExistingHooks, type ExistingHook } from '../hooks-merge.js';
import { currentAnswers as installedAnswers, PRIVATE_DISCOVERY, PRIVATE_DOCS, SHARED_DISCOVERY, SHARED_DOCS, type DocsChoice, type SetupAnswers } from './answers.js';
import { assertWritable, setConfigKeys } from './config-write.js';

export { recommended } from './answers.js';
export type { DiscoveryChoice, DocsChoice, SetupAnswers } from './answers.js';
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
    if (file.action === 'remove' || file.kind === 'state' || privateFile(file.rel)) return [];
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

/** The project-relative folder rule, one for the work files and for the discovery folder; `kind` names it in the message. */
function cleanFolder(kind: string, raw: string, example: string, root?: string): string {
  const path = raw.trim().replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  const bad = (why: string): never => { throw new BurhanError(`the ${kind} folder "${raw}" ${why} — type a folder inside this project, like ${example}`); };
  if (path === '') bad('is empty');
  if (/^\/|^[A-Za-z]:|\\|^~/.test(path)) bad('is not a path inside this project');
  if (path.split('/').some((s) => s === '..' || s === '')) bad('leaves this project');
  if (path.split('/').some((s) => s === '.')) bad('has a "." step');
  // Never the project root itself, git's internals or burhan's own folder.
  if (/^\.?$|^\.burhan(\/|$)|(^|\/)\.git(\/|$)/i.test(path)) bad('is a folder burhan or git keeps for itself');
  if (/[$`"]/.test(path)) bad('has a character that cannot be saved');
  assertWritable(`the ${kind} folder`, path);
  if (root !== undefined) {
    // A link in the path (or the folder itself) must not lead out of the project.
    const top = realTarget(root);
    const landing = resolveWritePath(join(top, path));
    if (landing === null || !(landing === top || landing.startsWith(top + sep))) bad('is, or runs through, a link that leaves this project');
  }
  return path;
}
const cleanDocs = (raw: string, root?: string): string => cleanFolder('work files', raw, 'docs/work', root);
const cleanDiscovery = (raw: string, root?: string): string => cleanFolder('discovery', raw, 'docs/discovery', root);
const overlaps = (a: string, b: string): boolean => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

function docsFolder(d: DocsChoice, root?: string): string {
  return d.kind === 'private' ? PRIVATE_DOCS : d.kind === 'shared' ? SHARED_DOCS : cleanDocs(d.path, root);
}

/** A real directory (not a link) inside the project root, or false. */
function realDirInside(root: string, rel: string): boolean {
  try {
    const abs = join(root, rel);
    if (!lstatSync(abs).isDirectory()) return false;
    const top = realpathSync(root);
    const real = realpathSync(abs);
    return real === top || real.startsWith(top + sep);
  } catch { return false; }
}

/** What "next to the work files" means: the fixed folders for private/shared; for a custom docs folder an existing
 *  `discovery` folder in the same parent, else `<docs>-discovery` (beside it, never inside it). `root` unset = no look at the disk. */
function besideDiscovery(d: DocsChoice, root?: string): string {
  if (d.kind === 'private') return PRIVATE_DISCOVERY;
  if (d.kind === 'shared') return SHARED_DISCOVERY;
  const docs = cleanDocs(d.path);
  const slash = docs.lastIndexOf('/');
  const found = slash < 0 ? 'discovery' : `${docs.slice(0, slash)}/discovery`;
  if (root !== undefined && found !== docs && realDirInside(root, found)) return found;
  return `${docs}-discovery`;
}

/** The folder rule. Custom: the docs folder is the path; discovery files go beside it (see besideDiscovery) or where the
 *  person says. Always project-relative. */
function folders(a: SetupAnswers, root?: string): { docs: string; discovery: string } {
  const docs = docsFolder(a.docs, root);
  if (a.discovery?.kind === 'custom') {
    const discovery = cleanDiscovery(a.discovery.path, root);
    if (overlaps(discovery, docs)) throw new BurhanError(`the discovery folder "${a.discovery.path}" overlaps the work files folder "${docs}" — type a different folder, like docs/discovery`);
    return { docs, discovery };
  }
  return { docs, discovery: besideDiscovery(a.docs, root) };
}

/** The one folder rule, for a prompt to check a typed path with (undefined = fine). */
export function docsPathError(path: string, root?: string): string | undefined {
  try { folders({ agents: [], mode: 'step', lang: 'en', docs: { kind: 'custom', path } }, root); return undefined; }
  catch (e) { if (e instanceof BurhanError) return e.message; throw e; }
}

/** The same rule for the discovery folder, given the work files choice it must not overlap. */
export function discoveryPathError(path: string, docs: DocsChoice, root?: string): string | undefined {
  try { folders({ agents: [], mode: 'step', lang: 'en', docs, discovery: { kind: 'custom', path } }, root); return undefined; }

  catch (e) { if (e instanceof BurhanError) return e.message; throw e; }
}

/** The folder "next to the work files" means for these work files, for a prompt to show (needs valid work files). */
export function discoveryBeside(target: string, docs: DocsChoice): string {
  return besideDiscovery(docs, realTarget(target));
}

/** The answers an existing install stands for, plus a custom discovery answer when its saved folder is not the `beside` one. */
export function currentAnswers(target: string): SetupAnswers | null {
  const a = installedAnswers(target);
  if (a === null) return null;
  const saved = (existsSync(join(target, TEAM_CONFIG)) ? parseConfig(readFileSync(join(target, TEAM_CONFIG), 'utf8')).values : {}).WF_DISCOVERY_DIR ?? '';
  if (saved === '') return a;
  const dir = cfgPath(saved);
  let beside: string;
  try { beside = besideDiscovery(a.docs, realTarget(target)); } catch { return a; }
  // A saved folder today's rules refuse is left to the saved config (kept as before), not turned into an answer.
  if (dir !== beside && discoveryPathError(dir, a.docs, target) !== undefined) return a;
  return dir === beside ? a : { ...a, discovery: { kind: 'custom', path: dir } };
}

const ROW = (name: string, tail: string): RegExp => new RegExp(`^(\\| \\*\\*${name}\\*\\* \\| )(.*?)( \\| ${tail} \\|)$`);
const placeholder = (v: string): boolean => /^\*\(.*\)\*$/.test(v.trim());

/** Fill the rows only while they are still the template's placeholders; null = nothing to change. */
function planBindings(existing: string | null, kitText: string, docsLabel: string, discoveryLabel: string, skillsLabel: string): string | null {
  const text = existing ?? kitText;
  const rows: [RegExp, string][] = [[ROW('Work-item docs location', '`WF_DOCS_DIR`'), docsLabel], [ROW('Discovery location', '`WF_DISCOVERY_DIR`'), discoveryLabel], [ROW('Process skills', '`WF_SKILLS`'), skillsLabel], [ROW('Branching rule', '—'), BRANCH_RULE], [ROW('Kit command', '—'), KIT_COMMAND]];
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
  const { docs, discovery } = folders(a, real);

  const superpowersAvailable = superpowersPresent(home);
  const superpowersDisabled = have.WF_SKILLS === 'none';
  const skills: 'superpowers' | 'none' = existingConfig !== null && (have.WF_SKILLS ?? '') !== '' ? (have.WF_SKILLS === 'superpowers' ? 'superpowers' : 'none') : superpowersAvailable ? 'superpowers' : 'none';
  const base = existingConfig ?? readFileSync(join(kit, 'workflow.config.example'), 'utf8');
  const values: Record<string, string> = {
    WF_MODE_DEFAULT: a.mode,
    WF_REVIEWER_AGENT: a.agents.length > 1 ? (a.reviewer ?? have.WF_REVIEWER_AGENT ?? 'same') : 'same',
  };
  values.WF_DOCS_DIR = docs;
  const keepSaved = a.discovery === undefined && cfgPath(have.WF_DOCS_DIR || PRIVATE_DOCS) === docs && (have.WF_DISCOVERY_DIR ?? '') !== '';
  values.WF_DISCOVERY_DIR = keepSaved ? have.WF_DISCOVERY_DIR : discovery;
  if (!(existingConfig !== null && (have.WF_SKILLS ?? '') !== '')) values.WF_SKILLS = skills === 'superpowers' ? 'superpowers' : 'none';
  else values.WF_SKILLS = have.WF_SKILLS;
  const checkEmpty = (have.WF_CHECK_CMD ?? '') === '';
  if (checkEmpty && have.WF_STACK_SETUP !== 'done') values.WF_STACK_SETUP = 'pending';
  const config = setConfigKeys(base, values);

  const bf = join(real, '.burhan/bindings.md');
  const label = a.docs.kind === 'private' ? `\`${docs}/\` (private, git-ignored)` : a.docs.kind === 'shared' ? `\`${docs}/\` (shared in git)` : `\`${docs}/\` (your folder)`;
  const bindings = planBindings(existsSync(bf) ? readFileSync(bf, 'utf8') : null, readFileSync(join(kit, 'templates/bindings.md'), 'utf8'), label, `\`${values.WF_DISCOVERY_DIR}/\``, skills === 'superpowers' ? 'superpowers — invoke the matching skill before each phase (`.burhan/phases/skills.md`)' : 'none');

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
