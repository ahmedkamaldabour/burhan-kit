import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const isFile = (p: string): boolean => { try { return statSync(p).isFile(); } catch { return false; } };

/** The project a folder belongs to, found the way git finds its repository: the nearest folder at or above `start` that holds
 *  `.burhan/WORKFLOW.md` (an install), or null when no folder up to the filesystem root does. Only reads. A `.burhan/` folder
 *  without WORKFLOW.md is not an install (a command run in the wrong folder can leave one behind). */
export function findProject(start: string): string | null {
  for (let d = resolve(start); ; d = dirname(d)) {
    if (isFile(join(d, '.burhan', 'WORKFLOW.md'))) return d;
    if (dirname(d) === d) return null;
  }
}
