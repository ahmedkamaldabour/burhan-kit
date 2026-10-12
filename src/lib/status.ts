import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Io } from '../main.js';
import { readProjectConfig } from './config.js';
import { BurhanError } from './errors.js';
import { putFile, realTarget } from './fs-safe.js';
import { GENERATED_MARK, listItems, renderIndex } from './items.js';

/** Where the work items live: --docs, else WF_DOCS_DIR (team + local config), else AI_SPEC/docs.
 *  Relative paths are taken from the project; the result must stay inside it. */
export function docsLocation(target: string, override?: string): { rel: string; abs: string } {
  const abs = resolve(target, override ?? readProjectConfig(target).values.WF_DOCS_DIR ?? 'AI_SPEC/docs');
  // Compare physical paths: a symlinked folder must not lead a --write outside the project.
  let probe = abs;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  const real = join(realTarget(probe), relative(probe, abs));
  const root = realTarget(target);
  if (real !== root && !real.startsWith(root + sep)) throw new BurhanError(`the docs location must be inside the project: ${override ?? abs}`);
  if (existsSync(abs) && !statSync(abs).isDirectory()) throw new BurhanError(`the docs location is not a directory: ${override ?? abs}`);
  return { rel: relative(target, abs) || '.', abs };
}

export function status(o: { target: string; write: boolean; force: boolean; docs?: string }, io: Io): number {
  const target = realTarget(o.target);
  const { rel: docsRel, abs: docs } = docsLocation(target, o.docs);
  if (!existsSync(docs)) { io.stdout(`no work items under ${docsRel}/\n`); return 0; }
  const text = renderIndex(listItems(docs, target));
  if (!o.write) { io.stdout(text); return 0; }
  const dest = join(docs, 'README.md');
  if (existsSync(dest) && !readFileSync(dest, 'utf8').includes(GENERATED_MARK)) {
    if (!o.force) throw new BurhanError(`${docsRel}/README.md is hand-written — move it, or re-run with --force (a backup is kept)`);
    copyFileSync(dest, dest + '.burhan-backup');
    io.stdout(`  saved the hand-written index to ${docsRel}/README.md.burhan-backup\n`);
  }
  putFile(dest, text);
  io.stdout(`  index → ${docsRel}/README.md\n`);
  return 0;
}
