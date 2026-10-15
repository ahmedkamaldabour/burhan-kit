/** Runs WF_CHECK_CMD for the pre-commit check, the way `timeout -k 2 N bash -c "$WF_CHECK_CMD"` does in the
 *  bash kit: in the project directory, under the hook's environment unchanged, output to a file (a
 *  background child that keeps stdout open must not make the hook wait), stopped at the timeout (TERM to
 *  the process group, KILL 2 s later; on Windows the process tree is killed). */
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readSync, rmSync, statSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { basename, delimiter, join } from 'node:path';

export interface CheckResult { kind: 'pass' | 'fail' | 'timeout'; code: number | null; output: string }

const OUTPUT_BYTES = 4000;
const KILL_AFTER_MS = 2000;
const MAX_TIMER_MS = 2 ** 31 - 1; // setTimeout's limit; a longer timeout would fire after 1 ms

/** D4: bash when one is on PATH (on Windows: Git Bash, never WSL's System32 launcher), else sh / cmd.exe. */
export function checkShell(platform: string, bashes: string[]): [string, string[]] {
  const ok = platform === 'win32' ? bashes.filter((b) => !/\\windows\\system32\\/i.test(b)) : bashes;
  if (ok.length) return [ok[0], ['-c']];
  return platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c']] : ['sh', ['-c']];
}

/** Every `bash` on PATH, in PATH order. */
export function bashesOnPath(env: NodeJS.ProcessEnv): string[] {
  const names = process.platform === 'win32' ? ['bash.exe'] : ['bash'];
  const out: string[] = [];
  for (const d of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (!d) continue;
    for (const n of names) {
      const p = join(d, n);
      try { if (statSync(p).isFile()) out.push(p); } catch { /* not here */ }
    }
  }
  return out;
}

function head(file: string, n: number): string {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(n);
    const got = readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, got).toString('utf8');
  } finally { closeSync(fd); }
}

export async function runCheck(cmd: string, cwd: string, timeoutSec: number, env: NodeJS.ProcessEnv): Promise<CheckResult> {
  // `(cd "$WF_PROJECT" && …)` fails with status 1 and no output.
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) return { kind: 'fail', code: 1, output: '' };
  const tmp = mkdtempSync(join(tmpdir(), 'burhan-check-'));
  const outFile = join(tmp, 'out');
  const fd = openSync(outFile, 'w');
  const [shell, flags] = checkShell(process.platform, bashesOnPath(env));
  const win = process.platform === 'win32';
  try {
    const code = await new Promise<number>((resolve) => {
      let timedOut = false;
      let child;
      try {
        child = spawn(shell, [...flags, cmd], { argv0: basename(shell).replace(/\.exe$/i, ''), cwd, env, stdio: ['ignore', fd, fd], detached: !win, windowsHide: true, windowsVerbatimArguments: shell === 'cmd.exe' });
      } catch { resolve(127); return; }
      const kill = (sig: NodeJS.Signals): void => {
        try {
          if (win) spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true });
          else process.kill(-child.pid!, sig);
        } catch { /* already gone */ }
      };
      let hard: NodeJS.Timeout | undefined;
      // GNU timeout: 0 means no limit.
      const soft = timeoutSec > 0
        ? setTimeout(() => { timedOut = true; kill('SIGTERM'); hard = setTimeout(() => kill('SIGKILL'), KILL_AFTER_MS); }, Math.min(timeoutSec * 1000, MAX_TIMER_MS))
        : undefined;
      child.on('error', () => { if (soft) clearTimeout(soft); if (hard) clearTimeout(hard); resolve(127); });
      child.on('exit', (c, sig) => {
        if (soft) clearTimeout(soft); if (hard) clearTimeout(hard);
        if (timedOut) resolve(124);
        else resolve(c ?? 128 + ((sig && constants.signals[sig]) || 0));
      });
    });
    closeSync(fd);
    const output = head(outFile, OUTPUT_BYTES);
    if (code === 0) return { kind: 'pass', code, output };
    if (code === 124 || code === 137) return { kind: 'timeout', code, output };
    return { kind: 'fail', code, output };
  } finally {
    try { closeSync(fd); } catch { /* closed */ }
    rmSync(tmp, { recursive: true, force: true });
  }
}
