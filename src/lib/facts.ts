import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { accepted, choice, dated, exactRoute, field, fieldLine, filled, given, itemRoute, latestQcFile, read } from './items.js';

export type Independence = 'self' | 'independent' | 'unknown';
export interface PhaseSpan { phase: string; minutes: number | null; tokens: number | null }
export interface ItemFacts {
  slug: string;
  route: string;
  qc: 'PASS' | 'FAIL' | 'unrecorded' | null; // null = no QC file
  qcAccepted: boolean;
  qcBy: Independence | null;                 // null = no QC file
  reopenedAfterPass: boolean;
  escapes: string[];
  phases: PhaseSpan[];
  reviewBy: Independence | null;             // null = no review file
  words: { story: number | null; plan: number | null; qc: number | null; verification: number | null; review: number | null };
}

export function route(typeScope: string): string {
  return exactRoute(typeScope) ?? 'unknown';
}

/** The Verdict field when present (a template placeholder = unrecorded); for a report written before
 *  the field existed, its free text only when the field is absent. */
export function qcVerdict(text: string): 'PASS' | 'FAIL' | 'unrecorded' {
  const raw = field(text, 'Verdict');
  if (raw !== null && raw.replace(/\*/g, '').trim() !== '') {
    const v = choice(raw)?.toUpperCase();
    return v?.startsWith('PASS') ? 'PASS' : v?.startsWith('FAIL') ? 'FAIL' : 'unrecorded';
  }
  const m = /\bverdict\b[^\n]*\n(?:\s*\n)*\s*\**\s*(PASS|FAIL)\b/i.exec(text)
    ?? /\b(?:verdict|result)\b[^\n]{0,60}?\b(PASS|FAIL)\b/i.exec(text)
    ?? /^[\s>*-]*\**\s*(PASS|FAIL)\b/m.exec(text);
  return m ? (m[1].toUpperCase() as 'PASS' | 'FAIL') : 'unrecorded';
}

const SELF = /same[- ]session|implementing agent|by the agent\b|agent-performed|performed by the agent/i;
// Reports written before the Performed by field: only explicit statements about who ran the review
// count — "a subagent read the .env" in an incident story is not provenance.
const PRE_FIELD_INDEPENDENT = /\(subagent\)|\bby an? (fresh |independent )?subagent\b|fresh[- ]subagent|fresh context|by another agent/i;

/** "Performed by: <agent> · <model> · <context>" — the context is exactly one of four values. */
const CONTEXT: Record<string, Independence> = { 'same session': 'self', 'fresh subagent': 'independent', 'other agent': 'independent', human: 'independent' };
/** Exactly "<agent> · <model> · <context>" (asterisks removed first). Same rule as the hook's
 *  PERFORMED in src/hooks/core/turn-audit.mts. */
const PERFORMED = /^[^·<>]*[^·<>\s] · [^·<>]*[^·<>\s] · (fresh subagent|other agent|human|same session)$/;
export const performedBy = (raw: string): Independence => {
  const m = PERFORMED.exec(raw.replace(/\*/g, '').trim());
  return m ? CONTEXT[m[1]] : 'unknown';
};

/** Performed by when present (fixed form; anything else = unknown); a report written before the field
 *  existed is read from its first 15 lines (stats only — no gate reads it). */
export function qcIndependence(text: string): Independence {
  const raw = fieldLine(text, 'Performed by');
  if (raw !== null) return performedBy(raw);
  const head = text.split('\n').slice(0, 15).join('\n');
  return SELF.test(head) ? 'self' : PRE_FIELD_INDEPENDENT.test(head) ? 'independent' : 'unknown';
}

/** "YYYY-MM-DD HH:MM" (H:MM and :SS accepted). A date without a time gives no duration — never a guess. */
const when = (s: string): number | null => {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(:\d{2})?$/.exec(s.trim());
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2].padStart(2, '0')}:${m[3]}${m[4] ?? ''}`);
  return Number.isNaN(ms) ? null : ms;
};

/** "Escapes: `a`, b — found in prod" -> the words that name an existing item folder next to this one,
 *  in order. A positive rule: an explanation word is never an item, whatever the form (backticks,
 *  links, colons, periods). The item itself is not its own escape. */
const slugs = (v: string | null, itemDir: string): string[] => {
  if (v === null) return [];
  const docs = dirname(itemDir); const self = basename(itemDir);
  const isItem = (t: string): boolean => {
    try { return t !== self && existsSync(join(docs, t)) && statSync(join(docs, t)).isDirectory(); } catch { return false; }
  };
  const words = v.match(/[a-z0-9]+(?:[-_.][a-z0-9]+)*/gi) ?? [];
  return [...new Set(words.filter((t) => !t.startsWith('.') && isItem(t)))];
};

/** Rows of the plan's "Phase log" table (phases/close-out.md). */
export function phaseLog(plan: string): PhaseSpan[] {
  const start = plan.search(/^## (\d+\.\s*)?Phase log\s*$/m);
  if (start < 0) return [];
  const out: PhaseSpan[] = [];
  for (const line of plan.slice(start).split('\n').slice(1)) {
    if (/^## /.test(line)) break;
    const c = line.split('|').map((x) => x.trim());
    if (c.length < 5 || c[1] === '' || /^:?-+:?$/.test(c[1]) || c[1].toLowerCase() === 'phase') continue;
    const a = when(c[2]); const b = when(c[3]);
    const tok = c[4].replace(/[,_\s]/g, '');
    out.push({ phase: c[1].toLowerCase(), minutes: a !== null && b !== null && b >= a ? Math.round((b - a) / 60000) : null, tokens: /^\d+$/.test(tok) ? Number(tok) : null });
  }
  return out;
}

/** Words in a file (null when the file is absent) — the measure for the length caps (phases/files.md). */
const wc = (t: string): number | null => {
  if (t === '') return null;
  // The caps exclude code blocks and tables (phases/files.md): drop both before counting.
  const prose = t.replace(/^```[\s\S]*?^```/gm, ' ').split('\n').filter((l) => !/^\s*\|/.test(l)).join('\n');
  return prose.split(/\s+/).filter(Boolean).length;
};

/** The item's review files: the single `<slug>-review.md`, else the old per-sub-unit files
 *  (`<slug>-<anything>.md` except the QC and verification reports). */
export function reviewFiles(dir: string, slug: string): string[] {
  let names: string[];
  try { names = readdirSync(join(dir, 'reviews')); } catch { return []; }
  if (names.includes(`${slug}-review.md`)) return [`${slug}-review.md`];
  return names.filter((n) => n.startsWith(`${slug}-`) && n.endsWith('.md') && !/-(qc|verification)(-r\d+)?\.md$/.test(n)).sort();
}

/** Who reviewed the sub-units: any self-review makes the item self-reviewed; all independent -> independent. */
function reviewIndependence(texts: string[]): Independence | null {
  if (texts.length === 0) return null;
  // Every "Performed by" in every file: one section per sub-unit, each with its own reviewer.
  const by = texts.flatMap((t) => {
    const lines = [...t.matchAll(/\*\*Performed by:\*\*[^\n]*/g)].map((m) => m[0]);
    return lines.length ? lines.map(qcIndependence) : [qcIndependence(t)];
  });
  return by.includes('self') ? 'self' : by.every((b) => b === 'independent') ? 'independent' : 'unknown';
}

export function readFacts(dir: string, slug: string): ItemFacts {
  const story = read(join(dir, `${slug}-story.md`));
  const plan = read(join(dir, `${slug}-implementation-plan.md`));
  const findings = read(join(dir, `${slug}-findings.md`));
  const qc = read(latestQcFile(dir, slug));
  const hasQc = qc !== '';
  const reviews = reviewFiles(dir, slug).map((n) => read(join(dir, 'reviews', n)));
  const typeScope = itemRoute(story, plan, findings) ?? '';
  return {
    slug,
    route: route(typeScope),
    qc: hasQc ? qcVerdict(qc) : null,
    qcAccepted: hasQc && accepted(fieldLine(qc, 'Accepted by')),
    qcBy: hasQc ? qcIndependence(qc) : null,
    reopenedAfterPass: dated(fieldLine(plan, 'Reopened after PASS')),
    escapes: slugs(given(fieldLine(story, 'Escapes')), dir),
    phases: phaseLog(plan),
    reviewBy: reviewIndependence(reviews),
    words: { story: wc(story), plan: wc(plan), qc: wc(qc), verification: wc(read(join(dir, 'reviews', `${slug}-verification.md`))),
             review: reviews.length ? reviews.reduce((a, t) => a + (wc(t) ?? 0), 0) : null },
  };
}
