import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Io } from '../main.js';
import { BurhanError } from './errors.js';
import { realTarget } from './fs-safe.js';
import { field, given } from './items.js';
import { docsLocation } from './status.js';

// Paths unquoted (non-ASCII names stay readable), room for big repositories.
const git = (cwd: string, ...args: string[]) =>
  spawnSync('git', ['-C', cwd, '-c', 'core.quotePath=false', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const ok = (r: ReturnType<typeof git>): boolean => r.status === 0 && !r.error;

/** Files changed since the commit the story's facts were verified at (spec S-5): committed since,
 *  uncommitted, and new untracked files — the item's own docs excluded. */
export function changed(o: { target: string; item?: string; docs?: string; json: boolean }, io: Io): number {
  if (!o.item) throw new BurhanError('changed needs --item <slug>');
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(o.item) || o.item.includes('..')) throw new BurhanError(`not a work-item slug: ${o.item}`);
  const target = realTarget(o.target);
  const { rel: docsRel, abs: docs } = docsLocation(target, o.docs);
  const story = join(docs, o.item, `${o.item}-story.md`);
  if (!existsSync(story)) throw new BurhanError(`no story for ${o.item}: ${relative(target, story)}`);
  const raw = given(field(readFileSync(story, 'utf8'), 'Verified at commit'));
  const sha = raw?.replace(/`/g, ' ').split(/\s+/).find((t) => /^[0-9a-f]{7,40}$/i.test(t));
  const say = (text: string, data: object) => { io.stdout(o.json ? JSON.stringify(data) + '\n' : text + '\n'); return 0; };
  if (!sha) return say(`${o.item}: no **Verified at commit** sha in the story — re-check every fact the story relies on.`, { item: o.item, sha: null, files: null });
  const recheck = (why: string) => say(`${o.item}: ${why} — re-check every fact the story relies on.`, { item: o.item, sha, files: null });
  if (!ok(git(target, 'rev-parse', '--is-inside-work-tree'))) return recheck('not a git repository');
  // Resolve the hex as an object name, never as a ref: a tag or branch with the same name must not
  // shadow the commit. Exactly one commit must start with it.
  const ids = git(target, 'rev-parse', `--disambiguate=${sha}`);
  const commits = ok(ids) ? ids.stdout.split('\n').filter((id) => id && git(target, 'cat-file', '-t', id).stdout.trim() === 'commit') : [];
  if (commits.length !== 1)
    return say(`${o.item}: ${sha} is not ${commits.length ? 'a unique' : 'a'} commit in this repository — re-check every fact the story relies on.`, { item: o.item, sha, files: null });
  // Both lists relative to the target and limited to it (the target may sit below the repository root).
  const diff = git(target, 'diff', '--name-only', '--no-renames', '--relative', commits[0], '--', '.');
  const untracked = git(target, 'ls-files', '--others', '--exclude-standard', '--', '.');
  if (!ok(diff) || !ok(untracked)) return recheck('git could not list the changes');
  const files = [...new Set([...diff.stdout.split('\n'), ...untracked.stdout.split('\n')])]
    .filter((f) => f && !(docsRel && (f === docsRel || f.startsWith(docsRel + '/')))).sort();
  if (files.length === 0) return say(`${o.item}: no change since ${sha} — the story's code facts still hold.`, { item: o.item, sha, files });
  return say(`${o.item}: changed since ${sha} (${files.length}) — re-check only the facts about these:\n${files.map((f) => `  ${f}`).join('\n')}`, { item: o.item, sha, files });
}
