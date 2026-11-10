import { accessSync, constants, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Io } from '../main.js';
import { person } from './approve.js';
import { readProjectConfig } from './config.js';
import { BurhanError } from './errors.js';
import { putFile, realTarget } from './fs-safe.js';
import { deviations, itemFolder, planPath, readOr, units } from './item-files.js';
import { assertInside, oneLine, today } from './item-io.js';
import { accepted, fieldLine, latestQcFile } from './items.js';
import { kitDir } from './kit.js';
import { addNone, addRow, qcScope, readItemFindings, reviewScopes, rowLine, SEVERITIES, withDecision, type Decision, type Finding, type Gate, type Scope, type Severity } from './findings.js';
import { docsLocation } from './status.js';

const isLink = (p: string): boolean => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
/** The review and QC files of the item that are links: the reader does not follow them. */
function linkedReviewFiles(dir: string, s: string): string[] {
  let names: string[] = [];
  try { names = readdirSync(join(dir, 'reviews')); } catch { return []; }
  return names.filter((n) => (n === `${s}-review.md` || new RegExp(`^${s.replace(/\./g, '\\.')}-qc(-r\\d+)?\\.md$`).test(n)) && isLink(join(dir, 'reviews', n))).map((n) => `reviews/${n}`);
}
/** A discovery folder as the person reads it: relative to the project, with `/`, even when WF_DISCOVERY_DIR was written as an absolute path (it is joined under the project). */
const shownDir = (project: string, rel: string): string => relative(project, join(project, rel)).split(sep).join('/');

/** The section `--in` names: `review:<unit>` (the last review section that names the sub-unit) or `qc[:<round>]` (the latest QC report, or that round). */
function locate(dir: string, s: string, spec: string | undefined): { file: string; rel: string; text: string; scope: Scope } {
  const m = /^(?:review:(\d+)|qc(?::(\d+))?)$/.exec(spec ?? '');
  if (m === null) throw new BurhanError('--in is review:<unit> or qc[:<round>]');
  if (m[1] !== undefined) {
    const n = Number(m[1]);
    const rel = `reviews/${s}-review.md`;
    if (isLink(join(dir, rel))) throw new BurhanError(`the review file ${rel} is a link: burhan does not read or write through a link (it may lead outside the project)`);
    const text = readOr(join(dir, rel));
    if (text === null) throw new BurhanError(`there is no review file yet: run burhan review add ${s} --kind review --unit ${n} --by "<agent · model · context>" first`);
    const scope = reviewScopes(rel, text).filter((x) => x.units.includes(n)).pop();
    if (scope === undefined) throw new BurhanError(`the review file has no section for Sub-unit ${n}: run burhan review add ${s} --kind review --unit ${n} --by "<agent · model · context>" first`);
    return { file: join(dir, rel), rel, text, scope };
  }
  const file = m[2] === undefined ? latestQcFile(dir, s) : join(dir, 'reviews', m[2] === '1' ? `${s}-qc.md` : `${s}-qc-r${m[2]}.md`);
  const rel = relative(dir, file).split('\\').join('/');
  if (isLink(file)) throw new BurhanError(`the QC report ${rel} is a link: burhan does not read or write through a link (it may lead outside the project)`);
  const text = readOr(file);
  if (text === null) throw new BurhanError(`there is no ${m[2] === undefined ? 'QC report' : `QC round ${m[2]}`} yet: run burhan review add ${s} --kind qc --by "<agent · model · context>" --verdict "PASS" or "FAIL — N issues" first`);
  return { file, rel, text, scope: qcScope(rel, text, Number(/-qc-r(\d+)\.md$/.exec(rel)?.[1] ?? 1)) };
}

/** `burhan finding add <slug> --in review:<unit>|qc[:<round>] --severity <S> --text <finding, file:line>` adds one row to the section's findings table (the next number of the item),
 *  with no decision. `--none` writes the line `No findings.` instead. The reviewer writes findings; deciding them is the owner's (`finding decide`). */
export function findingAdd(root: string, slug: string | undefined, o: { in?: string; severity?: string; text?: string; none?: boolean; docs?: string }, io: Io): number {
  const project = realTarget(root);
  const { slug: s, dir } = itemFolder(docsLocation(root, o.docs).abs, slug, 'finding add');
  const t = locate(dir, s, o.in);
  if (t.scope.kind === 'qc' && accepted(fieldLine(t.text, 'Accepted by'))) throw new BurhanError(`the QC report ${t.rel} is already accepted: a finding added now would never be checked; add it in a new QC round`);
  if (o.none === true) {
    if (o.severity !== undefined || o.text !== undefined) throw new BurhanError('--none stands alone: a section with no finding takes no --severity or --text');
    if (t.scope.findings.length > 0 || t.scope.problems.length > 0) throw new BurhanError(`${t.scope.where} already has findings: it cannot also say "No findings."`);
    if (t.scope.state === 'none') { io.stdout(`finding add: ${t.scope.where} already says "No findings."\n`); return 0; }
    assertInside(project, t.file);
    putFile(t.file, addNone(t.text, t.scope));
    io.stdout(`finding add: ${t.scope.where} says "No findings." in ${t.rel}\n`);
    return 0;
  }
  const severity = SEVERITIES.find((x) => x.toLowerCase() === (o.severity ?? '').toLowerCase());
  if (severity === undefined) throw new BurhanError('--severity is Critical, Important or Minor');
  const text = oneLine(o.text, '--text');
  if (text === '') throw new BurhanError('--text is needed: the finding, with file:line');
  const id = readItemFindings(dir, s).maxId + 1;
  if (id > 999999) throw new BurhanError('finding numbers stop at 999999: the next one would be too large for the findings reader');
  assertInside(project, t.file);
  putFile(t.file, addRow(t.text, t.scope, rowLine({ id, severity, text })));
  io.stdout(`finding add: #${id} ${severity} recorded under ${t.scope.where} in ${t.rel}; it has no decision yet: the owner decides it (burhan finding list ${s})\n`);
  return 0;
}

const RECOMMEND: Record<Severity, string> = {
  Critical: 'fix it now: a Critical is fixed, or a discovery only for code this item did not change (--outside "<why>"), and is never accepted',
  Important: 'fix it now when it is in a change this item made (it is a defect of the work being finished), otherwise a discovery; accept it only with a reason of a sentence',
  Minor: 'fix it now when it is in the files this item changed (it is cheap while the context is loaded), otherwise a discovery',
};

/** The one grouped question for the owner, with the ready commands and a recommendation for each finding, then what else is open (a malformed row, a section with no table). Empty when nothing is open. */
export function questionLines(slug: string, g: Gate): string[] {
  const out: string[] = [];
  if (g.undecided.length > 0) {
    const n = g.undecided.length;
    out.push(`QUESTION FOR THE OWNER — ${n} finding${n === 1 ? ' has' : 's have'} no decision. Put ${n === 1 ? 'it' : 'them'} to the owner as ONE question and wait for the answer: the owner decides, you do not run the commands below for them (WORKFLOW §4 D).`);
    for (const f of g.undecided) {
      const unit = /^review:(\d+)$/.exec(f.spec)?.[1] ?? '<N>';
      out.push(`  #${f.id} ${f.severity} · ${f.where} · ${f.text}`);
      out.push(`      fixed (in this item; record it after the fix is made):  burhan finding decide ${slug} ${f.id} --fixed unit:${unit} --by <owner name>   (a fix after the review goes through burhan deviation add, then --fixed deviation:<n> once the row is approved or applied)`);
      out.push(`      discovery (out of this item):  burhan finding decide ${slug} ${f.id} --discovery <discovery file> --by <owner name>${f.severity === 'Critical' ? ' --outside "<why this code is outside the item>"' : ''}`);
      if (f.severity !== 'Critical') out.push(`      accepted (with a reason):  burhan finding decide ${slug} ${f.id} --accepted "<the owner's reason>" --by <owner name>`);
      out.push(`      recommendation: ${RECOMMEND[f.severity]}`);
    }
    out.push(`  Every finding left to a discovery at once (a Critical is never included): burhan finding discover ${slug} --by <owner name>`);
  }
  for (const p of g.problems) out.push(`  MALFORMED ROW ${p.file}:${p.line}: ${p.message}`);
  for (const s of g.missing) out.push(`  ${s.where} (${s.file}) has neither a findings table nor "No findings.": burhan finding add ${slug} --in ${s.spec} --none, or one row per finding`);
  for (const n of g.noSection) out.push(`  Sub-unit ${n} is Reviewed but has no review section: burhan review add ${slug} --kind review --unit ${n} --by "<agent · model · context>"`);
  return out;
}

/** `burhan finding list <slug>`: every finding of the item with its decision, then the grouped question for the ones with none (read-only). */
export function findingList(root: string, slug: string | undefined, o: { docs?: string }, io: Io): number {
  const { slug: s, dir } = itemFolder(docsLocation(root, o.docs).abs, slug, 'finding list');
  const all = readItemFindings(dir, s);
  const open = all.findings.filter((f) => f.decision === '');
  io.stdout(`finding list: ${s} — ${all.findings.length} finding${all.findings.length === 1 ? '' : 's'}, ${open.length} without a decision\n`);
  const linked = linkedReviewFiles(dir, s);
  if (linked.length > 0) io.stdout(`  ${linked.join(', ')} ${linked.length === 1 ? 'is a link and is' : 'are links and are'} not read: its findings are not in this list\n`);
  for (const f of all.findings.filter((x) => x.decision !== '')) io.stdout(`  #${f.id} ${f.severity} · ${f.where} · ${f.decision} (${f.pointer}) · ${f.by}\n`);
  for (const l of questionLines(s, { undecided: open, problems: all.problems, missing: all.scopes.filter((x) => x.state === 'missing' && !x.superseded), noSection: [] })) io.stdout(`${l}\n`);
  return 0;
}

const words = (text: string): number => text.split(/\s+/).filter((w) => w !== '').length;
/** Where the discoveries live: WF_DISCOVERY_DIR (team and local config), else .burhan/discovery; relative to the project, without a trailing slash. */
export const discoveryDir = (project: string): string => (readProjectConfig(project).values.WF_DISCOVERY_DIR || '.burhan/discovery').replace(/[\\/]+$/, '');

/** `burhan finding decide <slug> <n> --fixed unit:<N>|deviation:<n> | --discovery <file> [--outside <why>] | --accepted <reason> --by <owner name>`: the owner's decision on one finding,
 *  written in its row as the decision, its pointer or reason, and `<name> · <date>`. The command checks that the pointer exists (a sub-unit of the plan, an approved Deviations row, a discovery
 *  file); it cannot judge whether the finding is in scope: that is the owner's choice of decision. A Critical is never accepted; a decision is not overwritten. */
export function findingDecide(root: string, slug: string | undefined, id: string | undefined, o: { fixed?: string; discovery?: string; accepted?: string; outside?: string; by?: string; docs?: string }, io: Io): number {
  const project = realTarget(root);
  const { slug: s, dir } = itemFolder(docsLocation(root, o.docs).abs, slug, 'finding decide');
  const by = person(o.by, 'decides');
  if ([o.fixed, o.discovery, o.accepted].filter((x) => x !== undefined).length !== 1) throw new BurhanError('finding decide needs exactly one of --fixed, --discovery or --accepted');
  if (id === undefined || !/^\d+$/.test(id)) throw new BurhanError('finding decide needs the finding number: finding decide <slug> <n> --fixed|--discovery|--accepted ... --by <name>');
  const all = readItemFindings(dir, s);
  const f = all.findings.find((x) => x.id === Number(id));
  if (f === undefined) throw new BurhanError(`the item has no finding #${id} that is read (burhan finding list ${s} shows the findings and any malformed row)${linkedReviewFiles(dir, s).length > 0 ? `; ${linkedReviewFiles(dir, s).join(', ')} is a link and is not read` : ''}`);
  if (f.decision !== '') throw new BurhanError(`finding #${id} is already decided (${f.decision}: ${f.pointer}); a decision is not overwritten`);
  if (o.outside !== undefined && !(o.discovery !== undefined && f.severity === 'Critical')) throw new BurhanError('--outside is only for a Critical finding decided as a discovery');
  let decision: Decision;
  let pointer: string;
  if (o.fixed !== undefined) {
    const m = /^(unit|deviation):(\d+)$/.exec(o.fixed);
    if (m === null) throw new BurhanError('--fixed is unit:<N> (a sub-unit of the plan) or deviation:<n> (an approved or applied row of its Deviations table)');
    const plan = readOr(planPath(dir, s));
    if (plan === null) throw new BurhanError(`item "${s}" has no implementation plan`);
    const n = Number(m[2]);
    if (m[1] === 'unit') {
      if (!units(plan).some((u) => u.n === n)) throw new BurhanError(`the plan has no Sub-unit ${n}`);
      pointer = `unit ${n}`;
    } else {
      const row = deviations(plan).find((d) => d.n === n);
      if (row === undefined) throw new BurhanError(`the Deviations table has no row ${n}`);
      if (row.status !== 'approved' && row.status !== 'applied') throw new BurhanError(`Deviations row ${n} is ${row.status}: only an approved row is a fix, or an applied one (the owner decides an open row: burhan deviation resolve ${s} ${n} --approved --by <name>)`);
      pointer = `deviation ${n}`;
    }
    decision = 'fixed';
  } else if (o.discovery !== undefined) {
    const name = o.discovery.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(name)) throw new BurhanError('--discovery is the name of a discovery file (for example 2026-11-08-a-finding.md), with no folder');
    const where = `${shownDir(project, discoveryDir(project))}/${name}`;
    if (readOr(join(project, where)) === null) throw new BurhanError(`the discovery file ${where} does not exist: write it from templates/discovery.md, or let burhan finding discover ${s} open it`);
    if (f.severity === 'Critical') {
      const why = oneLine(o.outside, '--outside');
      if (words(why) < 3) throw new BurhanError('a Critical is a discovery only for code this item did not change: --outside "<why, in a sentence>" says why');
      pointer = `${name} — outside this item: ${why}`;
    } else pointer = name;
    decision = 'discovery';
  } else {
    if (f.severity === 'Critical') throw new BurhanError(`finding #${id} is Critical and cannot be accepted: it is fixed (--fixed), or a discovery for code this item did not change (--discovery <file> --outside "<why>")`);
    const reason = oneLine(o.accepted, '--accepted');
    if (words(reason) < (f.severity === 'Important' ? 3 : 1)) throw new BurhanError(`--accepted needs the owner's reason${f.severity === 'Important' ? ' of at least one sentence (an Important is not waved through with a word)' : ''}`);
    pointer = reason;
    decision = 'accepted';
  }
  const text = readOr(join(dir, f.file));
  if (text === null) throw new BurhanError(`${f.file} cannot be read`);
  assertInside(project, join(dir, f.file));
  putFile(join(dir, f.file), withDecision(text, f, decision, pointer, `${by} · ${today()}`));
  const left = all.findings.filter((x) => x.decision === '' && x.id !== f.id).length;
  io.stdout(`finding decide: #${id} ${f.severity} decided ${decision} (${pointer}) by ${by}; it was run from the shell, so the turn-end report lists it as agent-run: it must be the decision you were given. ${left === 0 ? 'Every finding has a decision now.' : `${left} finding${left === 1 ? ' has' : 's have'} no decision yet.`}\n`);
  return 0;
}

/** The discovery file for a finding, from templates/discovery.md: Planned, the finding's text and where it is. Line ends are \n. */
function discoveryText(template: string, f: Finding, slug: string, docsRel: string, by: string, date: string): string {
  const swap = (text: string, pattern: RegExp, to: string): string => {
    if (!pattern.test(text)) throw new BurhanError('the discovery template no longer has a line the command fills; run burhan upgrade or fix .burhan/templates/discovery.md');
    return text.replace(pattern, () => to);
  };
  const long = `${f.severity} finding #${f.id} of ${slug}: ${f.text}`;
  let t = template.replace(/\r\n/g, '\n');
  t = swap(t, /^# <Title>.*$/m, `# ${long.length > 120 ? `${long.slice(0, 117)}...` : long}`);
  t = swap(t, /^- \*\*Status:\*\* .*$/m, '- **Status:** Planned');
  t = swap(t, /^- \*\*Found while working on:\*\* .*$/m, `- **Found while working on:** ${docsRel}/${slug}/ (${f.where}, ${f.file})`);
  t = swap(t, /^- \*\*Date:\*\* .*$/m, `- **Date:** ${date}`);
  return swap(t, /^## Problem[ \t]*$/m, `## Problem\n${f.severity} finding #${f.id} (${f.where}): ${f.text}\n\nLeft to a discovery by ${by} on ${date} with burhan finding discover: it is row ${f.line} of ${f.file}.`);
}

/** `burhan finding discover <slug> --by <owner name>`: for every finding with no decision (a Critical excepted: it is decided one by one) opens a discovery file from templates/discovery.md
 *  (status Planned, the finding's text and place), adds its line to the discovery index, and records the finding as `discovery` with that file. It never overwrites a discovery file: if one
 *  of the names is taken it refuses before it writes anything. It runs only when the owner asked for it; it is the open form of "ignored means a discovery". */
export function findingDiscover(root: string, slug: string | undefined, o: { by?: string; docs?: string }, io: Io): number {
  const project = realTarget(root);
  const docs = docsLocation(root, o.docs);
  const { slug: s, dir } = itemFolder(docs.abs, slug, 'finding discover');
  const by = person(o.by, 'decides');
  const open = readItemFindings(dir, s).findings.filter((f) => f.decision === '');
  const todo = open.filter((f) => f.severity !== 'Critical');
  const critical = open.filter((f) => f.severity === 'Critical');
  const left = critical.length === 0 ? '' : `Critical findings are never opened this way (#${critical.map((f) => f.id).join(', #')}): the owner fixes each one, or leaves it to a discovery with --outside (burhan finding decide ${s} <n> ...).\n`;
  if (todo.length === 0) { io.stdout(`finding discover: ${open.length === 0 ? 'no finding without a decision' : 'no finding that can be opened this way'}; nothing was written\n${left}`); return 0; }
  const date = today();
  const rel = discoveryDir(project);
  const shown = shownDir(project, rel);
  const folder = join(project, rel);
  const own = join(project, '.burhan', 'templates', 'discovery.md');
  const template = readFileSync(existsSync(own) ? own : join(kitDir(), 'templates', 'discovery.md'), 'utf8');
  const made = todo.map((f) => ({ f, name: `${date}-${s}-finding-${f.id}.md` }));
  for (const m of made) {
    assertInside(project, join(folder, m.name));
    if (existsSync(join(folder, m.name))) throw new BurhanError(`the discovery file ${shown}/${m.name} already exists: finding discover never overwrites one, and wrote nothing (decide finding #${m.f.id} with --discovery ${m.name}, or move the file)`);
  }
  const texts = made.map((m) => ({ ...m, text: discoveryText(template, m.f, s, docs.rel, by, date) }));
  if (existsSync(folder) && !statSync(folder).isDirectory()) throw new BurhanError(`the discovery folder ${rel} is not a folder: finding discover wrote nothing`);
  const indexFile = join(folder, 'README.md');
  const had = readOr(indexFile);
  const title = (t: string): string => /^# (.*)$/m.exec(t)?.[1] ?? '';
  const lines = texts.map((m) => `- ${date} — ${title(m.text)} — Planned (opened by burhan finding discover from ${s}) — ${m.name}`);
  assertInside(project, indexFile);
  const indexText = `${had === null ? '# Discoveries — index\nOne line per discovery: date — what — status — file.\n\n' : had.endsWith('\n') ? had : `${had}\n`}${lines.join('\n')}\n`;
  // Every review file is read, changed in memory and checked as writable BEFORE the first write: a file that cannot be written leaves nothing half done.
  const reviews: { path: string; text: string }[] = [];
  for (const file of new Set(texts.map((m) => m.f.file))) {
    let text = readOr(join(dir, file));
    if (text === null) throw new BurhanError(`${file} cannot be read`);
    for (const m of texts.filter((x) => x.f.file === file)) text = withDecision(text, m.f, 'discovery', m.name, `${by} · ${date}`);
    assertInside(project, join(dir, file));
    try { accessSync(join(dir, file), constants.W_OK); } catch { throw new BurhanError(`${file} cannot be written: finding discover wrote nothing`); }
    reviews.push({ path: join(dir, file), text });
  }
  mkdirSync(folder, { recursive: true });
  const done: { path: string; was: string | null }[] = [];
  const put = (path: string, text: string): void => { done.push({ path, was: readOr(path) }); putFile(path, text); };
  try {
    for (const m of texts) put(join(folder, m.name), m.text);
    put(indexFile, indexText);
    for (const r of reviews) put(r.path, r.text);
  } catch (e) {
    for (const d of done.reverse()) { try { if (d.was === null) rmSync(d.path, { force: true }); else putFile(d.path, d.was); } catch { /* best effort: the next lines say what happened */ } }
    throw new BurhanError(`finding discover could not write everything (${e instanceof Error ? e.message : String(e)}): what it had written was put back`);
  }
  io.stdout(`finding discover: ${texts.length} discovery file${texts.length === 1 ? '' : 's'} opened in ${shown}/ and recorded as the decision of ${by}; it was run from the shell, so the turn-end report lists it as agent-run: it must be what the owner asked for\n`);
  for (const m of texts) io.stdout(`  #${m.f.id} ${m.f.severity} → ${shown}/${m.name}\n`);
  io.stdout(`index: ${texts.length} line${texts.length === 1 ? '' : 's'} added to ${shown}/README.md\n${left}`);
  return 0;
}
