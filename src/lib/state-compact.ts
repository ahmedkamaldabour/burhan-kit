import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join, relative } from 'node:path';
import type { Io } from '../main.js';
import { formatClosedLine, isOutcome, parseClosedLine } from '../hooks/core/state-lines.mjs';
import type { Outcome } from '../hooks/core/state-lines.mjs';
import { readProjectConfig } from './config.js';
import { BurhanError } from './errors.js';
import { putFile, realTarget } from './fs-safe.js';
import { editStateFile, ReplaceFailed, writeFileAtomic } from './state-write.js';
import { assertInside, today } from './item-io.js';
import { itemSlugs, readItem } from './items.js';
import { docsLocation } from './status.js';

const OLD_LINE = 200; // a Commit-instructions / Waiting-on-you line this long or shorter is left as it is
const KEEP = 160;     // characters of an old line kept before the pointer
const MAX_FILE = 5 * 1024 * 1024;

interface Closed { route: string; outcome: Outcome; dir: string; rel: string }
interface Change { section: string; slug: string; old: string; neu: string; notes: boolean; why: string; note?: string }

const words = (s: string): number => s.split(/\s+/).filter((w) => w !== '').length;
const norm = (p: string): string => p.split('\\').join('/');

/** True when `text` is already written in some .md file of the item folder (plain files only, bounded size). */
function inFolder(dir: string, text: string): boolean {
  let names: Dirent[] = [];
  try { names = readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of names) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (inFolder(p, text)) return true; continue; }
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    try { if (statSync(p).size <= MAX_FILE && readFileSync(p, 'utf8').includes(text)) return true; } catch { /* unreadable: not a copy */ }
  }
  return false;
}

/** Whether a token is a commit of the project: git answers true or false inside a git work tree (one call per token, remembered);
 *  outside one it answers null and the shape rule decides. The token is 7-40 hex characters, so it is never read as an option. */
type IsCommit = (id: string) => boolean | null;
function gitIsCommit(project: string): IsCommit {
  const tree = spawnSync('git', ['-C', project, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (tree.error !== undefined || tree.status !== 0 || tree.stdout.trim() !== 'true') return () => null;
  const seen = new Map<string, boolean>();
  return (id) => {
    let known = seen.get(id);
    if (known === undefined) {
      const r = spawnSync('git', ['-C', project, 'rev-parse', '--verify', '--quiet', `${id}^{commit}`], { encoding: 'utf8' });
      known = r.error === undefined && r.status === 0;
      seen.set(id, known);
    }
    return known;
  };
}

/** The commit id of a line: the last hex token of 7-40 characters that git knows as a commit; with no git, the last such token that has a digit and a letter. Else null. */
function commitOf(line: string, isCommit: IsCommit): string | null {
  let found: string | null = null;
  for (const m of line.matchAll(/\b[0-9a-f]{7,40}\b/g)) {
    const known = isCommit(m[0]);
    if (known === true || (known === null && /\d/.test(m[0]) && /[a-f]/.test(m[0]))) found = m[0];
  }
  return found;
}

/** Whether git ignores a path of the project: true or false in a git work tree, null outside one or when git cannot answer. */
function gitIgnores(project: string, path: string): boolean | null {
  const r = spawnSync('git', ['-C', project, 'check-ignore', '-q', '--', norm(relative(project, path))], { encoding: 'utf8' });
  return r.error !== undefined || (r.status !== 0 && r.status !== 1) ? null : r.status === 0;
}

/** The item slugs a line names: each run of letters, digits, `_`, `.` and `-` (a trailing dot dropped) that is a known slug. A slug that is one
 *  plain word (`release`, `docs`) counts only where the bullet starts with it, in backticks or after a "/" (a path), so an ordinary word is not
 *  taken for an item. One pass over the line. */
function namedSlugs(line: string, slugs: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const m of line.matchAll(/[\w.-]+/g)) {
    const t = m[0].replace(/\.+$/, '');
    if (!slugs.has(t)) continue;
    const at = m.index ?? 0;
    const before = line[at - 1] ?? '';
    const after = line[at + t.length] ?? '';
    if (/^[A-Za-z]+$/.test(t) && !/^- \**$/.test(line.slice(0, at)) && !(before === '`' && after === '`') && before !== '/') continue;
    out.add(t);
  }
  return [...out].sort();
}

/** `burhan state compact [--apply]`: shortens the closed items' old lines in the state file. A dry run unless --apply; never touches a "### " block. */
export function stateCompact(target: string, io: Io, o: { apply?: boolean; docs?: string } = {}): number {
  const project = realTarget(target);
  const docs = docsLocation(project, o.docs);
  const stateRel = readProjectConfig(project).values.WF_STATE_FILE || '.burhan/local/PROGRESS.md';
  const statePath = join(project, stateRel);
  if (!existsSync(statePath) || !statSync(statePath).isFile()) throw new BurhanError(`there is no state file at ${stateRel}`);
  assertInside(project, statePath);
  const raw = readFileSync(statePath);
  const text = raw.toString('utf8');

  // Every item folder: closed (an index outcome and a route that can be read) or open, with the reason it is not closed.
  const closed = new Map<string, Closed>();
  const open = new Map<string, string>();
  if (existsSync(docs.abs)) {
    for (const slug of itemSlugs(docs.abs)) {
      const dir = join(docs.abs, slug);
      const item = readItem(dir, slug, project);
      if (isOutcome(item.state) && item.typeScope !== '—') closed.set(slug, { route: item.typeScope, outcome: item.state, dir, rel: norm(relative(project, dir)) });
      else open.set(slug, item.typeScope === '—' ? 'its route cannot be read, so its closed line cannot be written' : `not closed (${item.state})`);
    }
  }
  const isCommit = gitIsCommit(project);

  const parts = text.split(/(\r?\n)/); // the lines and, between them, each line's own ending: a changed line keeps its ending
  const lines = parts.filter((_, i) => i % 2 === 0);
  const ends = parts.filter((_, i) => i % 2 === 1);
  // A "### " block is an item in flight even with no folder: a line that also names it is never cut into another item's notes.
  for (const l of lines) { const h = /^### +(\S+)/.exec(l)?.[1]; if (h !== undefined && !closed.has(h) && !open.has(h)) open.set(h, 'in flight (a ### block)'); }
  const slugs = new Set([...closed.keys(), ...open.keys()]);
  const docsRel = norm(relative(project, docs.abs));
  const changes: Change[] = [];
  const kept: string[] = [];
  let section = '';
  let inBlock = false;
  const out = lines.map((line) => {
    if (/^## /.test(line)) { section = line.slice(3).trim(); inBlock = false; return line; }
    if (/^### /.test(line)) {
      inBlock = true;
      const s = line.slice(4).trim();
      const c = closed.get(s);
      if (c !== undefined) kept.push(`### ${s}: the item is closed (${c.outcome}) but its block is still in Now; state compact never touches a ### block: the session that owns it shrinks it to one line at close-out (phases/close-out.md)`);
      return line;
    }
    if (inBlock || !line.startsWith('- ') || !['Now', 'Commit instructions', 'Waiting on you'].includes(section)) return line;
    if (parseClosedLine(line) !== null) return line;
    if (section === 'Now') {
      if (/^- \*\*[^*]*:\*\*/.test(line)) return line; // a field such as **Branch:**, not an item
      const lead = /^- \**([A-Za-z0-9][A-Za-z0-9._-]*)\**(?=[\s:(·]|$)/.exec(line);
      const slug = lead?.[1];
      if (lead === null || slug === undefined) return line;
      const c = closed.get(slug);
      if (c === undefined) {
        const why = open.get(slug);
        if (why !== undefined) kept.push(`${slug}: ${why}`);
        else if (/^ ?[·:]/.test(line.slice(lead[0].length))) kept.push(`${slug}: no folder under ${docsRel}`); // written like an item line; plain text is not reported
        return line;
      }
      const commit = commitOf(line, isCommit);
      const neu = formatClosedLine({ slug, route: c.route, outcome: c.outcome, commit: commit ?? 'uncommitted', folder: c.rel });
      changes.push({ section, slug, old: line, neu, notes: true, why: 'closed item', ...(commit === null ? { note: 'no commit id was read from the old line: check "uncommitted" before --apply' } : {}) });
      return neu;
    }
    if (line.length <= OLD_LINE) return line;
    if (line.endsWith('-state-notes.md)') && line.includes('… (full text: ')) return line; // already shortened: a second run changes nothing
    const named = namedSlugs(line, slugs);
    const hits = named.filter((s) => closed.has(s));
    if (hits.length === 0) return line;
    if (named.length > 1) { kept.push(`[${section}] a line naming ${named.join(', ')}: it is about more than one item`); return line; }
    const slug = hits[0]!;
    const cut = line.slice(0, KEEP);
    const sp = cut.lastIndexOf(' ');
    const neu = `${(sp > 40 ? cut.slice(0, sp) : cut).trimEnd()}… (full text: ${closed.get(slug)!.rel}/${slug}-state-notes.md)`;
    changes.push({ section, slug, old: line, neu, notes: true, why: 'old line naming a closed item' });
    return neu;
  });

  const oldWords = changes.reduce((n, c) => n + words(c.old), 0);
  const newWords = changes.reduce((n, c) => n + words(c.neu), 0);
  io.stdout(`state compact: ${o.apply ? 'applying' : 'dry run (nothing is written; add --apply to write)'}\n`);
  for (const c of changes) io.stdout(`[${c.section}] ${c.why}: ${c.slug}\n  - ${c.old.slice(0, 240)}${c.old.length > 240 ? '…' : ''}\n  + ${c.neu}\n  words: ${words(c.old)} → ${words(c.neu)}\n${c.note === undefined ? '' : `  note: ${c.note}\n`}`);
  for (const k of kept) io.stdout(`left as it is: ${k}\n`);
  if (changes.length === 0) { io.stdout('state compact: nothing to compact\n'); return 0; }
  const saved = oldWords - newWords;
  io.stdout(`${changes.length} line(s), ${oldWords} → ${newWords} words (${saved >= 0 ? `saves ${saved}` : `adds ${-saved}: the fixed shape is longer than these lines`})\n`);
  if (o.apply !== true) return 0;

  // Nothing is written until every path is known to be safe: a refusal here leaves every file as it was.
  if (!Buffer.from(text, 'utf8').equals(raw)) throw new BurhanError(`${stateRel} is not valid UTF-8: nothing was written (fix the file, then run the command again)`);
  const bak = statePath + '.bak';
  const notesPath = (slug: string): string => join(closed.get(slug)!.dir, `${slug}-state-notes.md`);
  for (const p of [...new Set(changes.map((c) => notesPath(c.slug))), bak]) {
    assertInside(project, p);
    if (existsSync(p) && !statSync(p).isFile()) throw new BurhanError(`${norm(relative(project, p))} is not a file (a folder?): nothing was written`);
  }
  const put = (p: string, data: string | Buffer, after: string): void => {
    try { putFile(p, data); } catch (e) { throw new BurhanError(`cannot write ${norm(relative(project, p))}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}; ${after}`); }
  };

  // Notes first (nothing is lost if a later write fails), then the backup, then the state file; the file is re-read so a change made meanwhile is never overwritten.
  for (const c of changes) {
    const info = closed.get(c.slug)!;
    const body = c.old.replace(/^- /, '');
    if (inFolder(info.dir, body)) { io.stdout(`notes: ${c.slug}: the text is already in ${info.rel}, not copied again\n`); continue; }
    const notes = notesPath(c.slug);
    const prior = existsSync(notes) ? readFileSync(notes, 'utf8') : `# ${c.slug} — state notes\nThe full text of lines \`burhan state compact\` shortened in the state file. Not a status file.\n`;
    put(notes, `${prior.endsWith('\n') ? prior : prior + '\n'}\n## ${today()} — from "${c.section}"\n${body}\n`, 'the state file is unchanged');
    io.stdout(`notes: ${c.slug}: the old text is in ${info.rel}/${c.slug}-state-notes.md\n`);
  }
  const replacing = existsSync(bak);
  const next = out.map((l, i) => l + (ends[i] ?? '')).join('');
  try {
    editStateFile(statePath, (current) => {
      if (current !== text) throw new BurhanError('the state file changed while compacting: nothing was written to it; run the command again');
      try { writeFileAtomic(bak, raw); } catch (e) { throw new BurhanError(`cannot write ${norm(relative(project, bak))}: ${(e as ReplaceFailed).code ?? (e as Error).message}; the state file is unchanged`); }
      return next;
    }, { label: stateRel });
  } catch (e) {
    if (e instanceof ReplaceFailed) throw new BurhanError(`cannot write ${norm(relative(project, statePath))}: ${e.code}; the old file is in ${stateRel}.bak`);
    throw e;
  }
  io.stdout(`written: ${stateRel} (backup: ${stateRel}.bak${replacing ? ', replacing the earlier backup' : ''}); ${lines.length} → ${out.length} lines\n`);
  if (gitIgnores(project, bak) === false) io.stdout(`note: ${stateRel}.bak is not ignored by git: do not commit it (add it to .gitignore)\n`);
  return 0;
}
