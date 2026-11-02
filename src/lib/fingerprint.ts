import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { FILE_CAP, listProjectFiles } from './project-files.js';

/** The code state a proof ran on. `value` is `fp1:` and a sha256 over the sorted lines `<path>\0<entry>` of every file git lists (tracked, plus untracked and not
 *  ignored) except `exclude`; the entry is the sha256 of the file's bytes as they are on disk, a link's text, or `deleted` for a tracked file that is gone. The same
 *  content gives the same value whatever the commit, and nothing is written to `.git`. `value` is null, with `why`, when no file list can be read. */
export interface CodeState { value: string | null; files: number; why?: string }

/** `exclude` holds paths relative to the project with `/` separators: a folder (everything under it) or a file. */
export function codeState(project: string, exclude: string[]): CodeState {
  const listed = listProjectFiles(project);
  if (listed === null) return { value: null, files: 0, why: `no file list: not a git checkout, git is missing, or more than ${FILE_CAP} files` };
  const skip = (f: string): boolean => exclude.some((e) => e !== '' && (f === e || f.startsWith(`${e}/`)));
  const files = listed.filter((f) => !skip(f)).sort();
  const all = createHash('sha256');
  for (const f of files) {
    const abs = join(project, f);
    let entry: string;
    try {
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) entry = `link ${readlinkSync(abs)}`;
      else if (st.isFile()) entry = `file ${createHash('sha256').update(readFileSync(abs)).digest('hex')}`;
      else entry = 'other';
    } catch {
      entry = 'deleted';
    }
    all.update(`${f}\0${entry}\n`);
  }
  return { value: `fp1:${all.digest('hex')}`, files: files.length };
}
