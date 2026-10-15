import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/hooks/main.mjs';

/** One hook call: returns stdout. `label` names the implementation in failure messages. */
export type Driver = ((argv: string[], stdin: string, env: NodeJS.ProcessEnv) => Promise<string>) & { label: 'node' | 'bash' };

/** The Node hooks, in process. A swallowed error (fail open) is a bug in a corpus run, so it fails the case. */
export const nodeDriver: Driver = Object.assign(async (argv: string[], stdin: string, env: NodeJS.ProcessEnv) => {
  const result = await run(argv, stdin, env);
  if (result.debug !== '') throw new Error(`the Node hook swallowed an error: ${result.debug.split('\n')[0]}`);
  return result.stdout;
}, { label: 'node' as const });

const hooks = new URL('../../../kit/hooks/', import.meta.url);
const CHILD_TIMEOUT_MS = 120_000;

function scriptFor(argv: string[]): { script: string; args: string[] } | null {
  const [agent, name, ...args] = argv;
  if (agent === 'core' && name !== undefined) return { script: fileURLToPath(new URL(`core/${name}.sh`, hooks)), args };
  if ((agent === 'claude' || agent === 'codex') && (name === 'normalize' || name === 'emit' || name === 'hook')) {
    return { script: fileURLToPath(new URL(`adapters/${agent}/${name}.sh`, hooks)), args };
  }
  return null;
}

/** The bash hooks, spawned as the agents spawn them. They fail open (exit 0), so a non-zero exit or a signal is a crash. */
export const bashDriver: Driver = Object.assign((argv: string[], stdin: string, env: NodeJS.ProcessEnv) => new Promise<string>((resolve, reject) => {
  const target = scriptFor(argv);
  if (target === null) return reject(new Error(`no bash hook for ${argv.join(' ')}`));
  let stdout = '';
  let stderr = '';
  const child = spawn('bash', [target.script, ...target.args], {
    env: { ...process.env, LC_ALL: process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: CHILD_TIMEOUT_MS,
  });
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  child.once('error', reject);
  child.once('close', (code, signal) => {
    if (code === 0) resolve(stdout);
    else reject(new Error(`bash hook ${argv.join(' ')} ${signal ? `was killed by ${signal}` : `exited ${code}`}: ${stderr.split('\n')[0]}`));
  });
  child.stdin.once('error', () => { /* the script may exit without reading its input */ });
  child.stdin.end(stdin);
}), { label: 'bash' as const });

/** The differential needs a real bash and jq; Windows (paths, Git Bash) is covered by its own CI job. */
export function bashAvailable(): { ok: boolean; reason: string } {
  if (process.platform === 'win32') return { ok: false, reason: 'skipped on Windows (the bash hooks are not exercised there)' };
  const available = (command: string): boolean => {
    const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
    return result.status === 0 && result.error === undefined;
  };
  const bash = available('bash');
  const jq = available('jq');
  return bash && jq ? { ok: true, reason: '' } : { ok: false, reason: `${[!bash && 'bash', !jq && 'jq'].filter(Boolean).join(' and ')} is unavailable` };
}

/** GNU `cut -c` counts bytes (the bash hooks cut a multibyte sub-unit line mid-character); uutils and BSD cut count
 *  characters. The Node hooks always count code points (decision Q-3), so a bash-vs-golden case about a multibyte
 *  cut only holds where `cut` counts characters. */
export const cutCountsCharacters: boolean = (() => {
  const r = spawnSync('cut', ['-c1'], { input: 'é' });
  return r.status === 0 && r.stdout.length === 3; // 'é' (2 bytes) + newline
})();
