import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import type { Io } from '../main.js';
import { isManagedCommand } from './commands.js';
import { LOCAL_CONFIG, parseConfig, TEAM_CONFIG, type ParsedConfig } from './config.js';
import { realTarget } from './fs-safe.js';
import { agentInstalled, hookKey, type HookEntry, type Settings } from './hooks-merge.js';
import { kitDir, nodeHooksDir, readVersion } from './kit.js';
import { ignoredCommittedSetupFiles } from './setup/engine.js';
import { readBaseline, readProjectFile } from '../hooks/core/baseline.mjs';
import { ereRefusal } from '../hooks/core/ere.mjs';
import { inspect } from './inspect.js';
import { checkMemory, factFreshness } from './memory.js';
import { readCodexConfig, stateTableNames, trustedEvents, type CodexConfigSkip } from './codex-trust.js';

/** `burhan doctor`: read-only health checks of an install. It never writes — not the project, not the
 *  agents' settings, not the user's global files (Codex hook trust is only read). */

export interface Check { status: 'ok' | 'warn' | 'fail' | 'skip'; text: string }
/** What the doctor asks of the machine; injected so tests need no particular PATH. */
export interface Probe { nodeVersion(): string | null; claudeVersion(): string | null; home(): string; platform?(): NodeJS.Platform }

export const realProbe: Probe = {
  nodeVersion: () => {
    const r = spawnSync('node', ['-p', 'process.versions.node'], { encoding: 'utf8', timeout: 5000 });
    return r.status === 0 ? r.stdout.trim() || null : null;
  },
  claudeVersion: () => {
    const r = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 10000 });
    return r.status === 0 ? (/(\d+\.\d+\.\d+)/.exec(r.stdout)?.[1] ?? null) : null;
  },
  home: () => homedir(),
  platform: () => process.platform,
};

const VERIFY_MIN = '2.1.286'; // Claude Code reads skills with `verify` from this version
const EXEC_FORM_MIN = '2.1.139'; // Claude Code runs `command` + `args` without a shell from this version
/** The oldest Node the hooks are written for (package.json engines). */
export const NODE_MIN_MAJOR = 22;
const HOOKS: Record<'claude' | 'codex', { file: string; snippet: string }> = {
  claude: { file: '.claude/settings.json', snippet: 'hooks/adapters/claude/settings.node.snippet.json' },
  codex: { file: '.codex/hooks.json', snippet: 'hooks/adapters/codex/hooks.node.snippet.json' },
};
// Codex names hook events in snake case in its trust entries.
const CODEX_EVENT: Record<string, string> = {
  SessionStart: 'session_start', UserPromptSubmit: 'user_prompt_submit', PreToolUse: 'pre_tool_use', PostToolUse: 'post_tool_use', Stop: 'stop',
};
const CODEX_SKIP: Record<CodexConfigSkip, string> = {
  absent: 'not found', symlink: 'is a symbolic link, or sits in a symlinked ~/.codex (not followed)', 'not a file': 'is not a regular file',
  large: 'is larger than 1 MiB', unreadable: 'could not be read',
};

type HookFile = { hooks?: Record<string, { hooks?: HookEntry[] }[]> };

const older = (a: string, b: string): boolean => {
  const x = a.split('.').map(Number); const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
};

/** A file's text, or null when it is missing or cannot be read — the doctor reports, never crashes. */
function readText(p: string): string | null {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}
function readJson(p: string): unknown {
  const t = readText(p);
  try { return t === null ? undefined : JSON.parse(t); } catch { return undefined; }
}
const unreadable = (p: string): boolean => existsSync(p) && readText(p) === null;
/** Hook groups of one event, tolerating any JSON shape (a wrong shape = not wired). */
const groups = (v: HookFile, event: string): { hooks?: HookEntry[] }[] => {
  const h = v.hooks;
  const list = h && typeof h === 'object' && !Array.isArray(h) ? (h as Record<string, unknown>)[event] : undefined;
  return Array.isArray(list) ? list.filter((g) => g && typeof g === 'object') : [];
};

const SUBS = /\b(session-gates|prompt-router|pre-commit-check|post-edit-reminder|turn-audit)\b/;
/** Each snippet event with the core hook it runs, and the key that identifies the entry in the agent's file. */
function wanted(agent: 'claude' | 'codex'): { event: string; sub: string; key: string }[] {
  const s = (readJson(join(kitDir(), HOOKS[agent].snippet)) ?? {}) as Settings;
  const out: { event: string; sub: string; key: string }[] = [];
  for (const [event, groups] of Object.entries(s.hooks ?? {}))
    for (const g of groups) for (const h of g.hooks ?? []) {
      const m = SUBS.exec(`${String(h.command)} ${(h.args ?? []).join(' ')}`);
      if (m && typeof h.command === 'string') out.push({ event, sub: m[1], key: hookKey(h) });
    }
  return out;
}

/** Every file under dir, relative, forward slashes. */
function filesUnder(dir: string, rel = ''): string[] {
  return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? filesUnder(dir, `${rel}${e.name}/`) : [`${rel}${e.name}`]);
}

export function runChecks(targetIn: string, probe: Probe = realProbe): Check[] {
  const cs: Check[] = [];
  const add = (status: Check['status'], text: string) => cs.push({ status, text });

  // ---- runtime: what the hooks need on this machine
  const nv = probe.nodeVersion();
  if (nv === null) add('fail', `node: not found on PATH — the hooks run on Node ≥ ${NODE_MIN_MAJOR}, and the agent runs the \`node\` it finds there (install a current Node and put it first on PATH)`);
  else if (Number.parseInt(nv, 10) < NODE_MIN_MAJOR) add('fail', `node ${nv}: the hooks need Node ≥ ${NODE_MIN_MAJOR} — the agent runs the \`node\` first on its PATH (nvm/volta users: check the PATH the agent starts with)`);
  else add('ok', `node ${nv}`);

  // ---- install
  if (!existsSync(targetIn) || !statSync(targetIn).isDirectory()) { add('fail', `not a directory: ${targetIn}`); return cs; }
  const target = realTarget(targetIn);
  const W = join(target, '.burhan');
  const parts = ['WORKFLOW.md', 'phases', 'hooks/node/main.mjs'].filter((f) => !existsSync(join(W, f)));
  if (!existsSync(join(W, 'WORKFLOW.md'))) { add('fail', `burhan is not installed here (.burhan/WORKFLOW.md missing) — run burhan init ${target} --agents claude[,codex] --apply`); return cs; }
  if (parts.length) add('fail', `.burhan/ is incomplete (missing: ${parts.join(', ')}) — run burhan upgrade --apply`);
  for (const f of ['.burhan/WORKFLOW.md', '.burhan/VERSION'])
    if (unreadable(join(target, f))) add('fail', `unreadable: ${f} — check its permissions`);
  const version = readVersion();
  const stamp = readText(join(W, 'VERSION'))?.trim() ?? 'unknown';
  if (stamp === version) add('ok', `kit ${stamp} matches the CLI`);
  else add('warn', `kit ${stamp} ≠ CLI ${version} — run burhan upgrade --apply`);
  // Same version, different files: edited in place, or installed by another build.
  const kit = kitDir();
  const kitFiles = [
    ...['WORKFLOW.md', 'SETUP.md'].map((f) => ({ rel: f, from: join(kit, f) })),
    ...['phases', 'commands']
      .flatMap((d) => readdirSync(join(kit, d), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => ({ rel: `${d}/${e.name}`, from: join(kit, d, e.name) }))),
    ...filesUnder(nodeHooksDir()).map((f) => ({ rel: `hooks/node/${f}`, from: join(nodeHooksDir(), f) })),
  ];
  const differ = kitFiles.filter(({ rel, from }) => {
    try { return !readFileSync(join(W, rel)).equals(readFileSync(from)); } catch { return true; }
  }).map((f) => f.rel);
  if (differ.length) add('warn', `kit files differ from this CLI's kit (${differ.slice(0, 5).map((f) => `.burhan/${f}`).join(', ')}${differ.length > 5 ? ` and ${differ.length - 5} more` : ''}) — edited in place or another build; run burhan upgrade --apply`);
  else add('ok', 'kit files match this CLI');

  // ---- config: the same parser the CLI uses, mirroring what the hooks read (team, then local)
  const cfg: ParsedConfig = { values: {}, problems: [] };
  let team: Record<string, string> | null = null;
  for (const rel of [TEAM_CONFIG, LOCAL_CONFIG]) {
    const t = readText(join(target, rel));
    if (t === null) { if (unreadable(join(target, rel))) add('fail', `unreadable: ${rel} — the hooks cannot read the config; check its permissions`); continue; }
    const r = parseConfig(t, rel);
    if (rel === TEAM_CONFIG) team = r.values;
    Object.assign(cfg.values, r.values);
    cfg.problems.push(...r.problems);
  }
  // One line per file for CRLF endings (every line has them), one per line otherwise.
  for (const f of new Set(cfg.problems.filter((p) => p.reason.startsWith('CRLF')).map((p) => p.file)))
    add('warn', `${f}: CRLF line endings (${cfg.problems.filter((p) => p.file === f && p.reason.startsWith('CRLF')).length} lines) — save it with LF endings; the hooks cannot read those lines`);
  for (const p of cfg.problems.filter((q) => !q.reason.startsWith('CRLF'))) add('warn', `${p.file}:${p.line}: ${p.reason} — the hooks ignore this line`);
  const example = Object.keys(parseConfig(readFileSync(join(kitDir(), 'workflow.config.example'), 'utf8')).values);
  const legacy = ['WF_FORBIDDEN_REGEX', 'WF_FORBIDDEN_REASON', 'WF_SINGLE_TEST_HINT', 'WF_HOOK_RUNTIME'];
  if (team === null) { if (!unreadable(join(target, TEAM_CONFIG))) add('warn', `${TEAM_CONFIG} missing — run burhan upgrade --apply to create it from the example`); }
  else {
    const missing = example.filter((k) => !(k in team));
    if (missing.length) add('warn', `${TEAM_CONFIG}: keys missing compared with this version's example (defaults apply; copy them from workflow.config.example to set them): ${missing.join(', ')}`);
    const unknown = Object.keys(cfg.values).filter((k) => !example.includes(k) && !legacy.includes(k));
    if (unknown.length) add('warn', `unknown config keys (a typo?): ${unknown.join(', ')}`);
    if (team.WF_HOOK_RUNTIME === 'bash') add('warn', 'WF_HOOK_RUNTIME=bash: the bash hooks were removed in 0.3.0 and the hooks are Node now — remove the key from the team workflow.config and run burhan upgrade --apply');
    if (!missing.length && !unknown.length && !cfg.problems.length) add('ok', 'workflow.config: every key known, none missing');
  }
  // A pattern the hooks' ERE translator refuses makes its check silent; name it here instead.
  for (const [key, value] of Object.entries(cfg.values)) {
    if (legacy.includes(key) || !/^WF_[A-Z0-9_]*_REGEX$/.test(key) || value === '') continue;
    const why = ereRefusal(value);
    if (why) add('warn', `${key}: the hooks refuse this pattern (${why}), so its check stays silent — rewrite it`);
  }
  // First-use is done but nothing says what counts as code: the "done without proof" warning and the test-first reminder are off.
  if (cfg.values.WF_STACK_SETUP === 'done' && !(cfg.values.WF_CODE_REGEX ?? '')) add('warn', 'WF_CODE_REGEX is empty — the "done without proof" warning and the test-first reminder are off; say what counts as code: burhan setup --set check=<command> code=<pattern> test=<pattern> evidence=<pattern>');
  const ev = cfg.values.WF_EVIDENCE_DIR;
  if (ev && !isAbsolute(ev)) add('warn', `WF_EVIDENCE_DIR "${ev}" is not an absolute literal path — it is ignored and the default ledger is used`);
  if (cfg.values.WF_SENSITIVE_REGEX && !cfg.values.WF_SENSITIVE_NOTE) add('warn', 'WF_SENSITIVE_REGEX is set but WF_SENSITIVE_NOTE is empty — add the access-control reminder');

  // ---- per agent (only the agents burhan is installed for)
  for (const agent of ['claude', 'codex'] as const) {
    if (!agentInstalled(target, agent)) { add('skip', `${agent}: not installed`); continue; }
    const rel = HOOKS[agent].file;
    const v = readJson(join(target, rel)) as HookFile | undefined;
    if (v === undefined || typeof v !== 'object' || v === null) { add('fail', `${rel}: missing or not valid JSON — run burhan upgrade --apply`); continue; }
    const unwired = wanted(agent).filter(({ event, key }) => !groups(v, event).some((g) => Array.isArray(g.hooks) &&
      g.hooks.some((h) => h && typeof h === 'object' && typeof h.command === 'string' && hookKey(h) === key)));
    if (unwired.length) add('fail', `${rel}: hooks not wired — ${unwired.map((u) => `${u.event} (${u.sub})`).join(', ')} — run burhan upgrade --apply`);
    else add('ok', `${rel}: all ${wanted(agent).length} hooks wired`);

    if (agent === 'claude') {
      for (const f of ['.claude/commands/burhan/e2e.md', '.claude/commands/burhan/qc.md', '.claude/commands/burhan/onboard.md', '.claude/agents/burhan-reviewer.md']) {
        const p = join(target, f);
        if (!existsSync(p)) add('fail', `${f}: missing — run burhan upgrade --apply`);
        else if (readText(p) === null) add('fail', `unreadable: ${f} — check its permissions`);
        else if (!isManagedCommand(readText(p)!)) add('warn', `${f}: not managed by burhan (your own file) — upgrades skip it`);
        else add('ok', f);
      }
      const execVersion = probe.claudeVersion();
      if (execVersion === null) add('skip', `claude CLI version: not found on PATH — the exec-form hooks need Claude Code ≥ ${EXEC_FORM_MIN}`);
      else if (older(execVersion, EXEC_FORM_MIN)) add('fail', `Claude Code ${execVersion}: the Node hooks use the exec form (command + args), which needs Claude Code ≥ ${EXEC_FORM_MIN} — update Claude Code (burhan 0.3.0 has no other hook path)`);
      else add('ok', `Claude Code ${execVersion} (exec-form hooks)`);
      if (existsSync(join(target, '.claude/skills/burhan-verify/SKILL.md'))) {
        const cv = probe.claudeVersion();
        if (cv === null) add('skip', 'claude CLI version: not found on PATH — the verify skill needs Claude Code ≥ ' + VERIFY_MIN);
        else if (older(cv, VERIFY_MIN)) add('warn', `Claude Code ${cv}: the verify skill needs ≥ ${VERIFY_MIN} — update Claude Code`);
        else add('ok', `Claude Code ${cv} (verify skill)`);
      }
    } else {
      // Read only, table names only (codex-trust.ts) — trust is the user's to grant, in Codex itself.
      const read = readCodexConfig(probe.home());
      const reference = "the Trust line in Codex's /hooks is the reference";
      if ('skip' in read) add('skip', `codex hook trust: ~/.codex/config.toml ${CODEX_SKIP[read.skip]} — not checked; ${reference}`);
      else {
        const want = wanted('codex').map(({ event }) => ({ event, key: CODEX_EVENT[event] ?? event }));
        const windows = (probe.platform?.() ?? process.platform) === 'win32';
        const found = trustedEvents(stateTableNames(read.text), [target, resolve(targetIn)], want.map((w) => w.key), windows);
        const list = want.map((w) => `${w.event} ${found.has(w.key) ? 'present' : 'absent'}`).join(', ');
        const blind = 'read from table names only, so "Modified since last trusted" and a disabled hook are not visible here';
        if (want.every((w) => found.has(w.key))) add('ok', `codex hook trust: an entry for every burhan hook (${list}) — ${blind}; ${reference} (trust again after an upgrade that changes a hook)`);
        else add('warn', `codex hook trust: ${list} — Codex skips untrusted hooks silently, so burhan does nothing for an absent one. Trust them yourself: open Codex in this project (run codex); at "Hooks need review" choose "Review hooks" (or type /hooks); for each event, select the hook whose Source is "Project config - …/.codex/hooks.json" and press t. This check is ${blind}; if it still warns once every burhan hook reads Trusted in Codex, the Trusted line in Codex is what counts. Steps: https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md#codex-trust-the-hooks`);
      }
    }
  }

  // ---- project memory (guidance: warnings only, never a fail)
  try {
    const pf = readProjectFile(target);
    const b = 'text' in pf ? readBaseline(pf.text) : null;
    const decided = b !== null && (b.state === 'approved' || b.state === 'waived');
    const legacy = b?.legacy ? ' (older Memory status: field — the next onboarding writes Baseline:)' : '';
    const look = decided ? null : inspect(target);
    const cut = look !== null && Object.values(look.truncated).some(Boolean);
    if (decided) add('ok', `project memory: baseline ${b.state === 'approved' ? 'Approved' : 'Waived'}${b.name ? ` — ${b.name}` : ''} · ${b.date}${legacy}`);
    else if (look!.kind === 'greenfield') add('ok', `project memory: greenfield — no baseline needed yet${cut ? ' (only part of the tree was read — run burhan inspect)' : ''}`);
    else if (b?.state === 'draft') add('warn', `project memory: the baseline is a Draft${legacy} — finish the onboarding and get the person's decision (Claude Code: /burhan:onboard · Codex: .burhan/commands/onboard.md)`);
    else add('warn', `project memory: this project has code but no approved baseline${b?.state === 'malformed' ? ' (the Baseline line is not in an exact form)' : ''} — run the onboarding (Claude Code: /burhan:onboard · Codex: .burhan/commands/onboard.md), or the person waives it`);
    const mem = checkMemory(target);
    if (mem.present) {
      const fails = mem.problems.filter((x) => x.level === 'fail').length;
      if (fails > 0) add('warn', `project memory: memory check: ${fails} fail — run burhan memory check`);
      let changed = 0; let missing = 0;
      const cache = new Map<string, string>();
      for (const f of mem.facts) {
        if (f.state === 'superseded') continue;
        const st = factFreshness(f, target, cache);
        if (st === 'changed') changed++; else if (st === 'missing') missing++;
      }
      if (changed + missing > 0) add('warn', `project memory: ${changed} fact${changed === 1 ? '' : 's'} changed, ${missing} missing — changed does not mean false: run burhan memory status and refresh them (.burhan/commands/onboard.md · Refresh)`);
    }
  } catch { add('skip', 'project memory: could not be read'); }

  const ignoredCommitted = ignoredCommittedSetupFiles(target);
  if (ignoredCommitted.length) add('warn', `git ignores setup files. Add these exact lines to .gitignore; burhan did not edit it:\n${ignoredCommitted.join('\n')}`);

  // ---- state
  const gi = join(W, '.gitignore');
  if (unreadable(gi)) add('warn', 'unreadable: .burhan/.gitignore — cannot tell whether local/ is ignored');
  else if (/^\/?local\/?\r?$/m.test(readText(gi) ?? '')) add('ok', '.burhan/.gitignore ignores local/');
  else add('warn', '.burhan/.gitignore does not ignore local/ — each developer\'s state file would be committed (burhan upgrade --apply adds it)');
  const stateRel = cfg.values.WF_STATE_FILE || '.burhan/local/PROGRESS.md';
  const budget = /^\d+$/.test(cfg.values.WF_STATE_BUDGET ?? '') ? Number(cfg.values.WF_STATE_BUDGET) : 80;
  const sp = join(target, stateRel);
  if (existsSync(sp) && statSync(sp).isFile()) {
    const text = readText(sp);
    if (text === null) { add('warn', `unreadable: ${stateRel} — check its permissions`); return cs; }
    const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    if (lines > budget) add('warn', `${stateRel}: ${lines} lines, over the budget of ${budget} — close out finished items`);
    else add('ok', `${stateRel}: ${lines} / ${budget} lines`);
  }
  return cs;
}

export function doctor(o: { target: string }, io: Io, probe: Probe = realProbe): number {
  const cs = runChecks(o.target, probe);
  for (const c of cs) io.stdout(`${c.status.padEnd(4)}  ${c.text}\n`);
  const n = (s: Check['status']) => cs.filter((c) => c.status === s).length;
  io.stdout(`\n${n('fail')} fail · ${n('warn')} warn · ${n('ok')} ok · ${n('skip')} skip\n`);
  return n('fail') > 0 ? 1 : 0;
}
