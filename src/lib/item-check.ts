import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Io } from '../main.js';
import { checkText, crossCheck, hasContractMarker, kindOf, storyIsApproved, type Fault, type Kind } from '../hooks/core/item-contract.mjs';
import { BurhanError } from './errors.js';
import { overallStatus, readOr } from './item-files.js';
import { isSlug, SLUG_RULE } from './item-io.js';
import { placeholderReport } from './placeholders.js';
import { docsLocation } from './status.js';

export interface FileResult { file: string; kind: Kind; legacy: boolean; faults: Fault[] }

/** Every item file of `<docs>/<slug>/` (the folder itself and its reviews/) checked against the contract. A file with no
 *  `**Contract:** 1` line is legacy: its faults are advice, never a failure. */
export function checkItem(docsAbs: string, slug: string, project?: string): FileResult[] {
  const dir = join(docsAbs, slug);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new BurhanError(`item "${slug}" has no folder under the docs location`);
  const results: FileResult[] = [];
  for (const sub of ['', 'reviews']) {
    let names: string[] = [];
    try { names = readdirSync(join(dir, sub)).sort(); } catch { /* no reviews folder yet */ }
    for (const name of names) {
      const file = sub === '' ? name : `${sub}/${name}`;
      const kind = kindOf(file);
      if (kind === null) continue;
      let text: string;
      try {
        if (!lstatSync(join(dir, file)).isFile()) continue; // a folder or a link named like an item file is not one
        text = readFileSync(join(dir, file), 'utf8');
      } catch (error) {
        results.push({ file, kind, legacy: false, faults: [{ code: 'unreadable', message: `could not be read: ${(error as NodeJS.ErrnoException).code ?? 'error'}` }] });
        continue;
      }
      results.push({ file, kind, legacy: !hasContractMarker(text), faults: checkText(kind, text) });
    }
  }
  // The checks that read more than one file: only for a plan made with the contract (an old plan is advice only).
  const plan = results.find((r) => r.kind === 'plan');
  if (plan !== undefined && !plan.legacy) {
    const text = (f: string): string | null => readOr(join(dir, f));
    const spec = results.find((r) => r.kind === 'build-spec');
    if (spec === undefined) plan.faults.push({ code: 'spec-missing', message: `the plan names a build spec (${slug}-build-spec.md) and there is none` });
    plan.faults.push(...crossCheck({ story: text(`${slug}-story.md`), plan: text(plan.file) ?? '', spec: spec === undefined ? null : text(spec.file) }));
  }
  // Placeholders of the templates: only once the file is approved (an item under construction may have them).
  if (project !== undefined && plan !== undefined && !plan.legacy) {
    const planText = readOr(join(dir, plan.file)) ?? '';
    const status = overallStatus(planText);
    const underway = status === 'Approved' || status === 'In progress' || status === 'Completed';
    const flag = (r: FileResult | undefined, template: 'story' | 'plan' | 'build-spec'): void => {
      if (r === undefined || r.legacy) return;
      const text = readOr(join(dir, r.file));
      const report = text === null ? null : placeholderReport(project, text, template);
      if (report !== null) r.faults.push({ code: 'placeholder-left', message: report });
    };
    if (underway) { flag(plan, 'plan'); flag(results.find((r) => r.kind === 'build-spec'), 'build-spec'); }
    const story = results.find((r) => r.kind === 'story');
    const storyText = story === undefined ? null : readOr(join(dir, story.file));
    if (story !== undefined && storyText !== null && storyIsApproved(storyText)) flag(story, 'story');
  }
  // A concluded findings file: the same check against the findings template.
  const findings = results.find((r) => r.kind === 'findings');
  if (project !== undefined && findings !== undefined && !findings.legacy) {
    const text = readOr(join(dir, findings.file));
    if (text !== null && /^- \*\*Status:\*\*[ \t]*Concluded/m.test(text)) {
      const report = placeholderReport(project, text, 'findings');
      if (report !== null) findings.faults.push({ code: 'placeholder-left', message: report });
    }
  }
  return results;
}

/** `burhan item check <slug>`: prints every fault by name; exit 1 only when a file that carries the marker has one. */
export function itemCheck(target: string, slug: string | undefined, io: Io, docs?: string): number {
  if (!isSlug(slug)) throw new BurhanError(`item check needs one item slug (${SLUG_RULE})`);
  const results = checkItem(docsLocation(target, docs).abs, slug, target);
  const faulty = results.filter((r) => r.faults.length > 0);
  if (faulty.length === 0) {
    io.stdout(`item check: ok — ${slug} (${results.length} file${results.length === 1 ? '' : 's'})\n`);
    return 0;
  }
  for (const r of faulty) {
    io.stdout(`${r.file} (${r.kind}${r.legacy ? ', legacy: no **Contract:** 1, so advice only' : ''})\n`);
    for (const f of r.faults) io.stdout(`  ${f.code}: ${f.message}\n`);
  }
  const failing = faulty.filter((r) => !r.legacy).length;
  io.stdout(`item check: ${failing} file${failing === 1 ? '' : 's'} fail${failing === 1 ? 's' : ''}, ${faulty.length - failing} legacy with advice\n`);
  return failing > 0 ? 1 : 0;
}
