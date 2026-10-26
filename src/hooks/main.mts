/** Hook entry:  node main.mjs <part> <name> [args]   (part: core | claude | codex)
 *  core <check>: a normalized event on stdin -> {"message":"…"} or nothing (the black-box suites, tests/impl.sh).
 *  claude|codex normalize | emit <event> | hook <check> (codex also: hook record).
 *  Fails open at every step: exit 0, and stdout is complete or empty. WF_HOOK_DEBUG=1 prints the error on stderr. */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadHookConfig } from './core/config.mjs';
import { emit, parseEvent, type Check } from './core/lib.mjs';
import { preEditSkill } from './core/pre-edit-skill.mjs';
import { postEditReminder } from './core/post-edit-reminder.mjs';
import { preShell } from './core/pre-shell.mjs';
import { sessionGates } from './core/session-gates.mjs';
import { promptRouter } from './core/prompt-router.mjs';
import { turnAudit } from './core/turn-audit.mjs';
import { emitClaude } from './adapters/claude/emit.mjs';
import { hookClaude } from './adapters/claude/hook.mjs';
import { installRoot } from './install-root.mjs';
import { normalizeClaude } from './adapters/claude/normalize.mjs';
import { emitCodex } from './adapters/codex/emit.mjs';
import { hookCodex } from './adapters/codex/hook.mjs';
import { normalizeCodex } from './adapters/codex/normalize.mjs';

export type Registry = Record<string, Record<string, Check>>;
export const REGISTRY: Registry = {
  core: { 'post-edit-reminder': postEditReminder, 'pre-edit-skill': preEditSkill, 'pre-commit-check': preShell, 'session-gates': sessionGates, 'prompt-router': promptRouter, 'turn-audit': turnAudit },
};

export interface RunResult { stdout: string; debug: string }

type CoreRunner = (check: string, stdin: string, env: NodeJS.ProcessEnv) => Promise<string>;
/** An agent adapter: payload -> normalized event(s), core output -> agent output, and the whole chain (`hook`). */
interface Adapter {
  normalize(stdin: string, env: NodeJS.ProcessEnv): string;
  emit(event: string, stdin: string): string;
  hook(check: string | undefined, stdin: string, env: NodeJS.ProcessEnv, runCore: CoreRunner, hasCheck: (name: string) => boolean, root: string): Promise<string>;
}
const ADAPTERS: Record<string, Adapter> = {
  claude: { normalize: normalizeClaude, emit: emitClaude, hook: (check, stdin, env, runCore) => hookClaude(check, stdin, env, runCore) },
  codex: { normalize: normalizeCodex, emit: emitCodex, hook: hookCodex },
};

async function runCore(checkName: string | undefined, stdin: string, env: NodeJS.ProcessEnv, registry: Registry): Promise<string> {
  const core = registry.core;
  const check = checkName === undefined ? undefined : core?.[checkName];
  if (!core || !check || checkName === undefined || !Object.hasOwn(core, checkName)) return '';
  const ev = parseEvent(stdin);
  if (!ev) return '';
  const pd = ev.raw.project_dir;
  let project = typeof pd === 'string' && pd !== '' ? pd : process.cwd();
  if (project !== '/' && project.endsWith('/')) project = project.slice(0, -1);
  return emit(await check({ ev, cfg: loadHookConfig(project, env), project, env }));
}

/** `entryFile` is where this hook is installed (the project root is derived from it, as hook.sh does); tests pass their own. */
export async function run(argv: string[], stdin: string, env: NodeJS.ProcessEnv, registry: Registry = REGISTRY, entryFile: string = fileURLToPath(import.meta.url)): Promise<RunResult> {
  try {
    const [part, name, argument] = argv;
    if (part === 'core') return { stdout: await runCore(name, stdin, env, registry), debug: '' };
    const adapter = part !== undefined && Object.hasOwn(ADAPTERS, part) ? ADAPTERS[part] : undefined;
    if (!adapter) return { stdout: '', debug: '' };
    if (name === 'normalize') return { stdout: adapter.normalize(stdin, env), debug: '' };
    if (name === 'emit') return { stdout: adapter.emit(argument ?? '', stdin), debug: '' };
    if (name === 'hook') {
      const hasCheck = (check: string): boolean => registry.core !== undefined && Object.hasOwn(registry.core, check);
      return { stdout: await adapter.hook(argument, stdin, env, (check, input, callEnv) => runCore(check, input, callEnv, registry), hasCheck, installRoot(entryFile)), debug: '' };
    }
    return { stdout: '', debug: '' };
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
