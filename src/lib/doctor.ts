import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import type { Io } from '../main.js';
import { isManagedCommand } from './commands.js';
import { LOCAL_CONFIG, parseConfig, TEAM_CONFIG, type ParsedConfig } from './config.js';
import { realTarget } from './fs-safe.js';
import { kitDir, readVersion } from './kit.js';
import { ignoredCommittedSetupFiles } from './setup/engine.js';

/** `burhan doctor`: read-only health checks of an install. It never writes — not the project, not the
 *  agents' settings, not the user's global files (Codex hook trust is only read). */

export interface Check { status: 'ok' | 'warn' | 'fail' | 'skip'; text: string }
/** What the doctor asks of the machine; injected so tests need no particular PATH. */
export interface Probe { bashMajor(): number | null; has(cmd: string): boolean; jqVersion(): string | null; claudeVersion(): string | null; home(): string }

export const realProbe: Probe = {
  bashMajor: () => {
    const r = spawnSync('bash', ['-c', 'echo "${BASH_VERSINFO[0]}"'], { encoding: 'utf8', timeout: 5000 });
    const n = r.status === 0 ? Number.parseInt(r.stdout.trim(), 10) : Number.NaN;
    return Number.isNaN(n) ? null : n;
  },
  has: (cmd) => (process.env.PATH ?? '').split(delimiter).some((d) => {
    if (!d) return false;
    try { accessSync(join(d, cmd), constants.X_OK); return statSync(join(d, cmd)).isFile(); } catch { return false; }
  }),
  jqVersion: () => {
    const r = spawnSync('jq', ['--version'], { encoding: 'utf8', timeout: 5000 });
    return r.status === 0 ? r.stdout.trim() || null : null;
  },
  claudeVersion: () => {
    const r = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 10000 });
    return r.status === 0 ? (/(\d+\.\d+\.\d+)/.exec(r.stdout)?.[1] ?? null) : null;
  },
  home: () => homedir(),
};

const VERIFY_MIN = '2.1.286'; // Claude Code reads skills with `verify` from this version
/** The oldest jq the hooks are written for and CI runs (tests/jq-compat.test.sh; ubuntu-22.04 ships it). */
export const JQ_MIN = '1.6';
const HOOKS: Record<'claude' | 'codex', { file: string; snippet: string }> = {
  claude: { file: '.claude/settings.json', snippet: 'hooks/adapters/claude/settings.snippet.json' },
  codex: { file: '.codex/hooks.json', snippet: 'hooks/adapters/codex/hooks.snippet.json' },
};
// Codex names hook events in snake case in its trust entries.
const CODEX_EVENT: Record<string, string> = {
  SessionStart: 'session_start', UserPromptSubmit: 'user_prompt_submit', PreToolUse: 'pre_tool_use', PostToolUse: 'post_tool_use', Stop: 'stop',
};

type HookFile = { hooks?: Record<string, { hooks?: { command?: unknown }[] }[]> };

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
const groups = (v: HookFile, event: string): { hooks?: { command?: unknown }[] }[] => {
  const h = v.hooks;
  const list = h && typeof h === 'object' && !Array.isArray(h) ? (h as Record<string, unknown>)[event] : undefined;
  return Array.isArray(list) ? list.filter((g) => g && typeof g === 'object') : [];
};

const SUBS = /\b(session-gates|prompt-router|pre-commit-check|post-edit-reminder|turn-audit)\b/;
/** Each snippet event with the core hook it runs. */
function wanted(agent: 'claude' | 'codex'): { event: string; sub: string; command: string }[] {
  const s = (readJson(join(kitDir(), HOOKS[agent].snippet)) ?? {}) as HookFile;
  const out: { event: string; sub: string; command: string }[] = [];
  for (const [event, groups] of Object.entries(s.hooks ?? {}))
    for (const g of groups) for (const h of g.hooks ?? []) {
      const m = SUBS.exec(String(h.command));
      if (m && typeof h.command === 'string') out.push({ event, sub: m[1], command: h.command });
    }
  return out;
}

export function runChecks(targetIn: string, probe: Probe = realProbe): Check[] {
  const cs: Check[] = [];
  const add = (status: Check['status'], text: string) => cs.push({ status, text });

  // ---- runtime: what the hooks need on this machine
  const bash = probe.bashMajor();
  if (bash === null) add('fail', 'bash: not found — the hooks run under bash ≥ 4 (Windows: Git Bash or WSL)');
  else if (bash < 4) add('fail', `bash ${bash}: the hooks need bash ≥ 4 — macOS ships 3.2: brew install bash, and put it first on PATH`);
  else add('ok', `bash ${bash}`);
  if (!probe.has('jq')) add('fail', 'jq: not found — the hooks need it (brew/apt install jq)');
  else {
    const raw = probe.jqVersion();
    const v = raw ? /^jq-(\d+)\.(\d+)(?:\.(\d+))?(?=$|[^\d.])/.exec(raw) : null;
    if (!v) add('warn', `jq: version not readable (${raw ?? 'no output from jq --version'}) — the hooks need jq ≥ ${JQ_MIN}`);
    else {
      const ver = `${v[1]}.${v[2]}${v[3] ? `.${v[3]}` : ''}`;
      if (older(ver, JQ_MIN)) add('fail', `jq ${ver}: the hooks need jq ≥ ${JQ_MIN} — an older jq cannot compile their filters, and they would record nothing (brew/apt upgrade jq)`);
      else add('ok', `jq ${ver}`);
    }
  }
  const sha = probe.has('sha256sum') || probe.has('shasum');
  add(sha ? 'ok' : 'fail', sha ? 'sha256 tool (sha256sum or shasum)' : 'sha256 tool: neither sha256sum nor shasum found — the evidence ledger needs one');
  const to = probe.has('timeout') || probe.has('gtimeout');
  add(to ? 'ok' : 'warn', to ? 'timeout (or gtimeout)' : 'timeout: neither timeout nor gtimeout found — the pre-commit check reports NOT VERIFIED (macOS: brew install coreutils)');

  // ---- install
  if (!existsSync(targetIn) || !statSync(targetIn).isDirectory()) { add('fail', `not a directory: ${targetIn}`); return cs; }
  const target = realTarget(targetIn);
  const W = join(target, '.burhan');
  const parts = ['WORKFLOW.md', 'phases', 'hooks/core'].filter((f) => !existsSync(join(W, f)));
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
  const kitFiles = ['WORKFLOW.md', 'SETUP.md', ...['phases', 'commands', 'hooks/core', ...(['claude', 'codex'] as const)
    .filter((a) => existsSync(join(W, 'hooks/adapters', a))).map((a) => `hooks/adapters/${a}`)]
    .flatMap((d) => readdirSync(join(kit, d), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => `${d}/${e.name}`))];
  const differ = kitFiles.filter((f) => {
    try { return readFileSync(join(W, f), 'utf8') !== readFileSync(join(kit, f), 'utf8'); } catch { return true; }
  });
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
  const legacy = ['WF_FORBIDDEN_REGEX', 'WF_FORBIDDEN_REASON', 'WF_SINGLE_TEST_HINT'];
  if (team === null) { if (!unreadable(join(target, TEAM_CONFIG))) add('warn', `${TEAM_CONFIG} missing — run burhan upgrade --apply to create it from the example`); }
  else {
    const missing = example.filter((k) => !(k in team));
    if (missing.length) add('warn', `${TEAM_CONFIG}: keys missing compared with this version's example (defaults apply; copy them from workflow.config.example to set them): ${missing.join(', ')}`);
    const unknown = Object.keys(cfg.values).filter((k) => !example.includes(k) && !legacy.includes(k));
    if (unknown.length) add('warn', `unknown config keys (a typo?): ${unknown.join(', ')}`);
    if (!missing.length && !unknown.length && !cfg.problems.length) add('ok', 'workflow.config: every key known, none missing');
  }
  const ev = cfg.values.WF_EVIDENCE_DIR;
  if (ev && !isAbsolute(ev)) add('warn', `WF_EVIDENCE_DIR "${ev}" is not an absolute literal path — it is ignored and the default ledger is used`);
  if (cfg.values.WF_SENSITIVE_REGEX && !cfg.values.WF_SENSITIVE_NOTE) add('warn', 'WF_SENSITIVE_REGEX is set but WF_SENSITIVE_NOTE is empty — add the access-control reminder');

  // ---- per agent (only adapters init installed)
  for (const agent of ['claude', 'codex'] as const) {
    if (!existsSync(join(W, 'hooks/adapters', agent))) { add('skip', `${agent}: not installed`); continue; }
    const rel = HOOKS[agent].file;
    const v = readJson(join(target, rel)) as HookFile | undefined;
    if (v === undefined || typeof v !== 'object' || v === null) { add('fail', `${rel}: missing or not valid JSON — run burhan upgrade --apply`); continue; }
    const unwired = wanted(agent).filter(({ event, command }) => !groups(v, event).some((g) => Array.isArray(g.hooks) &&
      g.hooks.some((h) => h && h.command === command)));
    if (unwired.length) add('fail', `${rel}: hooks not wired — ${unwired.map((u) => `${u.event} (${u.sub})`).join(', ')} — run burhan upgrade --apply`);
    else add('ok', `${rel}: all ${wanted(agent).length} hooks wired`);

    if (agent === 'claude') {
      for (const f of ['.claude/commands/burhan/e2e.md', '.claude/commands/burhan/qc.md', '.claude/agents/burhan-reviewer.md']) {
        const p = join(target, f);
        if (!existsSync(p)) add('fail', `${f}: missing — run burhan upgrade --apply`);
        else if (readText(p) === null) add('fail', `unreadable: ${f} — check its permissions`);
        else if (!isManagedCommand(readText(p)!)) add('warn', `${f}: not managed by burhan (your own file) — upgrades skip it`);
        else add('ok', f);
      }
      if (existsSync(join(target, '.claude/skills/burhan-verify/SKILL.md'))) {
        const cv = probe.claudeVersion();
        if (cv === null) add('skip', 'claude CLI version: not found on PATH — the verify skill needs Claude Code ≥ ' + VERIFY_MIN);
        else if (older(cv, VERIFY_MIN)) add('warn', `Claude Code ${cv}: the verify skill needs ≥ ${VERIFY_MIN} — update Claude Code`);
        else add('ok', `Claude Code ${cv} (verify skill)`);
      }
    } else {
      // Read only — trust is the user's to grant, in Codex itself. The hash is not checked.
      const toml = join(probe.home(), '.codex/config.toml');
      const text = readText(toml);
      if (text === null) add('skip', 'codex hook trust: ~/.codex/config.toml not readable');
      else {
        // An entry counts when its project path is this project's — as written (the path Codex was
        // started in may go through a symlink; macOS: /var → /private/var) or as resolved.
        const trusted = new Set<string>();
        const real = new Map<string, string>();
        for (const m of text.matchAll(/"([^"\n]*)\/\.codex\/hooks\.json:([a-z_]+):/g)) {
          const dir = m[1];
          if (!real.has(dir)) real.set(dir, realTarget(dir));
          if (dir === target || dir === resolve(targetIn) || real.get(dir) === target) trusted.add(m[2]);
        }
        const untrusted = wanted('codex').filter(({ event }) => !trusted.has(CODEX_EVENT[event] ?? event));
        if (untrusted.length) add('warn', `codex hook trust: no entry for ${untrusted.map((u) => u.event).join(', ')} — Codex skips untrusted hooks silently, so burhan would do nothing there. Trust them yourself: open Codex in this project (run codex); at "Hooks need review" choose "Review hooks" (or type /hooks); for each event, select the hook whose Source is "Project config - …/.codex/hooks.json" and press t. If this still warns once every burhan hook reads Trusted in Codex, the Trusted line in Codex is what counts (this check infers the key format). Steps: https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md#codex-trust-the-hooks`);
        else add('ok', 'codex hook trust: an entry for every hook (hashes not checked — re-approve after an upgrade that changes a hook)');
      }
    }
  }

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
