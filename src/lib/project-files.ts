import { spawnSync } from 'node:child_process';
import { ere } from '../hooks/core/ere.mjs';

/** More files than this and the count is skipped: a count nobody can wait for is worth less than none. */
export const FILE_CAP = 50_000;

/** The files git knows in the project (tracked, plus untracked and not ignored), with `/` separators; null when this is not a git checkout, git is missing or the list is over FILE_CAP. */
export function listProjectFiles(project: string): string[] | null {
  const r = spawnSync('git', ['-C', project, '-c', 'core.quotePath=false', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error !== undefined || r.status !== 0) return null;
  const files = r.stdout.split('\0').filter((f) => f !== '');
  return files.length > FILE_CAP ? null : files;
}

/** How many of `files` the pattern matches; null when the engine refuses the pattern. */
export function countMatches(pattern: string, files: string[]): number | null {
  const matcher = ere(pattern);
  return matcher === null ? null : files.filter((f) => matcher.test(f)).length;
}

/** One line per key that has a value: how many files its pattern matches, and a zero says to check it. */
export function matchLines(files: string[], entries: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === '') continue;
    const n = countMatches(value, files);
    if (n === null) continue;
    out.push(n === 0 ? `  ${key} matches no file in the project — check it (burhan doctor says why)` : `  ${key} matches ${n} file${n === 1 ? '' : 's'}`);
  }
  return out;
}
