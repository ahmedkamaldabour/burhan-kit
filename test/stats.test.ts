import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeStats, renderStats } from '../src/lib/stats.js';
import type { ItemFacts } from '../src/lib/facts.js';
import { runCli } from '../src/main.js';
import { capture } from './helpers.js';

const f = (o: Partial<ItemFacts> & { slug: string }): ItemFacts =>
  ({ route: 'unknown', qc: null, qcAccepted: false, qcBy: null, reopenedAfterPass: false, escapes: [], phases: [], reviewBy: null, words: { story: null, plan: null, qc: null, verification: null, review: null }, ...o });

test('computeStats aggregates routes, QC, independence, escapes and phase timing', () => {
  const s = computeStats([
    f({ slug: 'a', route: 'feature / bounded', qc: 'PASS', qcAccepted: true, qcBy: 'self', phases: [{ phase: 'plan', minutes: 30, tokens: 1000 }] }),
    f({ slug: 'b', route: 'feature / bounded', qc: 'FAIL', qcBy: 'independent', reopenedAfterPass: true, phases: [{ phase: 'plan', minutes: 60, tokens: null }] }),
    f({ slug: 'c', route: 'bug / bounded', qc: 'unrecorded', qcBy: 'unknown', escapes: ['a'] }),
    f({ slug: 'd' }),
  ]);
  assert.equal(s.items, 4);
  assert.deepEqual(s.routes, { 'feature / bounded': 2, 'bug / bounded': 1, unknown: 1 });
  assert.deepEqual(s.qc, { reports: 3, pass: 1, fail: 1, unrecorded: 1, accepted: 1, self: 1, independent: 1, unknown: 1 });
  assert.deepEqual(s.escaped, ['a', 'b']);
  assert.deepEqual(s.phases, { plan: { n: 2, avgMinutes: 45, avgTokens: 1000 } });
  const w = computeStats([f({ slug: 'a', words: { story: 100, plan: 300, qc: null, verification: null, review: 80 } }), f({ slug: 'b', words: { story: 200, plan: null, qc: null, verification: null, review: null } })]).words;
  assert.deepEqual(w, { story: { n: 2, avg: 150 }, plan: { n: 1, avg: 300 }, qc: { n: 0, avg: null }, verification: { n: 0, avg: null }, review: { n: 1, avg: 80 } });
  assert.deepEqual(computeStats([f({ slug: 'a', reviewBy: 'independent' }), f({ slug: 'b', reviewBy: 'self' }), f({ slug: 'c' })]).reviews,
    { items: 2, self: 1, independent: 1, unknown: 0 }, 'reviews performed by');
});

test('renderStats is plain text with every section', () => {
  const out = renderStats(computeStats([f({ slug: 'a', route: 'bug / bounded', qc: 'PASS', qcBy: 'self' })]), 'docs');
  for (const s of ['burhan stats — docs · 1 items', 'bug / bounded', 'QC reports: 1', 'self 1', 'Reviews performed by', 'Escaped defects after QC PASS: 0', 'Phase timing']) assert.ok(out.includes(s), s);
});

test('CLI: stats --docs on a project without burhan config, and --json', async () => {
  const p = mkdtempSync(join(tmpdir(), 'burhan-stats-'));
  mkdirSync(join(p, 'AI/items/x/reviews'), { recursive: true });
  writeFileSync(join(p, 'AI/items/x/x-story.md'), '- **Type / scope:** change / bounded\n');
  writeFileSync(join(p, 'AI/items/x/reviews/x-qc.md'), '- **Reviewed:** by the implementing agent\n\n**PASS**\n');
  const a = capture();
  assert.equal(await runCli(['stats', p, '--docs', 'AI/items'], a.io), 0);
  assert.match(a.o.out, /change \/ bounded\s+1/);
  assert.match(a.o.out, /self 1/);
  const b = capture();
  assert.equal(await runCli(['stats', p, '--docs', 'AI/items', '--json'], b.io), 0);
  assert.equal(JSON.parse(b.o.out).qc.pass, 1);
});

test('CLI: --docs may be absolute inside the project, never outside it', async () => {
  const p = mkdtempSync(join(tmpdir(), 'burhan-stats-'));
  mkdirSync(join(p, 'items/x'), { recursive: true });
  const a = capture();
  assert.equal(await runCli(['stats', p, '--docs', join(p, 'items')], a.io), 0);
  assert.match(a.o.out, /· 1 items/);
  const b = capture();
  assert.equal(await runCli(['stats', p, '--docs', '..'], b.io), 2);
  assert.match(b.o.err, /inside the project/);
  const c = capture();
  assert.equal(await runCli(['status', p, '--docs', '../elsewhere', '--write'], c.io), 2);
  writeFileSync(join(p, 'a-file'), 'x');
  const e = capture();
  assert.equal(await runCli(['stats', p, '--docs', 'a-file'], e.io), 2, 'a file, not a folder: clear error, no stack trace');
  assert.match(e.o.err, /not a directory/);
  const outside = mkdtempSync(join(tmpdir(), 'burhan-outside-'));
  symlinkSync(outside, join(p, 'linked'));
  const g = capture();
  assert.equal(await runCli(['status', p, '--docs', 'linked', '--write'], g.io), 2, 'a symlink out of the project is refused');
  assert.ok(!existsSync(join(outside, 'README.md')));
});

test('CLI: no docs directory -> says so, exit 0', async () => {
  const p = mkdtempSync(join(tmpdir(), 'burhan-stats-'));
  const { o, io } = capture(p);
  assert.equal(await runCli(['stats'], io), 0);
  assert.match(o.out, /no work items/);
});
