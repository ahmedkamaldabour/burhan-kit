import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyPlan, planInstall, type InstallPlan, type PlannedFile } from '../install.js';
import { BurhanError } from '../errors.js';
import { parseConfig, TEAM_CONFIG } from '../config.js';
import { cfgPath } from '../../hooks/core/config.mjs';
import { putFile, realTarget } from '../fs-safe.js';
import { kitDir } from '../kit.js';
import { PRIVATE_DISCOVERY, PRIVATE_DOCS, SHARED_DISCOVERY, SHARED_DOCS, type SetupAnswers } from './answers.js';
import { assertWritable, setConfigKeys } from './config-write.js';

export { recommended, currentAnswers } from './answers.js';
export type { DocsChoice, SetupAnswers } from './answers.js';
export { renderSummary } from './summary.js';

export interface SetupPlan {
  answers: SetupAnswers;
  /** The full team workflow.config text to write. */
  config: string;
  /** The full bindings.md text to write, or null when nothing in it changes. */
  bindings: string | null;
  install: InstallPlan;
  skills: 'superpowers' | 'none';
  /** Everything setup writes: the install's files plus the config, bindings and private-folder files it adds. */
  files: PlannedFile[];
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
  const { docs, discovery } = folders(a);

  const skills: 'superpowers' | 'none' = existingConfig !== null && (have.WF_SKILLS ?? '') !== '' ? (have.WF_SKILLS === 'superpowers' ? 'superpowers' : 'none') : superpowersPresent(home) ? 'superpowers' : 'none';
  const base = existingConfig ?? readFileSync(join(kit, 'workflow.config.example'), 'utf8');
  const values: Record<string, string> = {
    WF_MODE_DEFAULT: a.mode,
    WF_DOCS_DIR: docs,
    // An unchanged docs folder keeps the discovery folder the project already has (AC-17).
    WF_DISCOVERY_DIR: cfgPath(have.WF_DOCS_DIR ?? '') === docs && (have.WF_DISCOVERY_DIR ?? '') !== '' ? have.WF_DISCOVERY_DIR : discovery,
  };
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
  return { answers: a, config, bindings, install, skills, files };
}

/** Writes config → bindings → private folder ignore file → the install, once. A blocked plan is refused before anything is written. */
export function applySetup(p: SetupPlan): void {
  const { blocked, target } = p.install;
  if (blocked.length) throw new BurhanError(`${blocked[0]} — nothing was changed`);
  const configPath = join(target, TEAM_CONFIG);
  if (!existsSync(configPath) || readFileSync(configPath, 'utf8') !== p.config) putFile(configPath, p.config);
  if (p.bindings !== null) putFile(join(target, '.workflow/bindings.md'), p.bindings);
  if (p.answers.docs.kind === 'private') {
    const ig = join(target, '.burhan/.gitignore');
    if (!existsSync(ig) || readFileSync(ig, 'utf8') !== '*\n') putFile(ig, '*\n');
  }
  applyPlan(p.install);
}
