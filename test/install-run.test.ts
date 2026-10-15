import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { applyPlan, planInstall } from '../src/lib/install.js';
import { notOnWindows, tmpDir } from './helpers.js';

// The generated hook commands are run the way the agents run them: Claude Code spawns `command` + `args` with no shell,
// Codex passes the `command` string to a shell. Nothing here is mocked: the Node hooks that `init` copied are executed.
function installed(config = ''): string {
  const d = tmpDir('burhan-run-');
  spawnSync('git', ['init', '-q'], { cwd: d });
  mkdirSync(join(d, '.burhan'), { recursive: true });
  writeFileSync(join(d, '.burhan/workflow.config'), config);
  applyPlan(planInstall({ mode: 'init', target: d, agents: ['claude', 'codex'], apply: true, bootstrap: false }));
  return d;
}
type Entry = { command: string; args?: string[] };
const hooksOf = (d: string, file: string, event: string): Entry[] =>
  (JSON.parse(readFileSync(join(d, file), 'utf8')) as { hooks: Record<string, { hooks: Entry[] }[]> }).hooks[event].flatMap((g) => g.hooks);
const state = tmpDir('burhan-run-state-');
const baseEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ ...process.env, XDG_STATE_HOME: state, WF_CODEX_LEDGER_DIR: join(state, 'codex'), ...extra });
const message = (stdout: string): string => {
  const out = JSON.parse(stdout) as { hookSpecificOutput?: { additionalContext?: string }; decision?: string; reason?: string };
  return out.hookSpecificOutput?.additionalContext ?? out.reason ?? '';
};

/** Runs a Codex hook command the way Codex does: `cmd.exe /C` on Windows, a shell `-c` elsewhere. */
function launch(command: string, cwd: string, input: string): SpawnSyncReturns<string> {
  const [shell, args] = process.platform === 'win32'
    ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${command}"`]]
    : ['sh', ['-c', command]];
  // Verbatim on Windows: cmd.exe does not understand the `\"` that Node would otherwise put around each `"` of the command.
  return spawnSync(shell, args, { cwd, env: baseEnv(), input, encoding: 'utf8', windowsVerbatimArguments: process.platform === 'win32' });
}

test('Claude Code: the exec form runs as Claude spawns it (no shell, ${CLAUDE_PROJECT_DIR} substituted) and answers', () => {
  const d = installed();
  const [entry] = hooksOf(d, '.claude/settings.json', 'SessionStart');
  assert.equal(entry.command, 'node');
  const args = entry.args!.map((a) => a.replaceAll('${CLAUDE_PROJECT_DIR}', d));
  const r = spawnSync(entry.command, args, { cwd: tmpDir('burhan-run-elsewhere-'), env: baseEnv({ CLAUDE_PROJECT_DIR: d }), input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'S1', cwd: d }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.match(message(r.stdout), /WORKFLOW GATES/u);
});

test('Claude Code: the pre-commit hook really runs WF_CHECK_CMD on this OS and says what it found', () => {
  const d = installed('WF_CHECK_CMD="exit 3"\nWF_CHECK_TIMEOUT=20\n');
  const [entry] = hooksOf(d, '.claude/settings.json', 'PreToolUse');
  const args = entry.args!.map((a) => a.replaceAll('${CLAUDE_PROJECT_DIR}', d));
  const r = spawnSync(entry.command, args, { cwd: d, env: baseEnv({ CLAUDE_PROJECT_DIR: d }), input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'S1', cwd: d, tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(message(r.stdout), /FAIL/u);
});

const shells: [string, string[]][] = [['sh', ['-c']], ['bash', ['-c']], ['dash', ['-c']], ['zsh', ['-c']]];
for (const [shell, flags] of shells) {
  test(`Codex: the launcher string runs under ${shell} from a subdirectory of the project and finds the installed hooks`, { skip: notOnWindows('Windows runs the launcher under cmd /C (tests below)') || (spawnSync(shell, ['-c', 'exit 0']).status !== 0 ? `${shell} is not installed here` : false) }, () => {
    const d = installed();
    const sub = join(d, 'pkg/inner');
    mkdirSync(sub, { recursive: true });
    const { command } = hooksOf(d, '.codex/hooks.json', 'SessionStart')[0];
    const r = spawnSync(shell, [...flags, command], { cwd: sub, env: baseEnv(), input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'S1', turn_id: 'U1', cwd: sub }), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, '');
    assert.match(message(r.stdout), /WORKFLOW GATES/u, `the project was found from ${sub}`);
  });
}

test('Codex: outside any project the launcher exits 0 and says nothing', () => {
  const { command } = hooksOf(installed(), '.codex/hooks.json', 'SessionStart')[0];
  const r = launch(command, tmpDir('burhan-run-none-'), '{}');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('Codex: a launcher whose entry file is broken still exits 0 (fail open)', () => {
  const d = installed();
  writeFileSync(join(d, '.burhan/hooks/node/main.mjs'), 'this is not javascript (\n');
  const { command } = hooksOf(d, '.codex/hooks.json', 'SessionStart')[0];
  const r = launch(command, d, '{}');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('Codex: the project root comes from where the hooks are installed, not from the payload cwd', () => {
  const d = installed('WF_CODE_REGEX=\'\\.src$\'\n');
  const sub = join(d, 'pkg');
  mkdirSync(sub, { recursive: true });
  const post = hooksOf(d, '.codex/hooks.json', 'PostToolUse')[0].command;
  const payload = { hook_event_name: 'PostToolUse', session_id: 'S1', turn_id: 'U1', cwd: sub, tool_name: 'apply_patch', tool_use_id: 't1', tool_input: { command: '*** Begin Patch\n*** Add File: a.src\n+x\n*** End Patch\n' }, tool_response: 'Exit code: 0' };
  const r = launch(post, sub, JSON.stringify(payload));
  assert.match(message(r.stdout), /failing test written FIRST/u, 'the config at the project root applied although the payload cwd is a subdirectory');
  renameSync(join(d, '.burhan/hooks/node'), join(d, '.burhan/hooks/gone'));
  const gone = launch(post, sub, JSON.stringify(payload));
  assert.equal(gone.stdout, '', 'without the installed hooks the launcher finds nothing (negative control)');
});

test('Windows: the launcher string runs under cmd /C from a subdirectory of the project and finds the installed hooks', { skip: process.platform !== 'win32' ? 'cmd.exe exists only on Windows' : false }, () => {
  const d = installed();
  const sub = join(d, 'pkg', 'inner');
  mkdirSync(sub, { recursive: true });
  const { command } = hooksOf(d, '.codex/hooks.json', 'SessionStart')[0];
  const r = launch(command, sub, JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'S1', turn_id: 'U1', cwd: sub }));
  assert.equal(r.status, 0, r.stderr);
  assert.match(message(r.stdout), /WORKFLOW GATES/u, `the project was found from ${sub}`);
});
