import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Io } from '../main.js';
import { ledgerSummaryFor, type LedgerSummary } from './evidence.js';
import { readFacts, type ItemFacts } from './facts.js';
import { realTarget } from './fs-safe.js';
import { itemSlugs } from './items.js';
import { docsLocation } from './status.js';

export interface Stats {
  items: number;
  routes: Record<string, number>;
  qc: { reports: number; pass: number; fail: number; unrecorded: number; accepted: number; self: number; independent: number; unknown: number };
  reviews: { items: number; self: number; independent: number; unknown: number };
  escaped: string[];
  phases: Record<string, { n: number; avgMinutes: number | null; avgTokens: number | null }>;
  evidence?: LedgerSummary | null;
  words: Record<'story' | 'plan' | 'qc' | 'verification' | 'review', { n: number; avg: number | null }>;
}

const avg = (xs: number[]): number | null => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export function computeStats(facts: ItemFacts[]): Stats {
  const routes: Record<string, number> = {};
  const qc = { reports: 0, pass: 0, fail: 0, unrecorded: 0, accepted: 0, self: 0, independent: 0, unknown: 0 };
  const reviews = { items: 0, self: 0, independent: 0, unknown: 0 };
  const escaped = new Set<string>();
  const spans: Record<string, { minutes: number[]; tokens: number[]; n: number }> = {};
  for (const f of facts) {
    routes[f.route] = (routes[f.route] ?? 0) + 1;
    if (f.qc !== null) {
      qc.reports++;
      qc[f.qc === 'PASS' ? 'pass' : f.qc === 'FAIL' ? 'fail' : 'unrecorded']++;
      if (f.qcAccepted) qc.accepted++;
      qc[f.qcBy ?? 'unknown']++;
    }
    if (f.reviewBy !== null) { reviews.items++; reviews[f.reviewBy]++; }
    if (f.reopenedAfterPass) escaped.add(f.slug);
    for (const e of f.escapes) escaped.add(e);
    for (const p of f.phases) {
      const s = (spans[p.phase] ??= { minutes: [], tokens: [], n: 0 });
      s.n++;
      if (p.minutes !== null) s.minutes.push(p.minutes);
      if (p.tokens !== null) s.tokens.push(p.tokens);
    }
  }
  const phases = Object.fromEntries(Object.entries(spans).map(([k, v]) => [k, { n: v.n, avgMinutes: avg(v.minutes), avgTokens: avg(v.tokens) }]));
  const kinds = ['story', 'plan', 'qc', 'verification', 'review'] as const;
  const words = Object.fromEntries(kinds.map((k) => {
    const xs = facts.map((f) => f.words[k]).filter((x): x is number => x !== null);
    return [k, { n: xs.length, avg: avg(xs) }];
  })) as Stats['words'];
  return { items: facts.length, routes, qc, reviews, escaped: [...escaped].sort(), phases, words };
}

export function renderStats(s: Stats, docsRel: string): string {
  const routes = Object.entries(s.routes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const w = Math.max(10, ...routes.map(([r]) => r.length));
  const q = s.qc;
  const lines = [
    `burhan stats — ${docsRel} · ${s.items} items`,
    '',
    'Routes',
    ...routes.map(([r, n]) => `  ${r.padEnd(w)}  ${n}`),
    '',
    `QC reports: ${q.reports} — PASS ${q.pass} · FAIL ${q.fail} · unrecorded ${q.unrecorded} · accepted by a human ${q.accepted}`,
    `QC performed by: self ${q.self} · independent ${q.independent} · unknown ${q.unknown}  (self = same session / the implementing agent)`,
    `Reviews performed by: self ${s.reviews.self} · independent ${s.reviews.independent} · unknown ${s.reviews.unknown}  (${s.reviews.items} items with a review file)`,
    `Escaped defects after QC PASS: ${s.escaped.length}${s.escaped.length ? ' — ' + s.escaped.join(', ') : ''}`,
    '',
    'Phase timing (plan "Phase log")',
    ...(Object.keys(s.phases).length
      ? Object.entries(s.phases).map(([p, v]) => `  ${p.padEnd(12)} rows ${v.n} · avg ${v.avgMinutes ?? '—'} min · avg ${v.avgTokens ?? '—'} tokens`)
      : ['  no Phase log rows yet']),
    '',
    `File size (avg words, caps in phases/files.md): ${(['story', 'plan', 'review', 'qc', 'verification'] as const).map((k) => `${k} ${s.words[k].avg ?? '—'} (n=${s.words[k].n})`).join(' · ')}`,
    '',
    s.evidence
      ? `Evidence ledger: ${s.evidence.commands} commands (${s.evidence.failed} failed) · evidence runs ${s.evidence.evidenceRuns}, passed ${s.evidence.evidencePassed} · items with a passing evidence run: ${s.evidence.itemsWithPassingEvidence.length}`
      : 'Evidence ledger: nothing recorded yet',
  ];
  return lines.join('\n') + '\n';
}

export function stats(o: { target: string; docs?: string; json: boolean }, io: Io): number {
  const target = realTarget(o.target);
  const { rel, abs } = docsLocation(target, o.docs);
  if (!existsSync(abs)) {
    const ev = ledgerSummaryFor(target);
    io.stdout(`no work items under ${rel}/\n` + (ev ? `Evidence ledger: ${ev.commands} commands (${ev.failed} failed) · evidence runs ${ev.evidenceRuns}, passed ${ev.evidencePassed}\n` : ''));
    return 0;
  }
  const s = { ...computeStats(itemSlugs(abs).map((slug) => readFacts(join(abs, slug), slug))), evidence: ledgerSummaryFor(target) };
  io.stdout(o.json ? JSON.stringify(s, null, 2) + '\n' : renderStats(s, rel));
  return 0;
}
