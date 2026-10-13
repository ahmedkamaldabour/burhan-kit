import { accessSync, constants, existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync, rmdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { Io } from '../main.js';
import { BlockError, removeBlock, type Agent } from './bootstrap.js';
import { isManagedCommand } from './commands.js';
import { readProjectConfig } from './config.js';
import { BurhanError } from './errors.js';
import { isWritable, putFile, realTarget } from './fs-safe.js';
import { burhanHookCommands, removeHooks, validHooksFile, type Settings } from './hooks-merge.js';
import { AGENTS } from './install.js';

const HOOKS_FILE: Record<Agent, string> = { claude: '.claude/settings.json', codex: '.codex/hooks.json' };
const BOOT_FILE: Record<Agent, string> = { claude: 'CLAUDE.md', codex: 'AGENTS.md' };
const KIT = ['WORKFLOW.md', 'SETUP.md', 'VERSION', 'phases', 'templates', 'commands', 'hooks']; // .gitignore: handled apart (I-5)
const PROJECT = ['workflow.config', 'bindings.md', 'local']; // R-9: kept unless --all
const MAX_MARK_SCAN = 1_000_000;

interface Op { say: string; run: () => void; rel?: string }

export function uninstall(o: { target: string; apply: boolean; all: boolean }, io: Io): number {
  if (!existsSync(o.target) || !statSync(o.target).isDirectory()) throw new BurhanError(`target is not a directory: ${o.target}`);
  const target = realTarget(o.target);
  const W = join(target, '.burhan');
  if (!existsSync(join(W, 'WORKFLOW.md'))) throw new BurhanError(`burhan is not installed in ${target}`);

  const ops: Op[] = [];
  const kept: string[] = [];
  const left: string[] = [];
  const abs = (rel: string): string => join(target, rel);
  const isFile = (p: string): boolean => { try { const s = lstatSync(p); return s.isFile() || s.isSymbolicLink(); } catch { return false; } };
  const within = (p: string): boolean => p === target || p.startsWith(target + sep);
  const real = (p: string): string | null => { try { return realpathSync(p); } catch { return null; } };
  const parentSafe = (rel: string): boolean => { const r = real(dirname(abs(rel))); return r !== null && within(r); };
  const contentSafe = (rel: string): boolean => { const r = real(abs(rel)); return r !== null && within(r); };
  const isLink = (p: string): boolean => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
  const skipLink = (rel: string): void => { left.push(`${rel} (a symlink, or inside one that leads outside the project — never followed or touched)`); };
  const blocked: string[] = [];
  const block = (p: string): void => { const r = relative(target, p).split(sep).join('/') || '.'; if (!blocked.includes(r)) blocked.push(r); };
  const w = (p: string): boolean => { try { accessSync(p, constants.W_OK); return true; } catch { return false; } };
  /** Every directory a recursive removal of `p` touches must be writable (and its parent). */
  const checkRemovable = (p: string): void => {
    if (!w(dirname(p))) block(dirname(p));
    const walkW = (d: string): void => {
      let st; try { st = lstatSync(d); } catch { return; }
      if (!st.isDirectory()) return;
      if (!w(d)) block(d);
      for (const e of readdirSync(d)) walkW(join(d, e));
    };
    walkW(p);
  };
  const rm = (rel: string, say: string): void => {
    if (!parentSafe(rel)) { skipLink(rel); return; }
    checkRemovable(abs(rel));
    ops.push({ say, rel, run: () => rmSync(abs(rel), { recursive: true, force: true }) });
  };
  const edit = (rel: string, say: string, text: string): void => {
    if (!isWritable(abs(rel))) block(abs(rel));
    ops.push({ say, rel, run: () => putFile(abs(rel), text) });
  };

  // ---- 1. hook entries, then bootstrap blocks (validated now; written in the apply phase)
  for (const a of AGENTS) {
    const hf = HOOKS_FILE[a];
    if (existsSync(abs(hf)) && isFile(abs(hf)) && !contentSafe(hf)) skipLink(hf);
    else if (existsSync(abs(hf)) && isFile(abs(hf))) {
      let v: unknown;
      try { v = JSON.parse(readFileSync(abs(hf), 'utf8')); } catch { v = undefined; }
      if (!validHooksFile(v)) throw new BurhanError(`${hf}: expected a JSON object whose "hooks" (if present) maps event names to arrays of hook groups — fix it, then re-run`);
      const commands = burhanHookCommands(target, a);
      const next = removeHooks(v, commands);
      if (JSON.stringify(next) !== JSON.stringify(v)) {
        if (next === null) rm(hf, `remove ${hf} (it held only burhan's hooks)`);
        else edit(hf, `edit ${hf} (burhan's hook entries removed; your other settings and hooks kept)`, JSON.stringify(next as Settings, null, 2) + '\n');
      }
    }
    const bf = BOOT_FILE[a];
    if (existsSync(abs(bf)) && isFile(abs(bf)) && !contentSafe(bf)) skipLink(bf);
    else if (existsSync(abs(bf)) && isFile(abs(bf))) {
      let r: { content: string | null };
      try { r = removeBlock(readFileSync(abs(bf), 'utf8')); }
      catch (e) { if (e instanceof BlockError) throw new BurhanError(`${bf}: ${e.message}`); throw e; }
      if (r.content === null) rm(bf, `remove ${bf} (it held only the burhan block)`);
      else if (r.content !== readFileSync(abs(bf), 'utf8')) edit(bf, `edit ${bf} (burhan block removed; your text kept)`, r.content);
    }
  }

  // ---- 2. managed .claude files: only those carrying the burhan mark
  const statSafe = (p: string): boolean => { try { return statSync(p).isDirectory(); } catch { return false; } };
  const walk = (dir: string): void => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isSymbolicLink()) { if (isLink(p) && statSafe(p)) skipLink(relative(target, p).split(sep).join('/')); }
      else if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        let marked = false;
        try { marked = statSync(p).size <= MAX_MARK_SCAN && isManagedCommand(readFileSync(p, 'utf8')); } catch { /* unreadable: not ours */ }
        if (marked) { const rel = relative(target, p).split(sep).join('/'); rm(rel, `remove ${rel}`); }
      }
    }
  };
  if (isLink(abs('.claude'))) skipLink('.claude'); else walk(abs('.claude'));

  // ---- 3. kit files under .burhan/
  for (const f of KIT) if (existsSync(abs(`.burhan/${f}`)) || isFile(abs(`.burhan/${f}`))) rm(`.burhan/${f}`, `remove .burhan/${f}`);

  // ---- 4. project files and work files (R-9)
  const cfg = readProjectConfig(target).values;
  const privateRoots = ['.burhan/work', '.burhan/discovery'];
  for (const f of PROJECT) {
    const rel = `.burhan/${f}`;
    if (!existsSync(abs(rel))) continue;
    if (o.all) rm(rel, `remove ${rel}`); else kept.push(rel);
  }
  const work = [...new Set([cfg.WF_DOCS_DIR, cfg.WF_DISCOVERY_DIR, ...privateRoots].filter((x): x is string => !!x))]
    .map((p) => p.replace(/^(\.\/)+/, '').replace(/\/+$/, '')).filter((p) => p !== '' && existsSync(abs(p)));
  for (const p of [...new Set(work)]) {
    if (privateRoots.some((root) => p.startsWith(`${root}/`)) && !p.split('/').includes('..')) continue;
    if (!o.all) kept.push(p);
    else if (!privateRoots.includes(p)) left.push(`${p} (your files, outside the private work/discovery folders — never removed)`);
    else if (isLink(abs(p))) skipLink(p);
    else rm(p, `remove ${p}`);
  }
  const ig = '.burhan/.gitignore';
  if (existsSync(abs(ig)) || isLink(abs(ig))) {
    const protectedKept = ['local', 'work', 'discovery'].some((name) => {
      const rel = `.burhan/${name}`;
      return (existsSync(abs(rel)) || isLink(abs(rel))) && !ops.some((op) => op.rel === rel);
    });
    if (isLink(abs(ig)) || !contentSafe(ig)) skipLink(ig);
    else if (!protectedKept && readFileSync(abs(ig), 'utf8') === '/local/\n/work/\n/discovery/\n') rm(ig, `remove ${ig}`);
    else left.push(`${ig} (private-file protection and your ignore rules are kept)`);
  }

  // ---- 5. what is in .burhan/ that is not ours, and so stays
  const known = new Set([...KIT, ...PROJECT, '.gitignore', 'work', 'discovery']);
  for (const e of readdirSync(W)) if (!known.has(e)) left.push(`.burhan/${e} (not a burhan file)`);

  // ---- output / apply
  io.stdout(o.apply ? `burhan uninstall ← ${target}\n` : `DRY RUN — burhan uninstall ← ${target} (nothing will change; add --apply)\n`);
  for (const op of ops) io.stdout(`  ${op.say}\n`);
  for (const k of kept) io.stdout(`  kept: ${k} (yours; add --all to remove it)\n`);
  for (const l of left) io.stdout(`  kept: ${l}\n`);
  for (const b of blocked) io.stdout(`  BLOCKED: ${b} is not writable — --apply would stop here and change nothing; make it writable (or run the command outside the agent's sandbox)\n`);
  if (o.apply && blocked.length) throw new BurhanError(`${blocked[0]} is not writable — nothing was changed`);
  if (o.apply) {
    for (const op of ops) {
      try { op.run(); } catch (e) { throw new BurhanError(`failed: ${op.say}: ${(e as Error).message}`); }
    }
    // Folders this left empty go too (never the project itself); a folder with anything inside stays.
    const dirs = new Set<string>();
    for (const op of ops) if (op.rel) for (let d = dirname(abs(op.rel)); d !== target && d.startsWith(target + sep); d = dirname(d)) dirs.add(d);
    for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
      try { if (readdirSync(d).length === 0) rmdirSync(d); } catch { /* not there, or not empty */ }
    }
  }
  return blocked.length ? 1 : 0;
}
