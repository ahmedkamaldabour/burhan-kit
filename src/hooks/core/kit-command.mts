/** Is the kit command found without the network? One pure answer for `setup`, `doctor` and the session-start hook.
 *  The file system, the environment and the platform are passed in, so a test needs no particular PATH and the hook needs no `src/lib`.
 *  Found = `node_modules/.bin/burhan` in the project (`burhan.cmd` or `burhan.exe` on Windows), or a runnable `burhan` in an absolute folder of PATH.
 *  An empty or relative PATH entry means the current folder and is not trusted. burhan does not run npm: this only looks. */
import { accessSync, constants, statSync } from 'node:fs';
import { posix, win32 } from 'node:path';

export interface KitProbe {
  /** a regular file (a link to one counts) */
  isFile(path: string): boolean;
  /** a regular file the person can run (on Windows: any file, the name decides) */
  isRunnable(path: string): boolean;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
}

export function realKitProbe(env: Record<string, string | undefined> = process.env, platform: NodeJS.Platform = process.platform): KitProbe {
  const isFile = (p: string): boolean => { try { return statSync(p).isFile(); } catch { return false; } };
  const isRunnable = (p: string): boolean => {
    if (!isFile(p)) return false;
    if (platform === 'win32') return true;
    try { accessSync(p, constants.X_OK); return true; } catch { return false; }
  };
  return { isFile, isRunnable, env, platform };
}

/** True when the kit command runs without the network. */
export function kitFound(project: string, p: KitProbe): boolean {
  const path = p.platform === 'win32' ? win32 : posix;
  const names = p.platform === 'win32' ? ['burhan.cmd', 'burhan.exe'] : ['burhan'];
  const has = (dir: string): boolean => names.some((n) => p.isRunnable(path.join(dir, n)));
  if (has(path.join(project, 'node_modules', '.bin'))) return true;
  const raw = p.env.PATH ?? p.env.Path ?? '';
  return raw.split(path.delimiter).some((dir) => dir !== '' && path.isAbsolute(dir) && has(dir));
}

/** The one command the person runs: the kit in the project when it has a package.json, on the PATH otherwise. `version` null: no `@` part. */
export function kitInstallCommand(hasPackageJson: boolean, version: string | null): string {
  return hasPackageJson ? `npm i -D burhan-kit${version === null ? '' : `@${version}`}` : 'npm i -g burhan-kit';
}

/** null when the kit command is found; otherwise the install command to print. */
export function kitMissing(project: string, p: KitProbe, version: string | null): string | null {
  if (kitFound(project, p)) return null;
  const path = p.platform === 'win32' ? win32 : posix;
  return kitInstallCommand(p.isFile(path.join(project, 'package.json')), version);
}
