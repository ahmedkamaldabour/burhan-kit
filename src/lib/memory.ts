import { closeSync, lstatSync, openSync, readdirSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isAbsolute, join, normalize, posix, sep } from 'node:path';
import { BurhanError } from './errors.js';
import type { Io } from '../main.js';
import { MAX_MEMORY_BYTES, PROJECT_FILE, parseFacts, readBaseline, readProjectFile, type Fact, type Problem } from '../hooks/core/baseline.mjs';

const CONTEXT_DIR = '.burhan/context';
// A git conflict: `<<<<<<<` … `=======` … `>>>>>>>`. `=======` counts only in a file with another marker; alone it
// is a Markdown underline.
const OPEN = /^<{7}(?: |$)/; const MIDDLE = /^={7}$/; const CLOSE = /^>{7}(?: |$)/;
// A net, not a guarantee (phases/memory.md): obvious key shapes and `name=value` / `name: value` pairs.
const SECRETS: [string, RegExp][] = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['credential assignment', /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[=:]\s*\S{6,}/i],
];

/** Problems every memory file shares: leftover merge markers (fail) and secret-looking text (warn, value never kept). */
function scanLines(text: string, file: string): Problem[] {
  const out: Problem[] = [];
  const lines = text.split('\n').map((raw) => raw.replace(/\r$/, ''));
  const conflicted = lines.some((l) => OPEN.test(l) || CLOSE.test(l));
  lines.forEach((l, i) => {
    if (OPEN.test(l) || CLOSE.test(l) || (conflicted && MIDDLE.test(l))) out.push({ level: 'fail', file, line: i + 1, message: 'merge conflict marker left in the file' });
    const kind = SECRETS.find(([, re]) => re.test(l));
    if (kind) out.push({ level: 'warn', file, line: i + 1, message: `looks like a secret (${kind[0]}); memory names the setting only` });
  });
  return out;
}

export interface MemoryCheck { present: boolean; files: number; facts: Fact[]; problems: Problem[] }

/** `burhan memory check`: read-only, no network. Fails on shape, duplicate IDs, two states for one ID and merge markers. */
export function checkMemory(project: string): MemoryCheck {
  const problems: Problem[] = [];
  const facts: Fact[] = [];
  let files = 0;
  const dir = join(project, CONTEXT_DIR);
  const pf = readProjectFile(project);
  let dirStat;
  try { dirStat = lstatSync(dir); } catch { dirStat = null; }
  const present = !('skip' in pf && pf.skip === 'absent') || dirStat !== null;
  if (!present) return { present, files, facts, problems };

  if ('skip' in pf) {
    if (pf.skip === 'symlink') problems.push({ level: 'warn', file: PROJECT_FILE, line: null, message: 'symlink not followed' });
    if (pf.skip === 'large') problems.push({ level: 'fail', file: PROJECT_FILE, line: null, message: 'larger than 1 MiB, not read' });
    if (pf.skip === 'unreadable') problems.push({ level: 'fail', file: PROJECT_FILE, line: null, message: `cannot be read (${pf.code})` });
  } else {
    const text = pf.text;
    const b = readBaseline(text);
    if (b.state === 'malformed') problems.push({ level: 'fail', file: PROJECT_FILE, line: b.line, message: 'Baseline must be exactly Draft, Approved — <name> · YYYY-MM-DD or Waived — <name> · YYYY-MM-DD (phases/files.md · Fields)' });
    else if (b.legacy) problems.push({ level: 'warn', file: PROJECT_FILE, line: b.line, message: 'older field Memory status: — the next onboarding or refresh writes Baseline:' });
    problems.push(...scanLines(text, PROJECT_FILE));
  }

  let names: string[] = [];
  if (dirStat?.isSymbolicLink()) problems.push({ level: 'warn', file: CONTEXT_DIR, line: null, message: 'symlink not followed' });
  else if (dirStat?.isDirectory()) {
    try { names = readdirSync(dir).filter((n) => n.endsWith('.md')).sort(); } catch (e) { problems.push({ level: 'fail', file: CONTEXT_DIR, line: null, message: `cannot be read (${(e as NodeJS.ErrnoException).code ?? 'error'})` }); }
  }
  for (const name of names) {
    const rel = `${CONTEXT_DIR}/${name}`;
    let st;
    try { st = lstatSync(join(dir, name)); } catch { continue; }
    if (st.isSymbolicLink()) { problems.push({ level: 'warn', file: rel, line: null, message: 'symlink not followed' }); continue; }
    if (!st.isFile()) continue;
    if (st.size > MAX_MEMORY_BYTES) { problems.push({ level: 'fail', file: rel, line: null, message: 'larger than 1 MiB, not read' }); continue; }
    let text: string;
    try { text = readFileSync(join(dir, name), 'utf8'); } catch (e) { problems.push({ level: 'fail', file: rel, line: null, message: `cannot be read (${(e as NodeJS.ErrnoException).code ?? 'error'})` }); continue; }
    files++;
    const r = parseFacts(text, rel);
    facts.push(...r.facts);
    problems.push(...r.problems, ...scanLines(text, rel));
  }

  const seen = new Map<string, Fact>();
  for (const f of facts) {
    const first = seen.get(f.id);
    if (first === undefined) { seen.set(f.id, f); continue; }
    problems.push({
      level: 'fail', file: f.file, line: f.line,
      message: first.state === f.state ? `duplicate ID ${f.id} (also ${first.file}:${first.line})` : `${f.id} is in two states (${first.state}, ${f.state}); keep one row (also ${first.file}:${first.line})`,
    });
  }
  return { present, files, facts, problems };
}

const where = (p: Problem): string => (p.line === null ? p.file : `${p.file}:${p.line}`);

export function memoryCheck(target: string, io: Io): number {
  const r = checkMemory(target);
  if (!r.present) { io.stdout('memory check: no project memory (.burhan/PROJECT.md, .burhan/context/) — nothing to check\n'); return 0; }
  const sorted = [...r.problems].sort((a, b) => (a.level === b.level ? 0 : a.level === 'fail' ? -1 : 1));
  for (const p of sorted) io.stdout(`${p.level === 'fail' ? 'FAIL' : 'WARN'} ${where(p)} ${p.message}\n`);
  const fails = r.problems.filter((p) => p.level === 'fail').length;
  io.stdout(`memory check: ${r.facts.length} facts in ${r.files} files · ${fails} fail · ${r.problems.length - fails} warn\n`);
  return fails > 0 ? 1 : 0;
}

// ---- Freshness (`memory status`, `memory affected`) ----

export interface EvidenceItem { path: string; hash: string | null }
/** Evidence files larger than this are not hashed (their facts are `unchecked`). */
export const MAX_HASH_BYTES = 64 * 1024 * 1024;
export type Freshness = 'fresh' | 'changed' | 'missing' | 'unchecked';

/** The checkable items of an evidence cell: each `` `path` ``, `` `path:12-40` `` or `` `path#symbol` ``, with the hash after it. */
export function evidenceItems(cell: string): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (const m of cell.matchAll(/`([^`]+)`(?:\s+sha256:([0-9a-f]{16})\b)?/g)) {
    const path = m[1]!.trim().replace(/#.*$/, '').replace(/:\d+(?:-\d+)?$/, '');
    if (path !== '') out.push({ path, hash: m[2] ?? null });
  }
  return out;
}

/** First 16 hex of the SHA-256 of the whole file, with CRLF counted as LF so a Windows checkout gives the same hash. */
export function fileHash(file: string): string {
  const hash = createHash('sha256');
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    let pendingCr = false;
    for (let n = readSync(fd, buf); n > 0; n = readSync(fd, buf)) {
      const chunk: number[] = [];
      for (let i = 0; i < n; i++) {
        const b = buf[i]!;
        if (pendingCr) { if (b !== 0x0a) chunk.push(0x0d); pendingCr = false; }
        if (b === 0x0d) { pendingCr = true; continue; }
        chunk.push(b);
      }
      hash.update(Buffer.from(chunk));
    }
    if (pendingCr) hash.update(Buffer.from([0x0d]));
  } finally { closeSync(fd); }
  return hash.digest('hex').slice(0, 16);
}

/** A path inside the project, as written (relative, no `..`); null otherwise. */
function insidePath(project: string, rel: string): string | null {
  if (isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return null;
  const n = normalize(rel);
  if (n === '..' || n.startsWith(`..${sep}`)) return null;
  return join(project, n);
}

function itemFreshness(project: string, item: EvidenceItem, cache?: Map<string, string>): Freshness {
  if (item.hash === null) return 'unchecked';
  const file = insidePath(project, item.path);
  if (file === null) return 'unchecked';
  let st;
  try { st = lstatSync(file); } catch { return 'missing'; }
  if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_HASH_BYTES) return 'unchecked';
  // A symlinked parent folder would lead outside: the real path must stay inside the real project.
  try {
    const root = realpathSync(project);
    if (!realpathSync(file).startsWith(root + sep)) return 'unchecked';
  } catch { return 'unchecked'; }
  try {
    let h = cache?.get(file);
    if (h === undefined) { h = fileHash(file); cache?.set(file, h); }
    return h === item.hash ? 'fresh' : 'changed';
  } catch { return 'unchecked'; }
}

const RANK: Record<Freshness, number> = { fresh: 0, unchecked: 1, changed: 2, missing: 3 };

/** The fact's freshness: missing beats changed beats unchecked beats fresh; no checkable item = unchecked. */
export function factFreshness(fact: Fact, project: string, cache?: Map<string, string>): Freshness {
  const items = evidenceItems(fact.evidence);
  if (items.length === 0) return 'unchecked';
  return items.map((i) => itemFreshness(project, i, cache)).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'fresh' as Freshness);
}

const pad = (s: string, n: number): string => s + ' '.repeat(Math.max(1, n - s.length));

export function memoryStatus(target: string, io: Io): number {
  const r = checkMemory(target);
  if (!r.present) { io.stdout('memory status: no project memory (.burhan/PROJECT.md, .burhan/context/) — nothing to check\n'); return 0; }
  const live = r.facts.filter((f) => f.state !== 'superseded');
  const count: Record<Freshness, number> = { fresh: 0, changed: 0, missing: 0, unchecked: 0 };
  const cache = new Map<string, string>();
  for (const f of live) {
    const state = factFreshness(f, target, cache);
    count[state]++;
    if (state === 'fresh') continue;
    const paths = state === 'unchecked' ? [] : evidenceItems(f.evidence).filter((i) => itemFreshness(target, i, cache) === state).map((i) => i.path);
    io.stdout(`${pad(state.toUpperCase(), 10)}${pad(f.id, 24)}${f.file}:${f.line}${paths.length ? `  ${paths.join(' ')}` : ''}\n`);
  }
  io.stdout(`memory status: ${live.length} facts · ${count.fresh} fresh · ${count.changed} changed · ${count.missing} missing · ${count.unchecked} unchecked\n`);
  if (count.unchecked > 0) io.stdout('unchecked = no hash in the evidence (a fact written before hashes, or runtime/person evidence), or a path that is not a regular file inside the project\n');
  if (count.changed + count.missing > 0) io.stdout('changed does not mean false: re-check those facts, then reconfirm or supersede each (the refresh section of .burhan/commands/onboard.md)\n');
  const fails = r.problems.filter((p) => p.level === 'fail').length;
  if (fails > 0) io.stdout(`note: memory check reports ${fails} fail(s); run burhan memory check\n`);
  return 0;
}

/** An evidence path in git's form: `/` separators, no `./`, `//` or `/./`, no trailing `/`. */
const gitForm = (p: string): string => posix.normalize(p.replace(/\\/g, '/')).replace(/^\.\//, '').replace(/\/+$/, '');

/** Facts whose evidence cites a changed path, or a folder that contains it (indexed: cost grows with path depth). */
export function affectedBy(facts: Fact[], changedPaths: string[]): { path: string; facts: Fact[] }[] {
  const cited = new Map<string, Fact[]>();
  for (const f of facts) {
    for (const key of new Set(evidenceItems(f.evidence).map((i) => gitForm(i.path)))) {
      if (key === '' || key === '.') continue;
      const list = cited.get(key) ?? []; list.push(f); cited.set(key, list);
    }
  }
  const out: { path: string; facts: Fact[] }[] = [];
  for (const path of changedPaths) {
    const hit = new Set<Fact>();
    const parts = path.split('/');
    for (let n = parts.length; n > 0; n--) for (const f of cited.get(parts.slice(0, n).join('/')) ?? []) hit.add(f);
    if (hit.size) out.push({ path, facts: facts.filter((f) => hit.has(f)) });
  }
  return out;
}

export function memoryAffected(target: string, since: string | undefined, io: Io): number {
  if (since === undefined || since === '') throw new BurhanError('memory affected needs --since <ref> (a commit, branch or tag)');
  if (since.startsWith('-')) throw new BurhanError(`--since must be a git ref, not "${since}"`);
  const repo = spawnSync('git', ['-C', target, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (repo.error !== undefined || repo.status !== 0) throw new BurhanError('memory affected needs Git (not a Git repository, or git is not installed); memory status works without it');
  // --no-renames: a renamed file lists its old path too, so facts citing the old path are found.
  const diff = spawnSync('git', ['-C', target, '-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false', 'diff', '--no-renames', '--name-only', '-z', '--relative', since, '--'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (diff.error !== undefined) throw new BurhanError(`git diff ${since} failed: ${diff.error.message}`);
  if (diff.status !== 0) throw new BurhanError(`git diff ${since} failed: ${(diff.stderr || '').trim().split('\n')[0] ?? ''}`);
  const changedPaths = diff.stdout.split('\0').filter((x) => x !== '');
  const r = checkMemory(target);
  const live = r.facts.filter((f) => f.state !== 'superseded');
  const hits = affectedBy(live, changedPaths);
  for (const h of hits) io.stdout(`${h.path}: ${h.facts.map((f) => f.id).join(' ')}\n`);
  const n = new Set(hits.flatMap((h) => h.facts.map((f) => f.id))).size;
  io.stdout(`memory affected: ${hits.length} changed file${hits.length === 1 ? '' : 's'} cited by ${n} fact${n === 1 ? '' : 's'} (since ${since}; ${changedPaths.length} files changed; untracked files are not included)\n`);
  return 0;
}
