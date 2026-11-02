import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { win32 } from 'node:path';
import { BurhanError } from './errors.js';

/** What to start: the program, its arguments, and whether Node must hand them to Windows exactly as written. */
export interface Launch { file: string; args: string[]; verbatim: boolean }
/** How a run ended: `ok` (exit 0), `failed` (another exit code, or a signal), `not-started` (the program could not start). */
export interface RunResult { exit: number | null; status: 'ok' | 'failed' | 'not-started'; why?: string }

type Env = Record<string, string | undefined>;

/** An environment variable by name in any case: Windows names are not case-sensitive, a copied environment object is. */
const envValue = (env: Env, name: string): string | undefined => {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
};
const isFileAt = (p: string): boolean => { try { return statSync(p).isFile(); } catch { return false; } };

/** cmd.exe reads these itself, even inside quotes, or ends the argument at them: an argument holding one is refused, never escaped. */
const CMD_UNSAFE = /[&|<>^%"()!\r\n]/;

/** The program to start for `argv`, without a shell. On Linux and macOS: the argument array as given. On Windows a bare name is looked up on PATH with PATHEXT
 *  (Node does not try `.cmd` itself), and a `.cmd` or `.bat` file is started through `cmd.exe /d /s /c` with every part quoted, because Node refuses to start one
 *  without a shell (CVE-2024-27980); an argument cmd.exe would read is refused. A name that is not found is returned as given: the start then fails and is recorded. */
export function launchFor(argv: string[], o: { platform: NodeJS.Platform; env: Env; cwd: string; isFile?: (p: string) => boolean }): Launch {
  const [cmd, ...args] = argv;
  if (cmd === undefined || cmd === '') throw new BurhanError('verify needs a command after --');
  if (o.platform !== 'win32') return { file: cmd, args, verbatim: false };
  const isFile = o.isFile ?? isFileAt;
  const exts = (envValue(o.env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((e) => e !== '').map((e) => e.toLowerCase());
  const named = (base: string): string | undefined => (exts.includes(win32.extname(base).toLowerCase()) && isFile(base) ? base : exts.map((e) => base + e).find(isFile));
  let found: string | undefined;
  if (/[\\/]/.test(cmd)) found = named(win32.resolve(o.cwd, cmd));
  else {
    for (const dir of (envValue(o.env, 'PATH') ?? '').split(';').filter((d) => d !== '')) {
      found = named(win32.join(dir, cmd));
      if (found !== undefined) break;
    }
  }
  if (found === undefined) return { file: cmd, args, verbatim: false };
  const ext = win32.extname(found).toLowerCase();
  if (ext !== '.cmd' && ext !== '.bat') return { file: found, args, verbatim: false };
  const bad = args.find((a) => CMD_UNSAFE.test(a));
  if (bad !== undefined) throw new BurhanError(`verify refuses the argument ${JSON.stringify(bad)}: ${win32.basename(found)} runs through cmd.exe, which reads & | < > ^ % " ( ) ! and line breaks itself; run the program it calls directly`);
  if (/["%!\r\n]/.test(found)) throw new BurhanError(`verify refuses the path ${JSON.stringify(found)}: cmd.exe reads " % ! in it`);
  const line = [found, ...args].map((p) => `"${p}"`).join(' ');
  return { file: envValue(o.env, 'COMSPEC') ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
}

/** Starts `launch` in `cwd` with its output on this terminal, and says how it ended. */
export function runLaunch(launch: Launch, cwd: string, env?: Env): RunResult {
  const r = spawnSync(launch.file, launch.args, { cwd, stdio: 'inherit', shell: false, windowsVerbatimArguments: launch.verbatim, ...(env !== undefined ? { env: env as NodeJS.ProcessEnv } : {}) });
  if (r.error !== undefined) return { exit: null, status: 'not-started', why: (r.error as NodeJS.ErrnoException).code ?? r.error.message };
  if (r.status === null) return { exit: null, status: 'failed', why: `ended by ${r.signal ?? 'a signal'}` };
  return { exit: r.status, status: r.status === 0 ? 'ok' : 'failed' };
}
