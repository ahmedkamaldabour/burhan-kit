import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Io } from '../main.js';
import { applyBlock, BlockError, type Agent } from './bootstrap.js';
import { isManagedCommand, withManagedMark } from './commands.js';
import { parseConfig, readProjectConfig, TEAM_CONFIG } from './config.js';
import { BurhanError } from './errors.js';
import { isWritable, putFile, realTarget, replaceDir, resolveWritePath } from './fs-safe.js';
import { agentInstalled, burhanHookKeys, mergeHooks, validHooksFile, type Settings } from './hooks-merge.js';
import { kitDir, nodeHooksDir, readVersion } from './kit.js';

export const AGENTS: readonly Agent[] = ['claude', 'codex'];
const HOOKS_FILE: Record<Agent, string> = { claude: '.claude/settings.json', codex: '.codex/hooks.json' };
/** The hook entries burhan installs: Node (exec form for Claude Code, a launcher for Codex). */
const SNIPPET: Record<Agent, string> = { claude: 'hooks/adapters/claude/settings.node.snippet.json', codex: 'hooks/adapters/codex/hooks.node.snippet.json' };
/** The directories a 0.2.x install holds for the bash hooks (removed in 0.3.0) — an upgrade deletes them. */
const BASH_DIRS = ['hooks/core', ...AGENTS.map((a) => `hooks/adapters/${a}`)];
const NODE_DIR = 'hooks/node';
const BOOT_FILE: Record<Agent, string> = { claude: 'CLAUDE.md', codex: 'AGENTS.md' };
const COMMANDS = ['e2e', 'qc', 'onboard'];

/** keepProjectFiles: never create workflow.config / bindings.md from the templates — `burhan setup` writes them itself, first. */
export interface InstallOptions { mode: 'init' | 'upgrade'; target: string; agents: Agent[] | null; apply: boolean; bootstrap: boolean; keepProjectFiles?: boolean; /** `init`/`upgrade` only: write a hooks file that resolves outside the project. */ allowOutsideSettings?: boolean }

export function parseAgents(s: string): Agent[] {
  const list = s.split(',').filter(Boolean);
  if (list.length === 0) throw new BurhanError('--agents needs a value (claude, codex)');
  for (const a of list) if (!(AGENTS as readonly string[]).includes(a)) throw new BurhanError(`Unknown agent: '${a}' (supported: ${AGENTS.join(', ')})`);
  return [...new Set(list)] as Agent[];
}

function checkTimeout(target: string): number {
  const p = join(target, TEAM_CONFIG); // team file only: the hook timeout is committed
  const v = existsSync(p) ? parseConfig(readFileSync(p, 'utf8')).values.WF_CHECK_TIMEOUT : undefined;
  return v !== undefined && /^\d+$/.test(v) ? Number(v) : 60;
}

/** A path we will write: an existing one must be writable, a new one needs a writable nearest existing ancestor. */
function canWrite(p: string): boolean {
  let q = p;
  while (!existsSync(q)) { const up = dirname(q); if (up === q) return false; q = up; }
  return isWritable(q);
}

/** A directory we will replace (rm + copy): its parent and every directory inside it must be writable. */
function canReplace(dir: string): string | null {
  if (!existsSync(dir)) return canWrite(dir) ? null : dir;
  if (!canWrite(dirname(dir))) return dirname(dir);
  const walk = (d: string): string | null => {
    if (!isWritable(d)) return d;
    for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) { const bad = walk(join(d, e.name)); if (bad) return bad; }
    return null;
  };
  return walk(dir);
}

const isFileTarget = (p: string): boolean => !existsSync(p) || statSync(p).isFile();

/** The `node` the agent will run is the one on PATH; the hooks are written for Node ≥ 22. */
function nodeRuntimeProblem(): string | null {
  const r = spawnSync('node', ['-p', 'process.versions.node'], { encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0) return 'node is not on PATH';
  const major = Number.parseInt(r.stdout.trim(), 10);
  return major >= 22 ? null : `node ${r.stdout.trim()} is on PATH`;
}

/** A file the plan writes or removes; `rel` is project-relative, forward slashes. Kit files are listed at
 *  directory level (trailing `/`, e.g. `.burhan/hooks/core/`) because the whole directory is replaced. */
export interface PlannedFile { rel: string; existed: boolean; action: 'create' | 'modify' | 'remove'; kind: 'kit' | 'config' | 'hooks' | 'bootstrap' | 'managed' | 'gitignore' }
/** A hooks file whose real path is outside the project: a write would edit someone else's file. */
export interface OutsideFile { rel: string; real: string }
export interface InstallPlan { version: string; target: string; blocked: string[]; outside: OutsideFile[]; steps: { say: string; run?: () => void }[]; files: PlannedFile[]; agents: Agent[] }

/** Validates and plans; prints nothing and writes nothing. Throws BurhanError on invalid input. */
export function planInstall(o: InstallOptions): InstallPlan {
  const kit = kitDir();
  const version = readVersion();
  if (!existsSync(o.target) || !statSync(o.target).isDirectory()) throw new BurhanError(`target is not a directory: ${o.target}`);
  const target = realTarget(o.target);
  const W = join(target, '.burhan');
  if ((realTarget(kit) + sep).startsWith(W + sep)) throw new BurhanError(`the kit is inside ${W} — install it somewhere else and run it from there`);
  const installed = existsSync(join(W, 'WORKFLOW.md'));
  if (o.mode === 'upgrade' && !installed) throw new BurhanError(`burhan is not installed in ${target} — run \`burhan init\` first`);
  const oldVersion = existsSync(join(W, 'VERSION')) ? readFileSync(join(W, 'VERSION'), 'utf8').trim() : null;

  // ---------------------------------------------------------------- 1. validate (no writes)
  // Everything a later step writes is computed here, so the apply phase cannot fail on content.
  const timeout = checkTimeout(target);
  const team = existsSync(join(target, TEAM_CONFIG)) ? parseConfig(readFileSync(join(target, TEAM_CONFIG), 'utf8')).values : {};
  const checkCmd = team.WF_CHECK_CMD ?? '';
  // Team file only, like WF_CHECK_TIMEOUT: the hook commands are committed, so every machine must install the same ones.
  const runtimeValue = team.WF_HOOK_RUNTIME;
  const staleDirs = BASH_DIRS.filter((d) => existsSync(join(W, d)));
  // The bash hooks live beside the Node ones in `.burhan/hooks/`: when they are removed, EVERY installed agent's hook file must move
  // to the Node entries, or an agent left out of a partial --agents list would keep pointing at the directories that were just removed.
  const installedAgents = AGENTS.filter((a) => agentInstalled(target, a));
  const requested = o.agents ?? installedAgents;
  const agents = staleDirs.length > 0 ? [...new Set([...requested, ...installedAgents])] : requested;
  if (agents.length === 0) throw new BurhanError('no agents given and none installed — pass --agents claude[,codex]');
  const alsoSwitched = agents.filter((a) => !requested.includes(a));
  const kitDirs = ['phases', 'templates', 'commands', NODE_DIR];
  const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/; // a leading letter or digit: `model: -` is YAML for a list
  const notes: string[] = [];
  // Managed Claude files beside the commands. Each either should exist with this text, or should not
  // exist (text null): then a copy WE wrote earlier is removed. A file the user owns is never touched.
  const managed: { rel: string; text: string | null; why: string }[] = [];
  if (agents.includes('claude')) {
    const roleAgent = (role: string, key: string, always: boolean): void => {
      const model = team[key] ?? '';
      if (model && (!MODEL_RE.test(model) || /^(true|false|yes|no|on|off|null|y|n)$/i.test(model))) notes.push(`NOTE: ${key} "${model}" is not a model name (a letter or digit, then letters, digits, . _ : -) — ignored`);
      // YAML reads these as booleans or null, not a model name.
      const usable = model !== '' && MODEL_RE.test(model) && !/^(true|false|yes|no|on|off|null|y|n)$/i.test(model);
      const rel = `.claude/agents/burhan-${role}.md`;
      if (!always && !usable) { managed.push({ rel, text: null, why: model ? `${key} "${model}" is not a model name` : `${key} is not set in the team workflow.config` }); return; }
      let t = readFileSync(join(kit, `agents/claude/burhan-${role}.md`), 'utf8');
      if (usable) t = t.replace(/^tools: .*$/m, (m) => `${m}\nmodel: ${model}`);
      managed.push({ rel, text: withManagedMark(t), why: '' });
    };
    roleAgent('reviewer', 'WF_MODEL_CLAUDE_REVIEWER', true); // independent QC needs it, model or not
    roleAgent('planner', 'WF_MODEL_CLAUDE_PLANNER', false);
    roleAgent('builder', 'WF_MODEL_CLAUDE_BUILDER', false);
    roleAgent('explorer', 'WF_MODEL_CLAUDE_EXPLORER', false);
    managed.push(checkCmd
      ? { rel: '.claude/skills/burhan-verify/SKILL.md', text: withManagedMark(readFileSync(join(kit, 'skills/claude/burhan-verify/SKILL.md'), 'utf8').split('{{CHECK_CMD}}').join(checkCmd)), why: '' }
      : { rel: '.claude/skills/burhan-verify/SKILL.md', text: null, why: 'WF_CHECK_CMD is not set in the team .burhan/workflow.config (set it there, then `burhan upgrade`)' });
  }
  const ownedOld = (rel: string): boolean => {
    const f = join(target, rel);
    return existsSync(f) && statSync(f).isFile() && isManagedCommand(readFileSync(f, 'utf8'));
  };
  // Unwritable paths: --apply refuses before the first write; a dry run still shows the whole plan
  // and names them (an agent's sandbox may protect its own folder, e.g. Codex and .codex/).
  const blocked: string[] = [];
  const outside: OutsideFile[] = [];
  const landings = new Map<Agent, string>(); // where the hooks file's write lands, as the kernel resolves it
  const merged = new Map<Agent, string>();
  const hooksChanged = new Set<Agent>();
  const blocks = new Map<Agent, { content: string; editedInside: boolean }>();
  const gi = join(W, '.gitignore');
  const giText = existsSync(gi) && statSync(gi).isFile() ? readFileSync(gi, 'utf8') : null;
  const giMissing = ['/local/', '/work/', '/discovery/'].filter((rule) => !(giText ?? '').split(/\r?\n/).includes(rule));
  const giNeeded = giMissing.length > 0;
  // Project-owned files are written only when absent; existing ones are never touched, so not checked.
  const writes: string[] = [join(W, 'WORKFLOW.md'), join(W, 'SETUP.md'), join(W, 'VERSION'),
    ...(giNeeded ? [gi] : []),
    ...['bindings.md', 'workflow.config'].map((f) => join(W, f)).filter((f) => !existsSync(f))];
  for (const a of agents) {
    const hf = join(target, HOOKS_FILE[a]);
    if (!isFileTarget(hf)) throw new BurhanError(`${hf} is not a regular file`);
    const landing = resolveWritePath(hf);
    if (landing !== null) landings.set(a, landing);
    if (landing === null) outside.push({ rel: HOOKS_FILE[a], real: `${hf} (a link loop)` });
    else if (landing !== target && !landing.startsWith(target + sep)) outside.push({ rel: HOOKS_FILE[a], real: landing });
    let current: Settings = {};
    if (existsSync(hf)) {
      let v: unknown;
      try { v = JSON.parse(readFileSync(hf, 'utf8')); } catch { v = undefined; }
      if (!validHooksFile(v)) throw new BurhanError(`${hf}: expected a JSON object whose "hooks" (if present) maps event names to arrays of hook groups — fix it, then re-run`);
      if (!isWritable(hf)) blocked.push(`${hf} is not writable`);
      current = v;
    }
    const snippet = JSON.parse(readFileSync(join(kit, SNIPPET[a]), 'utf8')) as Settings;
    const mergedText = JSON.stringify(mergeHooks(current, snippet, burhanHookKeys(target, a), timeout + 10), null, 2) + '\n';
    merged.set(a, mergedText);
    if (a === 'codex' && existsSync(hf) && readFileSync(hf, 'utf8') !== mergedText) hooksChanged.add(a);
    writes.push(hf);
    if (a === 'claude') for (const c of COMMANDS) writes.push(join(target, `.claude/commands/burhan/${c}.md`));
    if (o.bootstrap) {
      const bf = join(target, BOOT_FILE[a]);
      if (!isFileTarget(bf)) throw new BurhanError(`${bf} is not a regular file (use --no-bootstrap to skip it)`);
      const existing = existsSync(bf) ? readFileSync(bf, 'utf8') : null;
      if (existing !== null && !isWritable(bf)) blocked.push(`${bf} is not writable (use --no-bootstrap to skip it)`);
      try { blocks.set(a, applyBlock(existing, a, version)); }
      catch (e) { if (e instanceof BlockError) throw new BurhanError(`${bf}: ${e.message}`); throw e; }
    }
  }
  for (const m of managed) if (m.text !== null || ownedOld(m.rel)) writes.push(join(target, m.rel));
  for (const p of writes) if (!isFileTarget(p)) throw new BurhanError(`${p} is not a regular file`);
  // A file the user owns (no managed marker) is skipped later, so it never needs to be writable.
  const ours = (p: string): boolean => !existsSync(p) || !p.includes(`${sep}.claude${sep}`) || isManagedCommand(readFileSync(p, 'utf8'));
  for (const p of writes) if (ours(p) && !canWrite(p) && !blocked.some((b) => b.startsWith(p + ' '))) blocked.push(`${p} is not writable`);
  for (const d of [...kitDirs, ...staleDirs]) {
    const bad = canReplace(join(W, d));
    if (bad) blocked.push(`${bad} is not writable`);
  }

  // ---------------------------------------------------------------- 2. plan
  const steps: { say: string; run?: () => void }[] = [];
  const step = (say: string, run?: () => void) => steps.push({ say, run });
  const files: PlannedFile[] = [];
  const file = (rel: string, kind: PlannedFile['kind'], remove = false): void => {
    const existed = existsSync(join(target, rel));
    files.push({ rel, existed, action: remove ? 'remove' : existed ? 'modify' : 'create', kind });
  };
  if (o.mode === 'init' && installed) step(`already installed (${oldVersion ?? 'unknown version'}) — refreshing, same as \`burhan upgrade\``);
  if (oldVersion && oldVersion !== version) step(`upgrade: ${oldVersion} → ${version}`);
  if (alsoSwitched.length) step(`the bash hooks are being replaced by the Node hooks, so ${alsoSwitched.join(', ')} ${alsoSwitched.length > 1 ? 'are' : 'is'} rewritten too — an agent left on the old hooks would point at files that are being removed`);

  for (const f of ['WORKFLOW.md', 'SETUP.md', 'VERSION']) file(`.burhan/${f}`, 'kit');
  for (const d of kitDirs) file(`.burhan/${d}/`, 'kit');
  for (const d of staleDirs) file(`.burhan/${d}/`, 'kit', true);
  step('kit files → .burhan/ (WORKFLOW.md, SETUP.md, VERSION, phases/, templates/, commands/, hooks/node/)', () => {
    putFile(join(W, 'WORKFLOW.md'), readFileSync(join(kit, 'WORKFLOW.md')));
    putFile(join(W, 'SETUP.md'), readFileSync(join(kit, 'SETUP.md')));
    putFile(join(W, 'VERSION'), version + '\n');
    for (const d of ['phases', 'templates', 'commands']) replaceDir(join(kit, d), join(W, d));
    replaceDir(nodeHooksDir(), join(W, NODE_DIR));
  });
  if (staleDirs.length) step(`removed the bash hooks (${staleDirs.map((d) => `.burhan/${d}/`).join(', ')}) — the Node hooks in .burhan/hooks/node/ replace them`, () => {
    for (const d of staleDirs) rmSync(join(W, d), { recursive: true, force: true });
    const adaptersDir = join(W, 'hooks/adapters');
    if (existsSync(adaptersDir) && readdirSync(adaptersDir).length === 0) rmSync(adaptersDir, { recursive: true, force: true });
  });
  if (runtimeValue === 'bash') step('NOTE: WF_HOOK_RUNTIME=bash — the bash hooks were removed in 0.3.0; the hooks are Node now. Remove the key from the team workflow.config.');
  else if (runtimeValue !== undefined && runtimeValue !== 'node') step(`NOTE: WF_HOOK_RUNTIME "${runtimeValue}" is no longer used — the hooks are Node. Remove the key from the team workflow.config.`);

  if (giNeeded) file('.burhan/.gitignore', 'gitignore');
  if (giNeeded)
    step('.burhan/.gitignore ← /local/, /work/, /discovery/ (private files stay out of git)', () =>
      putFile(gi, (giText && !giText.endsWith('\n') ? giText + '\n' : giText ?? '') + giMissing.join('\n') + '\n'));

  if (existsSync(join(W, 'bindings.md'))) step('bindings.md exists — kept as is (your WORKFLOW §1)');
  else if (!o.keepProjectFiles) { file('.burhan/bindings.md', 'config'); step('bindings.md ← templates/bindings.md (fill it in: WORKFLOW §1)', () => putFile(join(W, 'bindings.md'), readFileSync(join(kit, 'templates/bindings.md')))); }
  if (existsSync(join(W, 'workflow.config'))) step('workflow.config exists — kept as is');
  else if (!o.keepProjectFiles) { file('.burhan/workflow.config', 'config'); step('workflow.config ← workflow.config.example (fill it in, with bindings.md)', () => putFile(join(W, 'workflow.config'), readFileSync(join(kit, 'workflow.config.example')))); }

  for (const a of agents) {
    file(HOOKS_FILE[a], 'hooks');
    step(`hooks → ${a}: ${HOOKS_FILE[a]} (merged; your other settings and hooks kept)`, () => putFile(landings.get(a) ?? join(target, HOOKS_FILE[a]), merged.get(a)!));
    if (a === 'claude') {
      for (const c of COMMANDS) {
        const rel = `.claude/commands/burhan/${c}.md`;
        const dest = join(target, rel);
        if (existsSync(dest) && !isManagedCommand(readFileSync(dest, 'utf8'))) step(`skipped ${rel} — an existing file not managed by burhan`);
        else { file(rel, 'managed'); step(`command → /burhan:${c} (${rel})`, () => putFile(dest, withManagedMark(readFileSync(join(kit, 'commands', `${c}.md`), 'utf8')))); }
      }
      for (const m of managed) {
        const dest = join(target, m.rel);
        const text = m.text;
        if (text === null) {
          if (ownedOld(m.rel)) { file(m.rel, 'managed', true); step(`removed ${m.rel} — ${m.why}`, () => rmSync(dest)); }
          else if (m.rel.endsWith('verify/SKILL.md')) step(`verify skill skipped — ${m.why}`);
        } else if (existsSync(dest) && !isManagedCommand(readFileSync(dest, 'utf8'))) step(`skipped ${m.rel} — an existing file not managed by burhan`);
        else { file(m.rel, 'managed'); step(`managed → ${m.rel}`, () => putFile(dest, text)); }
      }
      for (const n of notes) step(n);
    }
    if (hooksChanged.has(a)) step('NOTE: Codex: the hook commands changed — Codex lists them as "Modified since last trusted" and skips them silently until you trust them again (open Codex here, /hooks, press t on each burhan hook)');
    const b = blocks.get(a);
    if (b) {
      const bf = join(target, BOOT_FILE[a]);
      if (b.editedInside) step(`WARNING: ${BOOT_FILE[a]} was edited inside the managed block — ${o.apply ? 'saved' : 'will save'} a copy to ${BOOT_FILE[a]}.burhan-backup; keep your own text outside the block`);
      file(BOOT_FILE[a], 'bootstrap');
      step(`bootstrap block → ${BOOT_FILE[a]} (content outside the block untouched)`, () => {
        if (b.editedInside) copyFileSync(realTarget(bf), bf + '.burhan-backup');
        putFile(bf, b.content);
      });
    }
  }

  const cfg = readProjectConfig(target);
  for (const p of cfg.problems) step(`NOTE: ${p.file}:${p.line}: ${p.reason}`);
  const state = cfg.values.WF_STATE_FILE;
  if (state !== undefined && !state.replace(/^(\.\/)+/, '').startsWith('.burhan/local/'))
    step(`NOTE: WF_STATE_FILE is "${state}" — shared by everyone who commits it. For team use, delete that line from .burhan/workflow.config (the default is .burhan/local/PROGRESS.md, git-ignored) and move your current file there.`);
  const problem = nodeRuntimeProblem();
  if (problem) step(`NOTE: the hooks run on Node ≥ 22 — ${problem}. Install a current Node and put it first on PATH: the agent runs the \`node\` it finds there.`);

  return { version, target, blocked, outside, steps, files, agents };
}

function runStep(s: { say: string; run?: () => void }): void {
  if (s.run) {
    try { s.run(); } catch (e) { throw new BurhanError(`failed: ${s.say}: ${(e as Error).message}`); }
  }
}

/** Runs every step's write; throws BurhanError on the first failure. Callers refuse a plan with `blocked` first. */
export function applyPlan(p: InstallPlan): void {
  for (const s of p.steps) runStep(s);
}

export function install(o: InstallOptions, io: Io): number {
  const plan = planInstall(o);
  const { version, target, blocked, outside, steps, agents } = plan;
  // ---------------------------------------------------------------- 3. apply
  if (blocked.length && o.apply) throw new BurhanError(`${blocked[0]} — nothing was changed`);
  const refused = outside.length > 0 && !o.allowOutsideSettings;
  if (refused && o.apply) throw new BurhanError(`${outside[0]!.rel} resolves outside the project (${outside[0]!.real}) — nothing was changed; pass --allow-outside-settings if you want burhan to edit that file`);
  io.stdout(o.apply ? `burhan ${version} → ${target}\n` : `DRY RUN — burhan ${version} → ${target} (nothing will change; add --apply)\n`);
  for (const b of blocked) io.stdout(`  BLOCKED: ${b} — --apply would stop here and change nothing; make it writable (or run the command outside the agent's sandbox)\n`);
  for (const f of outside) io.stdout(`  OUTSIDE: ${f.rel} → ${f.real} is outside the project — ${refused ? '--apply would refuse and change nothing (add --allow-outside-settings to write it)' : 'written because of --allow-outside-settings'}\n`);
  for (const s of steps) {
    io.stdout(`  ${s.say}\n`);
    if (o.apply) runStep(s); // per step, so a failure leaves the same partial output as before
  }
  io.stdout(`
Next: ask your agent to follow .burhan/SETUP.md (guided setup: it proposes the config with evidence and
asks before writing) — or fill in .burhan/bindings.md (WORKFLOW §1) and .burhan/workflow.config
yourself, and commit them for the team; personal overrides go in .burhan/local/workflow.config. Checks whose config key is empty stay
silent; the session gates always speak. Re-run \`burhan upgrade\` after changing WF_CHECK_TIMEOUT, or to
upgrade — bindings.md and workflow.config are never overwritten.
`);
  if (agents.includes('codex')) io.stdout(`
Codex: project hooks run only after you trust them. Until then burhan does nothing on Codex, with no
error (untrusted hooks are skipped SILENTLY). Trust them yourself: open Codex in this project (\`codex\`);
at "Hooks need review" choose "Review hooks" (or type /hooks); for each of SessionStart, UserPromptSubmit,
PreToolUse, PostToolUse and Stop, select the hook whose Source is "Project config - …/.codex/hooks.json"
and press t. Trust again when Codex shows one as "Modified since last trusted". Steps:
.burhan/SETUP.md § 7 · \`burhan doctor\` checks it.
`);
  return blocked.length || refused ? 1 : 0;
}
