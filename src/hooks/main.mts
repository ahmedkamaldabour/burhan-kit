/** Hook entry:  node main.mjs <part> <name> [args]   (part: core | claude | codex)
 *  core <check>: a normalized event on stdin -> {"message":"…"} or nothing (tests/CONFORMANCE.md).
 *  Fails open at every step: exit 0, and stdout is complete or empty. WF_HOOK_DEBUG=1 prints the error on stderr. */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadHookConfig } from './core/config.mjs';
import { emit, parseEvent, type Check } from './core/lib.mjs';
import { postEditReminder } from './core/post-edit-reminder.mjs';
import { preCommitCheck } from './core/pre-commit-check.mjs';
import { sessionGates } from './core/session-gates.mjs';

export type Registry = Record<string, Record<string, Check>>;
export const REGISTRY: Registry = {
  core: { 'post-edit-reminder': postEditReminder, 'pre-commit-check': preCommitCheck, 'session-gates': sessionGates },
};

export interface RunResult { stdout: string; debug: string }

export async function run(argv: string[], stdin: string, env: NodeJS.ProcessEnv, registry: Registry = REGISTRY): Promise<RunResult> {
  try {
    const [part, name] = argv;
    const check = part !== undefined && name !== undefined ? registry[part]?.[name] : undefined;
    if (!check || !Object.hasOwn(registry[part!]!, name!)) return { stdout: '', debug: '' };
    const ev = parseEvent(stdin);
    if (!ev) return { stdout: '', debug: '' };
    const pd = ev.raw.project_dir;
    let project = typeof pd === 'string' && pd !== '' ? pd : process.cwd();
    if (project !== '/' && project.endsWith('/')) project = project.slice(0, -1);
    const findings = await check({ ev, cfg: loadHookConfig(project, env), project, env });
    return { stdout: emit(findings), debug: '' };
  } catch (e) {
    return { stdout: '', debug: e instanceof Error ? (e.stack ?? e.message) : String(e) };
  }
}

function readStdin(): string {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

const isEntry = (() => {
  try { return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();

if (isEntry) {
  process.on('uncaughtException', () => process.exit(0));
  process.on('unhandledRejection', () => process.exit(0));
  run(process.argv.slice(2), readStdin(), process.env).then((r) => {
    if (r.debug && process.env.WF_HOOK_DEBUG === '1') process.stderr.write(r.debug + '\n');
    process.stdout.write(r.stdout, () => process.exit(0));
  }, () => process.exit(0));
}
