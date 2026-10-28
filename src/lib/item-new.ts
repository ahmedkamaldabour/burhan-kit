import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { Io } from '../main.js';
import { readProjectConfig } from './config.js';
import { BurhanError } from './errors.js';
import { putFile, realTarget } from './fs-safe.js';
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
  if (!pattern.test(text)) throw new BurhanError(`the template no longer has the ${what} line the command fills; run burhan upgrade or fix the template`);
  return text.replace(pattern, () => line);
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
    t = swap(t, /^- \*\*Overall status:\*\* .*$/m, '- **Overall status:** Draft\n- **Contract:** 1', 'Overall status');
    t = t.split('<slug>').join(slug); // the gate lines name this item's files
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

export function itemNew(target: string, o: { slug?: string; type?: string; scope?: string; docs?: string }, io: Io): number {
  if (!isSlug(o.slug)) throw new BurhanError(`item new needs an item slug (${SLUG_RULE})`);
  const slug = o.slug;
  if (!o.type) throw new BurhanError(`item new needs --type (${TYPES.join(', ')})`);
  if (!o.scope) throw new BurhanError(`item new needs --scope (${SCOPES.join(', ')})`);
  if (!TYPES.includes(o.type)) throw new BurhanError(`--type "${o.type}" is not one of ${TYPES.join(', ')}`);
  if (!SCOPES.includes(o.scope)) throw new BurhanError(`--scope "${o.scope}" is not one of ${SCOPES.join(', ')}`);
  if (o.scope === 'patch') throw new BurhanError('a patch has no story or plan, so it needs no item (WORKFLOW §3): make the change and state the routing line');
  const make = FILES[o.type]?.[o.scope];
  if (make === undefined) throw new BurhanError(`a ${o.type} cannot be a ${o.scope}: route it as an investigation (WORKFLOW §3)`);

  const project = realTarget(target);
  const docs = docsLocation(target, o.docs);
  const dir = join(docs.abs, slug);
  if (existsSync(dir)) throw new BurhanError(`item "${slug}" already has a folder: ${relative(target, dir).split('\\').join('/')}`);

  const values = readProjectConfig(project).values;
  const stateRel = values.WF_STATE_FILE || '.burhan/local/PROGRESS.md';
  const statePath = join(project, stateRel);
  const stateStat = ((): { isFile(): boolean } | null => { try { return statSync(statePath); } catch { return null; } })();
  if (stateStat !== null && !stateStat.isFile()) throw new BurhanError(`the state file ${stateRel} is not a plain file`);
  const state = existsSync(statePath) ? readFileSync(statePath, 'utf8') : null;
  if (state !== null && hasBlock(state, slug)) throw new BurhanError(`item "${slug}" already has a block in Now (${stateRel})`);

  const route = `${o.type} / ${o.scope}`;
  const asked = values[`WF_MODE_${o.type.toUpperCase()}_${o.scope.toUpperCase()}`] || values.WF_MODE_DEFAULT || 'step';
  const mode = asked === 'auto' ? 'auto' : 'step';
  const template = (kind: Make): string => {
    const own = join(project, '.burhan', 'templates', TEMPLATE[kind]);
    return readFileSync(existsSync(own) ? own : join(kitDir(), 'templates', TEMPLATE[kind]), 'utf8');
  };

  // Everything is computed and checked before the first write.
  const out = make.map((kind) => ({ path: join(dir, NAME[kind](slug)), text: fill(kind, template(kind), slug, route, mode, make.includes('story')) }));
  for (const f of out) assertInside(project, f.path);
  let newState: string | null = null;
  let noNow = false;
  if (state !== null) {
    assertInside(project, statePath);
    newState = withBlock(state, slug, [`### ${slug}`, `- **Route:** ${route} · **Mode:** ${mode} · intake ${today()}`, `- Created by \`burhan item new\`; fill ${make.includes('story') ? 'the story' : 'the files'} next, then \`burhan item check ${slug}\``]);
    noNow = newState === null;
  }

  // The folder did not exist, so on any failure it is removed whole and nothing is left half-made.
  try {
    mkdirSync(dir, { recursive: true });
    for (const f of out) { mkdirSync(dirname(f.path), { recursive: true }); putFile(f.path, f.text); }
    if (newState !== null) putFile(statePath, newState);
  } catch (error) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort: the message below tells what to check */ }
    throw new BurhanError(`item new failed (${(error as NodeJS.ErrnoException).code ?? 'file system error'}) and nothing was left behind: ${(error as Error).message}`);
  }
  io.stdout(`item new: created ${slug} (${route}, mode ${mode})\n`);
  for (const f of out) io.stdout(`  ${relative(target, f.path).split('\\').join('/')}\n`);
  if (newState !== null) io.stdout(`  state: added "### ${slug}" under Now in ${stateRel}\n`);
  else if (noNow) io.stdout(`  ${stateRel} has no "## Now" section: add the "### ${slug}" block yourself\n`);
  else io.stdout(`  no state file at ${stateRel}: add the "### ${slug}" block under "## Now" yourself\n`);
  io.stdout(`next: fill the files, then burhan item check ${slug}\n`);
  return 0;
}
