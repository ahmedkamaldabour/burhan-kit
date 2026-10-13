import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { applyPlan, planInstall, type InstallPlan, type PlannedFile } from '../install.js';
import { BurhanError } from '../errors.js';
import { parseConfig, TEAM_CONFIG } from '../config.js';
import { cfgPath } from '../../hooks/core/config.mjs';
import { putFile, realTarget } from '../fs-safe.js';
import { kitDir } from '../kit.js';
import { readExistingHooks, type ExistingHook } from '../hooks-merge.js';
import { LEGACY_SHARED_DISCOVERY, LEGACY_SHARED_DOCS, PRIVATE_DISCOVERY, PRIVATE_DOCS, SHARED_DISCOVERY, SHARED_DOCS, type SetupAnswers } from './answers.js';
import { assertWritable, setConfigKeys } from './config-write.js';
import { messages } from './messages.js';

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
  /** Everything setup writes: the install's files plus the config, bindings and private-folder files it adds. */
  files: PlannedFile[];
  /** Rename an existing AI_SPEC shared layout before saving its new config paths. */
  moveLegacyShared: boolean;
}

/** Filesystem seam for the one transactional move; callers use the real operations by default. */
export interface SetupFilesystem {
  mkdir(path: string, options: { recursive: true }): void;
  rename(from: string, to: string): void;
  put(path: string, data: string): void;
}

const realSetupFilesystem: SetupFilesystem = { mkdir: mkdirSync, rename: renameSync, put: putFile };

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
  if (planned) return planned.flatMap((file) => {
    if (file.action === 'remove' || file.rel === '.burhan/.gitignore') return [];
    if (!file.rel.endsWith('/')) return [file.rel];
    const kitRel = file.rel.replace(/^\.workflow\//, '').replace(/\/$/, '');
    return file.rel.startsWith('.workflow/')
      ? filesBelow(kitDir(), kitRel).map((rel) => `.workflow/${rel}`)
      : filesBelow(target, file.rel);
  });
  const files = filesBelow(target, '.workflow');
  for (const rel of ['.claude/settings.json', '.claude/commands/burhan/e2e.md', '.claude/commands/burhan/qc.md', '.claude/agents/burhan-reviewer.md', '.claude/skills/verify/SKILL.md', '.codex/hooks.json', 'CLAUDE.md', 'AGENTS.md']) {
    try { if (statSync(join(target, rel)).isFile()) files.push(rel); } catch { /* absent is fine */ }
  }
  return files.filter((rel) => !rel.startsWith('.workflow/local/'));
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
  if (/^\.?$|^\.git(\/|$)|^\.workflow(\/|$)/.test(path)) bad('is a folder burhan or git keeps for itself');
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
  const legacyShared = existingConfig !== null && a.docs.kind === 'shared' && cfgPath(have.WF_DOCS_DIR || LEGACY_SHARED_DOCS) === LEGACY_SHARED_DOCS;
  const moveLegacyShared = legacyShared && a.moveDocs === 'move';
  const selectedFolders = legacyShared && !moveLegacyShared
    ? { docs: LEGACY_SHARED_DOCS, discovery: LEGACY_SHARED_DISCOVERY }
    : folders(a);
  const { docs, discovery } = selectedFolders;
  if (moveLegacyShared && (existsSync(join(real, SHARED_DOCS)) || existsSync(join(real, SHARED_DISCOVERY)))) {
    throw new BurhanError(`cannot move the old shared folders: ${SHARED_DOCS} or ${SHARED_DISCOVERY} already exists — nothing was changed`);
  }

  const skills: 'superpowers' | 'none' = existingConfig !== null && (have.WF_SKILLS ?? '') !== '' ? (have.WF_SKILLS === 'superpowers' ? 'superpowers' : 'none') : superpowersPresent(home) ? 'superpowers' : 'none';
  const base = existingConfig ?? readFileSync(join(kit, 'workflow.config.example'), 'utf8');
  const values: Record<string, string> = {
    WF_MODE_DEFAULT: a.mode,
  };
  // Keeping a legacy layout, including an unset path read through the hooks' fallback, must not materialise
  // new config lines. Moving it is the explicit point at which the new paths are saved.
  if (!legacyShared || moveLegacyShared) {
    values.WF_DOCS_DIR = docs;
    // An unchanged docs folder keeps the discovery folder the project already has (AC-17).
    values.WF_DISCOVERY_DIR = cfgPath(have.WF_DOCS_DIR ?? '') === docs && (have.WF_DISCOVERY_DIR ?? '') !== '' ? have.WF_DISCOVERY_DIR : discovery;
  }
  if (!(existingConfig !== null && (have.WF_SKILLS ?? '') !== '')) values.WF_SKILLS = skills === 'superpowers' ? 'superpowers' : 'none';
  else values.WF_SKILLS = have.WF_SKILLS;
  const checkEmpty = (have.WF_CHECK_CMD ?? '') === '';
  if (checkEmpty && have.WF_STACK_SETUP !== 'done') values.WF_STACK_SETUP = 'pending';
  const config = setConfigKeys(base, values);

  const bf = join(real, '.workflow/bindings.md');
  const label = a.docs.kind === 'private' ? `\`${docs}/\` (private, git-ignored)` : a.docs.kind === 'shared' ? `\`${docs}/\` (shared in git)` : `\`${docs}/\` (your folder)`;
  const bindings = planBindings(existsSync(bf) ? readFileSync(bf, 'utf8') : null, readFileSync(join(kit, 'templates/bindings.md'), 'utf8'), label);

  // setup writes the config and bindings itself (before the install): the install must not create them from the templates.
  const install = planInstall({ mode: existsSync(join(real, '.workflow/WORKFLOW.md')) ? 'upgrade' : 'init', target, agents: a.agents, apply: true, bootstrap: true, keepProjectFiles: true });
  const existingHooks = readExistingHooks(real, a.agents);

  const files = [...install.files];
  const add = (rel: string, existed: boolean, kind: PlannedFile['kind']): void => {
    if (!files.some((f) => f.rel === rel)) files.push({ rel, existed, action: existed ? 'modify' : 'create', kind });
  };
  if (existingConfig !== null && config !== existingConfig) add('.workflow/workflow.config', true, 'config');
  if (existsSync(bf) && bindings !== null) add('.workflow/bindings.md', true, 'config');
  if (a.docs.kind === 'private') {
    const ig = join(real, '.burhan/.gitignore');
    if (!existsSync(ig) || readFileSync(ig, 'utf8') !== '*\n') add('.burhan/.gitignore', existsSync(ig), 'gitignore');
  }
  return { answers: { ...a, existingHooks: a.existingHooks ?? 'keep' }, existingHooks, config, bindings, install, skills, files, moveLegacyShared };
}

/** Writes config → bindings → private folder ignore file → the install, once. A blocked plan is refused before anything is written. */
export function applySetup(p: SetupPlan, fs: SetupFilesystem = realSetupFilesystem): void {
  const { blocked, target } = p.install;
  if (blocked.length) throw new BurhanError(`${blocked[0]} — nothing was changed`);
  let movedWork = false;
  let movedDiscovery = false;
  const newRoot = join(target, 'docs/burhan');
  const rootExisted = existsSync(newRoot);
  const docsRoot = join(target, 'docs');
  const docsRootExisted = existsSync(docsRoot);
  if (p.moveLegacyShared) {
    try {
      fs.mkdir(newRoot, { recursive: true });
      if (existsSync(join(target, LEGACY_SHARED_DOCS))) { fs.rename(join(target, LEGACY_SHARED_DOCS), join(target, SHARED_DOCS)); movedWork = true; }
      if (existsSync(join(target, LEGACY_SHARED_DISCOVERY))) { fs.rename(join(target, LEGACY_SHARED_DISCOVERY), join(target, SHARED_DISCOVERY)); movedDiscovery = true; }
    } catch {
      const rollbackFailed = rollbackLegacyMove(target, movedWork, movedDiscovery, rootExisted, docsRootExisted, fs);
      throw new BurhanError(rollbackFailed ? rollbackFailureMessage(target, p.answers.lang) : messages(p.answers.lang).moveFailed);
    }
  }
  const configPath = join(target, TEAM_CONFIG);
  try {
    if (!existsSync(configPath) || readFileSync(configPath, 'utf8') !== p.config) fs.put(configPath, p.config);
  } catch {
    const rollbackFailed = p.moveLegacyShared && rollbackLegacyMove(target, movedWork, movedDiscovery, rootExisted, docsRootExisted, fs);
    throw new BurhanError(rollbackFailed ? rollbackFailureMessage(target, p.answers.lang) : messages(p.answers.lang).moveFailed);
  }
  if (p.bindings !== null) putFile(join(target, '.workflow/bindings.md'), p.bindings);
  if (p.answers.docs.kind === 'private') {
    const ig = join(target, '.burhan/.gitignore');
    if (!existsSync(ig) || readFileSync(ig, 'utf8') !== '*\n') putFile(ig, '*\n');
  }
  applyPlan(p.install);
}

function rollbackLegacyMove(target: string, movedWork: boolean, movedDiscovery: boolean, rootExisted: boolean, docsRootExisted: boolean, fs: SetupFilesystem): boolean {
  let failed = false;
  try { if (movedDiscovery) fs.rename(join(target, SHARED_DISCOVERY), join(target, LEGACY_SHARED_DISCOVERY)); } catch { failed = true; }
  try { if (movedWork) fs.rename(join(target, SHARED_DOCS), join(target, LEGACY_SHARED_DOCS)); } catch { failed = true; }
  if (!rootExisted) try { rmdirSync(join(target, 'docs/burhan')); } catch { /* empty or concurrently changed */ }
  if (!docsRootExisted) try { rmdirSync(join(target, 'docs')); } catch { /* empty or concurrently changed */ }
  return failed;
}

function rollbackFailureMessage(target: string, lang: 'en' | 'ar'): string {
  const location = (oldRel: string, newRel: string): string => {
    const oldHere = existsSync(join(target, oldRel));
    const newHere = existsSync(join(target, newRel));
    if (newHere && !oldHere) return newRel;
    if (oldHere && !newHere) return oldRel;
    if (oldHere && newHere) return `${oldRel} and ${newRel}`;
    return `neither ${oldRel} nor ${newRel}`;
  };
  let config: Record<string, string> = {};
  try { config = parseConfig(readFileSync(join(target, TEAM_CONFIG), 'utf8')).values; } catch { /* report an unavailable value below */ }
  return messages(lang).moveRollbackFailed(
    location(LEGACY_SHARED_DOCS, SHARED_DOCS),
    location(LEGACY_SHARED_DISCOVERY, SHARED_DISCOVERY),
    config.WF_DOCS_DIR ?? '(not set)',
    config.WF_DISCOVERY_DIR ?? '(not set)',
  );
}
