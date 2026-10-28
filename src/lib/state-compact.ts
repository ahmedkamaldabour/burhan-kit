import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join, relative } from 'node:path';
import type { Io } from '../main.js';
import { formatClosedLine, parseClosedLine } from '../hooks/core/state-lines.mjs';
import { readProjectConfig } from './config.js';
import { BurhanError } from './errors.js';
import { putFile, realTarget } from './fs-safe.js';
import { assertInside, today } from './item-io.js';
import { itemSlugs, readItem } from './items.js';
import { docsLocation } from './status.js';

const CLOSED_STATES = ['QC PASS', 'Done (no QC)', 'Paused', 'Superseded'];
const OLD_LINE = 200; // a Commit-instructions / Waiting-on-you line this long or shorter is left as it is
const KEEP = 160;     // characters of an old line kept before the pointer
const MAX_FILE = 5 * 1024 * 1024;

interface Closed { route: string; outcome: string; dir: string; rel: string }
interface Change { section: string; slug: string; old: string; neu: string; notes: boolean; why: string }

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

/** The last hex token of 7-40 characters that has a digit and a letter (a commit id), else null. One pass over the tokens. */
function commitOf(line: string): string | null {
  let found: string | null = null;
  for (const m of line.matchAll(/\b[0-9a-f]{7,40}\b/g)) if (/\d/.test(m[0]) && /[a-f]/.test(m[0])) found = m[0];
  return found;
}

/** `burhan state compact [--apply]`: shortens the closed items' old lines in the state file. A dry run unless --apply; never touches a "### " block. */
export function stateCompact(target: string, io: Io, o: { apply?: boolean; docs?: string } = {}): number {
  const project = realTarget(target);
  const docs = docsLocation(project, o.docs);
  const stateRel = readProjectConfig(project).values.WF_STATE_FILE || '.burhan/local/PROGRESS.md';
  const statePath = join(project, stateRel);
  if (!existsSync(statePath) || !statSync(statePath).isFile()) throw new BurhanError(`there is no state file at ${stateRel}`);
  assertInside(project, statePath);
  const text = readFileSync(statePath, 'utf8');

  const closed = new Map<string, Closed>();
  if (existsSync(docs.abs)) {
    for (const slug of itemSlugs(docs.abs)) {
      const dir = join(docs.abs, slug);
      const item = readItem(dir, slug, project);
      if (CLOSED_STATES.includes(item.state) && item.typeScope !== '—') closed.set(slug, { route: item.typeScope, outcome: item.state, dir, rel: norm(relative(project, dir)) });
    }
  }

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const changes: Change[] = [];
  const kept: string[] = [];
  let section = '';
  let inBlock = false;
  const out = lines.map((line) => {
    if (/^## /.test(line)) { section = line.slice(3).trim(); inBlock = false; return line; }
    if (/^### /.test(line)) { inBlock = true; return line; }
    if (inBlock || !line.startsWith('- ') || !['Now', 'Commit instructions', 'Waiting on you'].includes(section)) return line;
    if (parseClosedLine(line) !== null) return line;
    if (section === 'Now') {
      const lead = /^- \**([A-Za-z0-9][A-Za-z0-9._-]*)\**(?=[\s:(·]|$)/.exec(line);
      const slug = lead?.[1];
      if (slug === undefined) return line;
      const c = closed.get(slug);
      if (c === undefined) { if (existsSync(join(docs.abs, slug))) return line; kept.push(`${slug}: no folder under ${norm(relative(project, docs.abs))}, left as it is`); return line; }
      const neu = formatClosedLine({ slug, route: c.route, outcome: c.outcome, commit: commitOf(line) ?? 'uncommitted', folder: c.rel });
      changes.push({ section, slug, old: line, neu, notes: true, why: 'closed item' });
      return neu;
    }
    if (line.length <= OLD_LINE) return line;
    if (line.endsWith('-state-notes.md)') && line.includes('… (full text: ')) return line; // already shortened: a second run changes nothing
    let slug: string | undefined;
    for (const s of closed.keys()) if (new RegExp(`(^|[^\\w.-])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w.-])`).test(line)) { slug = s; break; }
    if (slug === undefined) return line;
    const cut = line.slice(0, KEEP);
    const sp = cut.lastIndexOf(' ');
    const neu = `${(sp > 40 ? cut.slice(0, sp) : cut).trimEnd()}… (full text: ${closed.get(slug)!.rel}/${slug}-state-notes.md)`;
    changes.push({ section, slug, old: line, neu, notes: true, why: 'old line naming a closed item' });
    return neu;
  });

  const oldWords = changes.reduce((n, c) => n + words(c.old), 0);
  const newWords = changes.reduce((n, c) => n + words(c.neu), 0);
  io.stdout(`state compact: ${o.apply ? 'applying' : 'dry run (nothing is written; add --apply to write)'}\n`);
  for (const c of changes) io.stdout(`[${c.section}] ${c.why}: ${c.slug}\n  - ${c.old.slice(0, 240)}${c.old.length > 240 ? '…' : ''}\n  + ${c.neu}\n  words: ${words(c.old)} → ${words(c.neu)}\n`);
  for (const k of kept) io.stdout(`left as it is: ${k}\n`);
  if (changes.length === 0) { io.stdout('state compact: nothing to compact\n'); return 0; }
  io.stdout(`${changes.length} line(s), ${oldWords} → ${newWords} words (saves ${oldWords - newWords})\n`);
  if (o.apply !== true) return 0;

  // Notes first (nothing is lost if a later write fails), then the backup, then the state file; the file is re-read so a change made meanwhile is never overwritten.
  for (const c of changes) {
    const info = closed.get(c.slug)!;
    const body = c.old.replace(/^- /, '');
    if (inFolder(info.dir, body)) { io.stdout(`notes: ${c.slug}: the text is already in ${info.rel}, not copied again\n`); continue; }
    const notes = join(info.dir, `${c.slug}-state-notes.md`);
    assertInside(project, notes);
    const prior = existsSync(notes) ? readFileSync(notes, 'utf8') : `# ${c.slug} — state notes\nThe full text of lines \`burhan state compact\` shortened in the state file. Not a status file.\n`;
    putFile(notes, `${prior.endsWith('\n') ? prior : prior + '\n'}\n## ${today()} — from "${c.section}"\n${body}\n`);
    io.stdout(`notes: ${c.slug}: the old text is in ${info.rel}/${c.slug}-state-notes.md\n`);
  }
  if (readFileSync(statePath, 'utf8') !== text) throw new BurhanError('the state file changed while compacting: nothing was written to it; run the command again');
  assertInside(project, statePath + '.bak');
  putFile(statePath + '.bak', text);
  putFile(statePath, out.join(eol));
  io.stdout(`written: ${stateRel} (backup: ${stateRel}.bak); ${lines.length} → ${out.length} lines\n`);
  return 0;
}
