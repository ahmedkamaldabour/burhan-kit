import { test } from 'node:test';
import { readFacts } from '../src/lib/facts.js';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { field, listItems, readItem, renderIndex } from '../src/lib/items.js';
import { kitDir } from '../src/lib/kit.js';

const tpl = (n: string) => readFileSync(join(kitDir(), 'templates', n), 'utf8');

function item(files: Record<string, string>): string {
  const docs = mkdtempSync(join(tmpdir(), 'burhan-docs-'));
  mkdirSync(join(docs, 'foo/reviews'), { recursive: true });
  for (const [n, t] of Object.entries(files)) writeFileSync(join(docs, 'foo', n), t);
  return docs;
}
const state = (files: Record<string, string>) => { const d = item(files); return readItem(join(d, 'foo'), 'foo', d).state; };

test('field reads a bold label up to the next · or end of line', () => {
  const t = '- **Parent:** bar · **Answers for:** AC-01 · **Depends on:** baz, qux\n';
  assert.equal(field(t, 'Parent'), 'bar');
  assert.equal(field(t, 'Depends on'), 'baz, qux');
  assert.equal(field(t, 'Missing'), null);
});

test('unfilled templates read as Draft with empty columns', () => {
  const d = item({ 'foo-story.md': tpl('story.md'), 'foo-implementation-plan.md': tpl('plan.md') });
  assert.deepEqual(readItem(join(d, 'foo'), 'foo', d), { slug: 'foo', typeScope: '—', parent: '—', dependsOn: '—', state: 'Draft', lastActivity: '—' });
});

test('state derivation follows the status vocabulary in phases/close-out.md', () => {
  const story = (s: string, route = 'feature / bounded') => `- **Status:** ${s}\n- **Type / scope:** ${route}\n`;
  const plan = (s: string) => `- **Overall status:** ${s}\n`;
  const qc = (v: string, by = '<the human and date — filled only after they accept the verdict (WORKFLOW §6-D)>') => `- **Date:** x · **Verdict:** ${v}\n- **Accepted by:** ${by}\n`;
  assert.equal(state({ 'foo-story.md': story('Approved') }), 'Spec ready');
  assert.equal(state({ 'foo-story.md': story('Approved'), 'foo-implementation-plan.md': plan('Approved') }), 'Plan ready');
  assert.equal(state({ 'foo-implementation-plan.md': plan('In progress') }), 'In progress');
  assert.equal(state({ 'foo-story.md': story('Approved'), 'foo-implementation-plan.md': plan('Completed') }), 'Awaiting QC', 'Q route, no QC yet');
  assert.equal(state({ 'foo-story.md': story('Approved', 'refactor / bounded'), 'foo-implementation-plan.md': plan('Completed') }), 'Done (no QC)', 'route without Q');
  assert.equal(state({ 'foo-implementation-plan.md': plan('Completed') }), 'Awaiting QC', 'unknown route never claims no-QC');
  assert.equal(state({ 'foo-story.md': story('Approved'), 'foo-implementation-plan.md': plan('Completed'), 'reviews/foo-qc.md': qc('PASS') }), 'Awaiting QC', 'proposed PASS, not accepted');
  assert.equal(state({ 'foo-story.md': story('Approved'), 'foo-implementation-plan.md': plan('Completed'), 'reviews/foo-qc.md': qc('**PASS**', 'Sam · 2026-10-11') }), 'QC PASS');
  assert.equal(state({ 'foo-story.md': story('Approved'), 'foo-implementation-plan.md': plan('Completed'), 'reviews/foo-qc.md': qc('pass', 'Sam · 2026-10-11') }), 'QC PASS', 'verdict case: index = stats');
  const rounds = { 'foo-story.md': story('Approved'), 'foo-implementation-plan.md': plan('Completed'), 'reviews/foo-qc.md': qc('FAIL — 2 issues'), 'reviews/foo-qc-r2.md': qc('FAIL — 1 issue'), 'reviews/foo-qc-r10.md': qc('PASS', 'Sam · 2026-10-12') };
  assert.equal(state(rounds), 'QC PASS', 'the latest QC round decides: -qc-r10 over -qc-r2 over -qc');
  const d2 = item(rounds);
  assert.equal(readFacts(join(d2, 'foo'), 'foo').qc, 'PASS', 'stats read the same latest round');
  assert.equal(state({ 'foo-story.md': story('Approved'), 'foo-implementation-plan.md': plan('Completed'), 'reviews/foo-qc.md': qc('PASS', '— (not accepted; the verdict is the human\'s)') }), 'Awaiting QC', 'index and stats agree on acceptance');
  assert.equal(state({ 'foo-story.md': story('Approved'), 'foo-implementation-plan.md': plan('Completed'), 'reviews/foo-qc.md': qc('PASS', 'pending') }), 'Awaiting QC', '"pending" is not an acceptance');
  assert.equal(state({ 'foo-implementation-plan.md': plan('Completed'), 'reviews/foo-qc.md': qc('FAIL — 2 issues') }), 'In progress');
  assert.equal(state({ 'foo-implementation-plan.md': plan('Paused') }), 'Paused');
  assert.equal(state({ 'foo-findings.md': '- **Status:** Concluded\n' }), 'Done (no QC)');
});

test('real values with | or → are kept; only placeholders count as unfilled', () => {
  const d = item({ 'foo-story.md': '- **Type / scope:** change / bounded\n- **Parent:** a→b · **Depends on:** x|y\n' });
  const i = readItem(join(d, 'foo'), 'foo', d);
  assert.deepEqual([i.parent, i.dependsOn], ['a→b', 'x|y']);
  assert.match(renderIndex([i]), /\| a→b \| x\\\|y \|/);
});

test('type/scope, parent, depends on come from the story', () => {
  const d = item({ 'foo-story.md': '- **Type / scope:** bug / bounded\n- **Parent:** bar · **Answers for:** — · **Depends on:** baz\n' });
  const i = readItem(join(d, 'foo'), 'foo', d);
  assert.deepEqual([i.typeScope, i.parent, i.dependsOn], ['bug / bounded', 'bar', 'baz']);
});

test('listItems: directories only, sorted, dot-dirs skipped', () => {
  const d = mkdtempSync(join(tmpdir(), 'burhan-docs-'));
  for (const n of ['b', 'a', '.hidden']) mkdirSync(join(d, n));
  writeFileSync(join(d, 'README.md'), 'x');
  assert.deepEqual(listItems(d, d).map((i) => i.slug), ['a', 'b']);
});

test('renderIndex([]) is exactly the shipped docs-index template', () => {
  assert.equal(renderIndex([]), tpl('docs-index.md'));
});

test('renderIndex escapes pipes in cells', () => {
  const out = renderIndex([{ slug: 'x', typeScope: 'a|b', parent: '—', dependsOn: '—', state: 'Draft', lastActivity: '—' }]);
  assert.match(out, /\| \[x\]\(x\/\) \| a\\\|b \| — \| — \| Draft \| — \|\n$/);
});
