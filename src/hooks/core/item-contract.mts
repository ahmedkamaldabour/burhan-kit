/** The written contract for the files of a work item: text in, named faults out. Pure — no file access — so the CLI (`burhan item check`,
 *  and the commands that write these files) and the hooks ask the same question and get the same answer. It imports only its sibling
 *  `item-model.mts`: hook files are copied into projects (src/hooks/core/lib.mts). */
import { deviations, fenced, routeNeeds, units as planUnits } from './item-model.mjs';

/** Written into a file by `burhan item new`; a file without it is legacy: checked as advice, never failed (AC-08). */
export const CONTRACT_VERSION = 1;

export type Kind = 'story' | 'plan' | 'build-spec' | 'review' | 'qc' | 'verification' | 'findings';
export interface Fault { code: string; message: string }

const ROUTE = /^(feature|bug|investigation|change|refactor|release) \/ (spike|bounded|architectural|patch)$/;
const PLAN_STATUS = ['Draft', 'Approved', 'In progress', 'Completed', 'Paused', 'Superseded'];
const BUILT_PLAN = ['Approved', 'In progress', 'Completed'];
const SUB_UNIT_STATUS = /· (⬜ Draft|🟡 Approved|🔵 In progress|🟢 Implemented|✅ Reviewed)\s*$/;
const CONTEXTS = ['fresh subagent', 'other agent', 'human', 'same session'];
/** Any line break or control character, including U+0085, U+2028 and U+2029, which a line-based reader may take for a line end. */
const CONTROL = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;

/** "<agent> · <model> · <context>": split, not matched, so a long line costs time in proportion to its length. */
export function performedOk(by: string): boolean {
  if (CONTROL.test(by)) return false;
  const parts = by.split(' · ');
  return parts.length === 3 && parts.every((p) => p.trim() !== '' && !/[<>·]/.test(p)) && CONTEXTS.includes(parts[2]!);
}

/** "Approved — <name> · YYYY-MM-DD" with a real date and a name that has a letter. */
function approvedOk(status: string): boolean {
  if (!status.startsWith('Approved — ')) return false;
  const at = status.lastIndexOf(' · ');
  if (at === -1) return false;
  const name = status.slice('Approved — '.length, at);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(status.slice(at + 3));
  return m !== null && name !== '' && !/[<·]/.test(name) && /\p{L}/u.test(name) && realDate(m[1]!, m[2]!, m[3]!);
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The value of `**Label:**` up to the next " · " (the way a decision-card line holds several fields), or null. */
function field(text: string, label: string): string | null {
  const m = new RegExp(`\\*\\*${escape(label)}:\\*\\*[ \\t]*([^·\\n]*)`).exec(text);
  return m ? m[1]!.replace(/\*/g, '').trim() : null;
}
/** The whole rest of the line, for a value that itself holds " · ". */
function fieldLine(text: string, label: string): string | null {
  const m = new RegExp(`\\*\\*${escape(label)}:\\*\\*[ \\t]*([^\\n]*)`).exec(text);
  return m ? m[1]!.replace(/\*/g, '').replace(/\r$/, '').trim() : null;
}

const realDate = (y: string, m: string, d: string): boolean => {
  const date = new Date(Date.UTC(+y, +m - 1, +d));
  return date.getUTCMonth() === +m - 1 && date.getUTCDate() === +d;
};

/** The body of a `## ` section by its title (`## 5. Security re-read` and `## Security re-read` both match), or null when absent. */
function section(text: string, title: string): string | null {
  const lines = text.split('\n');
  const head = new RegExp(`^##[ \\t]+(?:\\d+\\.[ \\t]+)?${escape(title)}[ \\t]*$`, 'i');
  const start = lines.findIndex((l) => head.test(l.replace(/\r$/, '')));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return rest.slice(0, end === -1 ? undefined : end).join('\n');
}

/** What kind of item file a project-relative path is, by its name. */
export function kindOf(file: string): Kind | null {
  const f = file.replace(/\\/g, '/');
  const inReviews = /(^|\/)reviews\/[^/]+$/.test(f);
  if (inReviews) {
    if (/-qc(-r\d+)?\.md$/.test(f)) return 'qc';
    if (/-verification\.md$/.test(f)) return 'verification';
    if (/-review\.md$/.test(f)) return 'review';
    return null;
  }
  if (/-implementation-plan\.md$/.test(f)) return 'plan';
  if (/-build-spec\.md$/.test(f)) return 'build-spec';
  if (/-story\.md$/.test(f)) return 'story';
  if (/-findings\.md$/.test(f)) return 'findings';
  return null;
}

/** Is the story's Status exactly "Approved — <name> · YYYY-MM-DD"? */
export function storyIsApproved(text: string): boolean {
  const status = fieldLine(unfenced(text), 'Status');
  return status !== null && approvedOk(status);
}

/** The marker is a line of its own: "- **Contract:** 1". A mention in prose, or the line inside a code block, is not the marker. */
export function hasContractMarker(text: string): boolean {
  const lines = text.split('\n');
  const inFence = fenced(lines);
  return lines.some((l, i) => !inFence[i] && /^- \*\*Contract:\*\*[ \t]*1(?![\w.-])/.test(l.replace(/\r$/, '')));
}

function routeFault(text: string): { faults: Fault[]; scope: string | null; route: string } {
  const route = field(text, 'Route');
  const m = route === null ? null : ROUTE.exec(route);
  if (m) return { faults: [], scope: m[2]!, route: `${m[1]} / ${m[2]}` };
  return { faults: [{ code: 'route-invalid', message: '**Route:** is missing or not exactly "<type> / <scope>" (for example "feature / architectural")' }], scope: null, route: '' };
}

function checkPlan(text: string): Fault[] {
  const out: Fault[] = [];
  const route = routeFault(text);
  out.push(...route.faults);

  const overall = field(text, 'Overall status');
  if (overall === null) {
    const status = field(text, 'Status');
    out.push({ code: 'plan-overall-status-missing', message: status !== null
      ? 'found `**Status:**`, expected `**Overall status:**` — the hooks and `burhan status` read only the second label'
      : '`**Overall status:**` is missing (Draft, Approved, In progress, Completed, Paused or Superseded)' });
  } else if (!PLAN_STATUS.includes(overall)) {
    out.push({ code: 'plan-overall-status-invalid', message: `\`**Overall status:** ${overall}\` is not one of ${PLAN_STATUS.join(', ')}` });
  }

  const storyRoute = route.route !== '' && routeNeeds(route.route).story;
  const needed = ['Gate checklist', 'Sub-unit breakdown', 'Executor rules', 'Deviations', ...(storyRoute ? ['AC coverage'] : []), ...(route.scope === 'architectural' ? ['Security re-read', 'Verification steps', 'Limitations', 'Knowledge review'] : [])];
  for (const title of needed) {
    if (section(text, title) === null) out.push({ code: 'plan-section-missing', message: `section missing: "## ${title}"${route.scope === 'architectural' ? ' (an architectural plan needs it)' : ''}` });
  }

  const breakdown = section(text, 'Sub-unit breakdown');
  if (breakdown !== null) {
    const headings = breakdown.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => /^### Sub-unit\b/.test(l));
    if (headings.length === 0) out.push({ code: 'plan-no-subunits', message: 'the sub-unit breakdown has no "### Sub-unit N — name · <status>" heading' });
    for (const h of headings) {
      if (!SUB_UNIT_STATUS.test(h)) out.push({ code: 'plan-subunit-status', message: `a sub-unit heading has no status from the ladder (⬜ Draft, 🟡 Approved, 🔵 In progress, 🟢 Implemented, ✅ Reviewed): "${h}"` });
    }
    if (storyRoute) {
      // each sub-unit says which ACs it covers: a "**Covers:**" line before the next heading (one pass over the lines)
      let current: string | null = null;
      let has = false;
      const flush = (): void => { if (current !== null && !has) out.push({ code: 'plan-subunit-covers', message: `${current.replace(/ · .*$/, '')} has no "- **Covers:** AC-…" line` }); };
      for (const raw of breakdown.split('\n')) {
        const l = raw.replace(/\r$/, '');
        if (/^### Sub-unit\b/.test(l)) { flush(); current = l; has = false; }
        else if (/^###? /.test(l)) { flush(); current = null; }
        else if (current !== null && /^- \*\*Covers:\*\*[ \t]*\S/.test(l)) has = true;
      }
      flush();
    }
  }

  const seen = new Set<number>();
  for (const d of deviations(text)) {
    if (seen.has(d.n)) out.push({ code: 'deviation-duplicate', message: `Deviations row number ${d.n} is used twice: the rows are numbered once, in order` });
    seen.add(d.n);
    if (!['open', 'approved', 'rejected'].includes(d.status)) out.push({ code: 'deviation-status', message: `Deviations row ${d.n}: status "${d.status}" is not open, approved or rejected` });
    else if (d.unit < 0 || d.what === '' || d.where === '' || d.output === '' || (d.status !== 'open' && d.decision === '')) out.push({ code: 'deviation-incomplete', message: `Deviations row ${d.n} has an empty field (sub-unit, what, where, output${d.status === 'open' ? '' : ', decision'})` });
    if (d.status === 'open') out.push({ code: 'deviation-open', message: `Deviations row ${d.n} (sub-unit ${d.unit}) is open: STOP and ask the owner — ${d.what}` });
  }

  const gates = section(text, 'Gate checklist');
  if (gates !== null) {
    if (!/^[ \t]*- \[[ xX]\]/m.test(gates)) out.push({ code: 'plan-gate-checklist-empty', message: 'the gate checklist has no "- [ ]" or "- [x]" line' });
    else if (overall !== null && BUILT_PLAN.includes(overall) && /^[ \t]*- \[ \][ \t]+Plan approved/im.test(gates)) {
      out.push({ code: 'plan-gate-unticked', message: `the plan is ${overall} but the gate "Plan approved" is not ticked` });
    }
  }
  return out;
}

function checkStory(text: string): Fault[] {
  const out: Fault[] = [];
  out.push(...routeFault(text).faults);
  const status = fieldLine(text, 'Status');
  if (status === null) out.push({ code: 'story-status-missing', message: '`**Status:**` is missing (Draft, or Approved — <name> · YYYY-MM-DD)' });
  else if (status.startsWith('Approved')) {
    if (!approvedOk(status)) out.push({ code: 'story-approval-form', message: `an approved story says who and when in the exact form "Approved — <name> · YYYY-MM-DD", not "${status}"` });
  } else if (status !== 'Draft') out.push({ code: 'story-status-invalid', message: `\`**Status:** ${status}\` is not Draft or Approved` });
  if (!/^\|[ \t]*AC-\d+[ \t]*\|/m.test(text)) out.push({ code: 'story-no-acceptance-criteria', message: 'no acceptance criterion row (a table row starting "| AC-01 |")' });
  return out;
}

function checkPerformed(text: string): Fault[] {
  // Only a line that is the field: `- **Performed by:** …`, or the review header `- **Date:** … · **Performed by:** …`; a finding that quotes the label is not one.
  const lines = text.split('\n').filter((l) => l.startsWith('- **Performed by:**') || (l.startsWith('- **Date:**') && l.includes(' · **Performed by:**')));
  if (lines.length === 0) return [{ code: 'performed-by-missing', message: '`**Performed by:**` is missing (<agent> · <model> · fresh subagent / other agent / human / same session)' }];
  const out: Fault[] = [];
  for (const line of lines) {
    const by = line.replace(/^.*\*\*Performed by:\*\*[ \t]*/, '').replace(/[*\r]/g, '').trim();
    if (!performedOk(by)) out.push({ code: 'performed-by-form', message: `Performed by is not "<agent> · <model> · fresh subagent / other agent / human / same session": "${by}"` });
  }
  return out;
}

function checkQc(text: string): Fault[] {
  const out = checkPerformed(text);
  const verdict = fieldLine(text, 'Verdict') ?? '';
  // the unfilled template value "PASS | FAIL — N issues" is no verdict, and neither is "PASSWORD"
  if (verdict.includes(' | ') || !/^(PASS|FAIL)(?![A-Za-z0-9_])/.test(verdict)) out.push({ code: 'qc-verdict-missing', message: '`**Verdict:**` is missing, still the template value, or does not start with PASS or FAIL' });
  return out;
}

function checkFindings(text: string): Fault[] {
  const out = routeFault(text).faults;
  const status = field(text, 'Status');
  if (status === null || !['In progress', 'Concluded'].some((s) => status.startsWith(s))) out.push({ code: 'findings-status-invalid', message: '`**Status:**` is missing or not In progress / Concluded' });
  return out;
}

// ---- the build spec: the code per sub-unit ---------------------------------------------------------------------------------------
const SPEC_PARTS: Array<{ name: string; titles: RegExp }> = [
  { name: 'Files', titles: /^### Files\b/i }, { name: 'Test', titles: /^### Test\b/i }, { name: 'RED', titles: /^### RED\b/i },
  { name: 'Implementation (or Edit)', titles: /^### (Implementation|Edit)\b/i }, { name: 'GREEN', titles: /^### GREEN\b/i },
  { name: 'Lint', titles: /^### Lint\b/i }, { name: 'Interfaces', titles: /^### Interfaces\b/i },
];

interface SpecUnit { n: number; parts: Array<{ title: string; body: string[] }> }
/** The sub-unit sections of a spec ("## Sub-unit N") and their "###" parts; headings inside a code block are not read. */
function specUnits(text: string): SpecUnit[] {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const inFence = fenced(lines);
  const out: SpecUnit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = !inFence[i] ? /^## Sub-unit (\d+)\b/.exec(lines[i]!) : null;
    if (!h) continue;
    const unit: SpecUnit = { n: Number(h[1]), parts: [] };
    for (let j = i + 1; j < lines.length && !(!inFence[j] && /^## /.test(lines[j]!)); j++) {
      if (!inFence[j] && /^### /.test(lines[j]!)) unit.parts.push({ title: lines[j]!, body: [] });
      else unit.parts[unit.parts.length - 1]?.body.push(lines[j]!);
    }
    out.push(unit);
  }
  return out;
}

function checkSpec(text: string): Fault[] {
  const out: Fault[] = [];
  if (section(unfenced(text), 'Not verified') === null) out.push({ code: 'spec-section-missing', message: 'section missing: "## Not verified" (what the planner could not check; "None." when everything was read)' });
  const all = specUnits(text);
  if (all.length === 0) { out.push({ code: 'spec-no-subunits', message: 'the spec has no "## Sub-unit N — name" section' }); return out; }
  for (const u of all) {
    const found = SPEC_PARTS.map((p) => ({ p, part: u.parts.find((x) => p.titles.test(x.title)) }));
    const missing = found.filter((f) => f.part === undefined).map((f) => f.p.name);
    for (const name of missing) out.push({ code: 'spec-part-missing', message: `Sub-unit ${u.n} has no "### ${name}" part` });
    for (const f of found) {
      if (f.part === undefined) continue;
      const body = f.part.body.join('\n');
      if ((f.p.name === 'Test' || f.p.name.startsWith('Implementation')) && !/^[ \t]*(```|~~~)/m.test(body)) out.push({ code: 'spec-code-missing', message: `Sub-unit ${u.n}: "${f.p.name}" has no code block (the complete code goes in a fenced block)` });
      const lacks: string[] = [];
      if (['RED', 'GREEN', 'Lint'].includes(f.p.name) && !/\*\*Command:\*\*/.test(body)) lacks.push('**Command:**');
      if (['RED', 'GREEN'].includes(f.p.name) && !/\*\*Expected output:\*\*/.test(body)) lacks.push('**Expected output:**');
      if (lacks.length > 0) out.push({ code: 'spec-part-incomplete', message: `Sub-unit ${u.n}: "${f.p.name}" lacks ${lacks.join(' and ')}` });
    }
  }
  return out;
}

// ---- checks that read more than one file ----------------------------------------------------------------------------------------
const rows = (body: string): string[][] => body.split('\n').filter((l) => /^\|/.test(l.trim())).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));

/** The AC numbers a cell names: `AC-01`, `AC-1`, `**AC-01**`, several in a row, or a range (`AC-01 to AC-04`, `AC-01–AC-04`). */
function acNumbers(cell: string): number[] {
  const text = cell.replace(/\*/g, '');
  const out: number[] = [];
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(/AC-(\d+)\s*(?:to|–|—|\.\.|-)\s*(?:AC-)?(\d+)/gi)) {
    const from = Number(m[1]); const to = Number(m[2]);
    for (let n = from; n <= to && n - from < 1000; n++) out.push(n);
    spans.push([m.index!, m.index! + m[0].length]);
  }
  for (const m of text.matchAll(/AC-(\d+)/gi)) if (!spans.some(([s, e]) => m.index! >= s && m.index! < e)) out.push(Number(m[1]));
  return out;
}

/** The AC ids of a story's acceptance-criteria table, as written, with their numbers. */
function storyAcs(story: string): Array<{ label: string; n: number }> {
  const lines = story.split('\n');
  const inFence = fenced(lines);
  const out: Array<{ label: string; n: number }> = [];
  lines.forEach((l, i) => { const m = !inFence[i] ? /^\|[ \t]*\**(AC-(\d+))\**[ \t]*\|/.exec(l) : null; if (m) out.push({ label: m[1]!, n: Number(m[2]) }); });
  return out;
}

const COVERAGE_SHAPE = 'columns: AC | Sub-unit | Test (file → test name); several ACs or a range may share a row';

/** Story against the plan's coverage table, and the plan's sub-units against the spec's: faults none of the single-file checks can see. */
export function crossCheck(files: { story: string | null; plan: string; spec: string | null }): Fault[] {
  const out: Fault[] = [];
  const planText = unfenced(files.plan);
  const unitNumbers = planUnits(files.plan).map((u) => u.n);
  const coverage = section(planText, 'AC coverage');
  if (files.story !== null && coverage !== null) {
    const table = rows(coverage).map((cells) => ({ cells, acs: acNumbers(cells[0] ?? '') })).filter((r) => r.acs.length > 0);
    const covered = new Set(table.flatMap((r) => r.acs));
    for (const ac of storyAcs(files.story)) if (!covered.has(ac.n)) out.push({ code: 'cover-ac-missing', message: `${ac.label} of the story is not in the plan's "AC coverage" table (${COVERAGE_SHAPE})` });
    for (const r of table) {
      const label = `AC-${String(r.acs[0]).padStart(2, '0')}`;
      if (r.cells.slice(2).join('').trim() === '') out.push({ code: 'cover-no-test', message: `${label} is in the coverage table with no test (file → test name)` });
      const named = (r.cells[1] ?? '').match(/\d+/g)?.map(Number) ?? [];
      if (named.length === 0 || named.some((n) => !unitNumbers.includes(n))) out.push({ code: 'cover-unit-unknown', message: `${label} is covered by "${r.cells[1] ?? ''}", which is not a sub-unit of the plan (${COVERAGE_SHAPE})` });
    }
  }
  if (files.spec !== null) {
    const specNumbers = specUnits(files.spec).map((u) => u.n);
    for (const n of unitNumbers) if (!specNumbers.includes(n)) out.push({ code: 'cross-unit-no-spec', message: `Sub-unit ${n} of the plan has no section in the build spec` });
    for (const n of specNumbers) if (!unitNumbers.includes(n)) out.push({ code: 'cross-spec-no-unit', message: `Sub-unit ${n} of the build spec is not a sub-unit of the plan` });
  }
  return out;
}

/** The text without fenced code blocks: a heading or a label shown as an example in a fence is not part of the file's shape. */
const unfenced = (text: string): string => { const lines = text.split('\n'); const flags = fenced(lines); return lines.filter((_, i) => !flags[i]).join('\n'); };

/** Every fault the contract finds in one file's text, in a stable order; none means the file follows it. */
export function checkText(kind: Kind, original: string): Fault[] {
  const text = unfenced(original);
  switch (kind) {
    case 'build-spec': return checkSpec(original);
    case 'plan': return checkPlan(text);
    case 'story': return checkStory(text);
    case 'review': case 'verification': return checkPerformed(text);
    case 'qc': return checkQc(text);
    case 'findings': return checkFindings(text);
  }
}
