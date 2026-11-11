import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { Io } from '../main.js';
import { readProjectConfig } from './config.js';
import { fenced, gatesFor } from '../hooks/core/item-model.mjs';
import { BurhanError } from './errors.js';
import { putFile, realTarget } from './fs-safe.js';
import { editStateFile, withLock } from './state-write.js';
import { displayId, matchItem, nextNumber, readsAsNumber } from '../hooks/core/item-id.mjs';
import { folderNames } from './item-files.js';
import { headingIds } from './state-set.js';
import { assertInside, isSlug, SLUG_RULE, today } from './item-io.js';
import { kitDir } from './kit.js';
import { docsLocation } from './status.js';

type Make = 'story' | 'plan' | 'spec' | 'findings';
const TYPES = ['feature', 'bug', 'investigation', 'change', 'refactor', 'release'];
const SCOPES = ['spike', 'bounded', 'architectural', 'patch'];

/** The files a route needs (WORKFLOW §3): a story where the route has the S gate, a plan where it has P, findings where it is read-only. */
const FILES: Record<string, Record<string, Make[] | undefined>> = {
  feature: { bounded: ['story', 'plan', 'spec'], architectural: ['story', 'plan', 'spec'] },
  bug: { spike: ['findings'], bounded: ['story', 'plan', 'spec'], architectural: ['story', 'plan', 'spec'] },
  investigation: { spike: ['findings'], bounded: ['findings'], architectural: ['findings'] },
  change: { bounded: ['story', 'plan', 'spec'], architectural: ['story', 'plan', 'spec'] },
  refactor: { bounded: ['plan', 'spec'], architectural: ['plan', 'spec'] },
  release: { bounded: ['plan', 'spec'], architectural: ['plan', 'spec'] },
};
const NAME: Record<Make, (slug: string) => string> = { story: (s) => `${s}-story.md`, plan: (s) => `${s}-implementation-plan.md`, spec: (s) => `${s}-build-spec.md`, findings: (s) => `${s}-findings.md` };
const TEMPLATE: Record<Make, string> = { story: 'story.md', plan: 'plan.md', spec: 'build-spec.md', findings: 'findings.md' };

/** Replace the one line a template has for a label; a template that no longer has it is an error, never a silently wrong file. */
function swap(text: string, pattern: RegExp, line: string, what: string): string {
  if (!pattern.test(text)) throw new BurhanError(`the template no longer has the ${what} line the command fills${what === 'Overall status' ? ' (it also carries the Contract line)' : ''}; run burhan upgrade or fix the template`);
  return text.replace(pattern, () => line);
}

/** The plan's Gate checklist written from the route's table; a route that is not exact keeps the template's full list. A heading inside a
 *  code fence is not read, as in gate tick and item finish. */
function withChecklist(text: string, route: string, slug: string): string {
  const gates = gatesFor(route);
  if (gates === null) return text;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const inFence = fenced(lines);
  const start = lines.findIndex((l, i) => !inFence[i] && /^## Gate checklist\s*$/.test(l));
  if (start === -1) throw new BurhanError('the template no longer has the Gate checklist section the command fills; run burhan upgrade or fix the template');
  const next = lines.findIndex((l, i) => i > start && !inFence[i] && /^## /.test(l));
  const end = next === -1 ? lines.length : next;
  lines.splice(start + 1, end - start - 1, ...gates.map((g) => `- [ ] ${g.split('<slug>').join(slug)}`), '');
  return lines.join('\n');
}

function fill(kind: Make, text: string, slug: string, route: string, mode: string, hasStory: boolean): string {
  let t = text;
  if (kind === 'story') {
    t = swap(t, /^# <Title>.*$/m, `# ${slug}`, 'title');
    t = swap(t, /^- \*\*Route:\*\* .*$/m, `- **Route:** ${route}`, 'Route');
    t = swap(t, /^- \*\*Status:\*\* .*$/m, '- **Status:** Draft\n- **Contract:** 1', 'Status');
    t = swap(t, /^- \*\*Mode:\*\* .*$/m, `- **Mode:** ${mode}`, 'Mode');
  } else if (kind === 'plan') {
    t = swap(t, /^# <Title>.*$/m, `# ${slug} — Implementation Plan`, 'title');
    t = swap(t, /^- \*\*Route:\*\* .*$/m, `- **Route:** ${route} · **Routing reason:** <one line; any scope escalator>`, 'Route');
    t = swap(t, /^- \*\*Story:\*\* .*$/m, `- **Story:** ${hasStory ? `./${slug}-story.md` : '—'}`, 'Story');
    t = swap(t, /^- \*\*Build spec:\*\* .*$/m, `- **Build spec:** ./${slug}-build-spec.md (approved with this plan)`, 'Build spec');
    t = swap(t, /^- \*\*Overall status:\*\* .*$/m, `- **Overall status:** Draft\n- **Contract:** 1`, 'Overall status');
    t = t.split('<slug>').join(slug); // the gate lines name this item's files
    t = withChecklist(t, route, slug);
  } else if (kind === 'spec') {
    t = swap(t, /^# <Title>.*$/m, `# ${slug} — Build spec`, 'title');
    t = swap(t, /^- \*\*Plan:\*\* .*$/m, `- **Plan:** ./${slug}-implementation-plan.md`, 'Plan');
    t = swap(t, /^- \*\*Contract:\*\* .*$/m, '- **Contract:** 1', 'Contract');
  } else {
    t = swap(t, /^# <Title>.*$/m, `# ${slug} — Findings`, 'title');
    t = swap(t, /^- \*\*Status:\*\* .*$/m, '- **Status:** In progress\n- **Contract:** 1', 'Status');
    t = swap(t, /^- \*\*Route:\*\* .*$/m, `- **Route:** ${route} · **Read-only:** yes`, 'Route');
    t = swap(t, /^- \*\*Date:\*\* .*$/m, `- **Date:** ${today()}`, 'Date');
  }
  return text.includes('\r\n') ? t.replace(/\r?\n/g, '\r\n') : t;
}

/** Insert the item's block at the end of "## Now" (before the next "## " heading); null when the file has no "## Now". */
function withBlock(state: string, slug: string, block: string[]): string | null {
  const eol = state.includes('\r\n') ? '\r\n' : '\n';
  const lines = state.split(/\r?\n/);
  const now = lines.findIndex((l) => /^##\s+Now\s*$/.test(l));
  if (now === -1) return null;
  const next = lines.findIndex((l, i) => i > now && /^##\s/.test(l));
  const end = next === -1 ? lines.length : next;
  let at = end;
  while (at - 1 > now && lines[at - 1] === '') at--; // after the last non-blank line of Now
  lines.splice(at, 0, '', ...block);
  if (lines[at + 1 + block.length] !== '' && at + 1 + block.length < lines.length) lines.splice(at + 1 + block.length, 0, '');
  return lines.join(eol);
}

const hasBlock = (state: string, slug: string): boolean => {
  const lines = state.split(/\r?\n/);
  const now = lines.findIndex((l) => /^##\s+Now\s*$/.test(l));
  if (now === -1) return false;
  for (let i = now + 1; i < lines.length && !/^##\s/.test(lines[i]!); i++) if (new RegExp(`^###\\s+${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`).test(lines[i]!)) return true;
  return false;
};

/** The folder name of the lock that makes "read the numbers, take the next, make the folder" one step (the lock of src/lib/state-write.ts, on the docs folder). */
export const DOCS_LOCK = '.item-new.lock';

/** Under the docs-folder lock: refuse a slug another item already has (with or without its number), take the next number (the highest + 1) and make the folder.
 *  The folder is the claim: a second `item new` that waited for the lock finds it and takes the number after. Returns the full id `NNN-slug`. */
function claimFolder(docsAbs: string, slug: string, relDocs: string): string {
  mkdirSync(docsAbs, { recursive: true });
  return withLock(join(docsAbs, DOCS_LOCK), 'the docs folder', () => {
    const names = folderNames(docsAbs);
    const clash = matchItem(slug, names);
    if (clash.kind === 'one') throw new BurhanError(`item "${slug}" already has a folder: ${relDocs}/${clash.id}`);
    if (clash.kind === 'many') throw new BurhanError(`item "${slug}" already has folders: ${clash.ids.join(', ')}`);
    const number = nextNumber(names);
    if (number === null) throw new BurhanError('the docs folder already has an item numbered 999: no number is left for a new item');
    const id = `${number}-${slug}`;
    mkdirSync(join(docsAbs, id)); // not recursive: a folder that appeared meanwhile is an error, never shared
    return id;
  });
}

/** `burhan item new <slug> --type <t> --scope <s>`: validates, takes the next number under the lock, and writes the item's files and its block in Now.
 *  `folder` (a test seam, never a CLI flag) is the whole folder name to use instead of a number: it makes an item in the older, unnumbered shape. */
export function itemNew(target: string, o: { slug?: string; type?: string; scope?: string; docs?: string }, io: Io, folder: string | null = null): number {
  if (!isSlug(o.slug)) throw new BurhanError(`item new needs an item slug (${SLUG_RULE})`);
  if (readsAsNumber(o.slug)) throw new BurhanError(`the slug "${o.slug}" reads as an item number (only digits, or three digits and a dash): item new adds the number itself, so give a slug with a word in it, such as fix-login`);
  const bare = o.slug;
  const id = folder;
  if (!o.type) throw new BurhanError(`item new needs --type (${TYPES.join(', ')})`);
  if (!o.scope) throw new BurhanError(`item new needs --scope (${SCOPES.join(', ')})`);
  if (!TYPES.includes(o.type)) throw new BurhanError(`--type "${o.type}" is not one of ${TYPES.join(', ')}`);
  if (!SCOPES.includes(o.scope)) throw new BurhanError(`--scope "${o.scope}" is not one of ${SCOPES.join(', ')}`);
  if (o.scope === 'patch') throw new BurhanError('a patch has no story or plan, so it needs no item (WORKFLOW §3): make the change and state the routing line');
  const make = FILES[o.type]?.[o.scope];
  if (make === undefined) throw new BurhanError(`a ${o.type} cannot be a ${o.scope}: route it as an investigation (WORKFLOW §3)`);

  const project = realTarget(target);
  const docs = docsLocation(target, o.docs);

  const values = readProjectConfig(project).values;
  const stateRel = values.WF_STATE_FILE || '.burhan/local/PROGRESS.md';
  const statePath = join(project, stateRel);
  const stateStat = ((): { isFile(): boolean } | null => { try { return statSync(statePath); } catch { return null; } })();
  if (stateStat !== null && !stateStat.isFile()) throw new BurhanError(`the state file ${stateRel} is not a plain file`);
  const state = existsSync(statePath) ? readFileSync(statePath, 'utf8') : null;
  if (state !== null && matchItem(bare, headingIds(state)).kind !== 'none') throw new BurhanError(`item "${bare}" already has a block in Now (${stateRel})`);

  const route = `${o.type} / ${o.scope}`;
  const asked = values[`WF_MODE_${o.type.toUpperCase()}_${o.scope.toUpperCase()}`] || values.WF_MODE_DEFAULT || 'step';
  const mode = asked === 'auto' ? 'auto' : 'step';
  const template = (kind: Make): string => {
    const own = join(project, '.burhan', 'templates', TEMPLATE[kind]);
    return readFileSync(existsSync(own) ? own : join(kitDir(), 'templates', TEMPLATE[kind]), 'utf8');
  };
  const templates = make.map((kind) => ({ kind, text: template(kind) })); // read before the folder is claimed: a missing template leaves nothing behind

  // The folder is claimed now (a number taken under the lock); from here on a refusal or a failure removes it whole and nothing is left half-made.
  const slug = id ?? claimFolder(docs.abs, bare, docs.rel);
  const dir = join(docs.abs, slug);
  if (id !== null && existsSync(dir)) throw new BurhanError(`item "${slug}" already has a folder: ${relative(target, dir).split('\\').join('/')}`);
  const undo = (): void => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort: the message tells what to check */ } };

  let out: Array<{ path: string; text: string }>;
  let blockLines: string[] | null = null;
  try {
    out = templates.map((t) => ({ path: join(dir, NAME[t.kind](slug)), text: fill(t.kind, t.text, slug, route, mode, make.includes('story')) }));
    for (const f of out) assertInside(project, f.path);
    if (state !== null) {
      assertInside(project, statePath);
      blockLines = [`### ${slug}`, `- **Route:** ${route} · **Mode:** ${mode} · intake ${today()}`, `- Created by \`burhan item new\`; fill ${make.includes('story') ? 'the story' : 'the files'} next, then \`burhan item check ${slug}\``];
    }
  } catch (error) { undo(); throw error; }

  let stateWritten = false;
  let noNow = false;
  try {
    mkdirSync(dir, { recursive: true });
    for (const f of out) { mkdirSync(dirname(f.path), { recursive: true }); putFile(f.path, f.text); }
    if (blockLines !== null) {
      const lines = blockLines;
      const result = editStateFile(statePath, (current) => {
        if (hasBlock(current, slug)) throw new BurhanError(`item "${slug}" already has a block in Now (${stateRel})`);
        return withBlock(current, slug, lines);
      }, { label: stateRel });
      stateWritten = result === 'written';
      noNow = !stateWritten;
    }
  } catch (error) {
    undo();
    throw new BurhanError(`item new failed (${(error as NodeJS.ErrnoException).code ?? 'file system error'}) and nothing was left behind: ${(error as Error).message}`);
  }
  io.stdout(`item new: created ${displayId(slug)} (${route}, mode ${mode})\n`);
  for (const f of out) io.stdout(`  ${relative(target, f.path).split('\\').join('/')}\n`);
  if (stateWritten) io.stdout(`  state: added "### ${slug}" under Now in ${stateRel}\n`);
  else if (noNow) io.stdout(`  ${stateRel} has no "## Now" section: add the "### ${slug}" block yourself\n`);
  else io.stdout(`  no state file at ${stateRel}: add the "### ${slug}" block under "## Now" yourself\n`);
  io.stdout(`next: fill the files, then burhan item check ${slug}\n`);
  return 0;
}
