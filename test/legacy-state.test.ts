import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readItem, renderIndex, type Item } from '../src/lib/items.js';
import { kitDir } from '../src/lib/kit.js';
import { cli, project, STATE, write } from './item-fixture.js';
import { tmpDir } from './helpers.js';

const DOCS = '.burhan/work';
const plan = (status: string, route = ''): string => `${route === '' ? '' : `- **Route:** ${route}\n`}- **Overall status:** ${status}\n`;
const qc = (verdict: string, by = '— (not accepted)'): string => `- **Date:** x · **Verdict:** ${verdict}\n- **Accepted by:** ${by}\n`;

function stateOf(files: Record<string, string>): string {
  const docs = tmpDir('burhan-legacy-');
  mkdirSync(join(docs, 'foo/reviews'), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(docs, 'foo', name), text);
  return readItem(join(docs, 'foo'), 'foo', docs).state;
}
const item = (slug: string, state: string, route = '—'): Item => ({ slug, typeScope: route, parent: '—', dependsOn: '—', state, lastActivity: '—' });

test('a Completed plan with no route anywhere and no QC file is Legacy (AC-03)', () => {
  assert.equal(stateOf({ 'foo-implementation-plan.md': plan('Completed') }), 'Legacy');
  assert.equal(stateOf({ 'foo-story.md': '- **Status:** Approved\n', 'foo-implementation-plan.md': plan('Completed') }), 'Legacy', 'a story with no route does not change that');
});

test('every other state keeps its rule (AC-04)', () => {
  const done = plan('Completed', 'feature / bounded');
  assert.equal(stateOf({ 'foo-implementation-plan.md': done }), 'Awaiting QC', 'route with Q, no QC file');
  assert.equal(stateOf({ 'foo-implementation-plan.md': plan('Completed', 'refactor / bounded') }), 'Done (no QC)', 'route without Q');
  assert.equal(stateOf({ 'foo-implementation-plan.md': done, 'reviews/foo-qc.md': qc('PASS', 'Sam · 2026-10-11') }), 'QC PASS');
  assert.equal(stateOf({ 'foo-implementation-plan.md': done, 'reviews/foo-qc.md': qc('PASS') }), 'Awaiting QC', 'PASS not accepted');
  assert.equal(stateOf({ 'foo-implementation-plan.md': done, 'reviews/foo-qc.md': qc('FAIL — 1 issue') }), 'In progress');
  assert.equal(stateOf({ 'foo-implementation-plan.md': plan('Completed'), 'reviews/foo-qc.md': qc('PASS') }), 'Awaiting QC', 'no route but a QC file: today\'s result');
  assert.equal(stateOf({ 'foo-implementation-plan.md': plan('Completed'), 'reviews/foo-qc.md': qc('PASS', 'Sam · 2026-10-11') }), 'QC PASS');
  assert.equal(stateOf({ 'foo-implementation-plan.md': plan('Completed'), 'reviews/foo-qc.md': qc('FAIL') }), 'In progress');
  assert.equal(stateOf({ 'foo-implementation-plan.md': plan('In progress') }), 'In progress', 'Legacy needs a Completed plan');
  assert.equal(stateOf({ 'foo-implementation-plan.md': plan('Approved') }), 'Plan ready');
  assert.equal(stateOf({ 'foo-implementation-plan.md': plan('Superseded') }), 'Superseded');
  assert.equal(stateOf({ 'foo-findings.md': '- **Status:** Concluded\n' }), 'Done (no QC)');
});

test('the index header names Legacy and still equals the shipped template (AC-05)', () => {
  const template = readFileSync(join(kitDir(), 'templates', 'docs-index.md'), 'utf8');
  assert.match(renderIndex([]).split('\n')[3] ?? '', /^States: .* · Legacy$/);
  assert.equal(renderIndex([]), template);
});

test('with no Legacy item the index is the plain table, as before (AC-07)', () => {
  const out = renderIndex([item('a', 'Draft'), item('b', 'QC PASS', 'feature / bounded')]);
  assert.equal(out.endsWith('| [b](b/) | feature / bounded | — | — | QC PASS | — |\n'), true);
  assert.equal(out.includes('<details>'), false);
  assert.equal(out.includes('old item'), false);
});

test('Legacy items are folded under one counted block, closed burhan items stay listed (AC-07)', () => {
  const rows = [item('a', 'Legacy'), item('b', 'Done (no QC)', 'refactor / bounded'), item('c', 'Legacy'), item('d', 'QC PASS', 'feature / bounded'), item('e', 'Superseded', 'change / bounded')];
  const out = renderIndex(rows);
  const head = '| Item | Route | Parent | Depends on | State | Last activity |\n|------|-------|--------|------------|-------|---------------|\n';
  const line = (i: Item): string => `| [${i.slug}](${i.slug}/) | ${i.typeScope} | — | — | ${i.state} | — |\n`;
  const expected = renderIndex([]) + line(rows[1]) + line(rows[3]) + line(rows[4])
    + `\n<details>\n<summary>2 old items</summary>\n\n${head}${line(rows[0])}${line(rows[2])}\n</details>\n`;
  assert.equal(out, expected);
  assert.match(renderIndex([item('a', 'Legacy')]), /<summary>1 old item<\/summary>/);
  assert.equal(renderIndex([item('a', 'Legacy')]).startsWith(renderIndex([])), true, 'all Legacy: the plain table is empty, the fold follows');
});

test('status folds the Legacy items of a project and prints the same bytes twice (AC-07, AC-08)', async () => {
  const dir = project();
  for (const slug of ['old-a', 'old-b', 'old-c']) write(join(dir, DOCS, slug, `${slug}-implementation-plan.md`), plan('Completed'));
  write(join(dir, DOCS, 'live', 'live-story.md'), '- **Status:** Approved\n');
  const one = await cli(dir, ['status']);
  const two = await cli(dir, ['status']);
  assert.equal(one.code, 0, one.err);
  assert.equal(one.out, two.out);
  assert.match(one.out, /<summary>3 old items<\/summary>/);
  const [main = '', folded = ''] = one.out.split('<details>');
  assert.match(main, /\| \[live\]\(live\/\) \| — \| — \| — \| Spec ready \|/);
  assert.doesNotMatch(main, /old-a/);
  for (const slug of ['old-a', 'old-b', 'old-c']) assert.match(folded, new RegExp(`\\| \\[${slug}\\]\\(${slug}/\\) \\| — \\| — \\| — \\| Legacy \\|`));
});

test('status --write gives the same file twice and still refuses a hand-written index (AC-08)', async () => {
  const dir = project();
  write(join(dir, DOCS, 'old-a', 'old-a-implementation-plan.md'), plan('Completed'));
  assert.equal((await cli(dir, ['status', '--write'])).code, 0);
  const first = readFileSync(join(dir, DOCS, 'README.md'), 'utf8');
  assert.equal((await cli(dir, ['status', '--write'])).code, 0);
  assert.equal(readFileSync(join(dir, DOCS, 'README.md'), 'utf8'), first);
  writeFileSync(join(dir, DOCS, 'README.md'), 'MY OWN INDEX\n');
  const r = await cli(dir, ['status', '--write']);
  assert.equal(r.code, 2);
  assert.match(r.err, /hand-written/);
  assert.equal(readFileSync(join(dir, DOCS, 'README.md'), 'utf8'), 'MY OWN INDEX\n');
});

test('Legacy is never a state close outcome, and state compact reports a Legacy item as not closed (AC-06)', async () => {
  const dir = project();
  write(join(dir, DOCS, 'alpha', 'alpha-implementation-plan.md'), plan('Completed'));
  const text = ['# State', '', '## Now', '- alpha · closed long ago, see its folder', '', '### beta', '- **Route:** change / bounded · **Mode:** step', '', '## Waiting on you', '- nothing', ''].join('\n');
  writeFileSync(join(dir, STATE), text);
  const close = await cli(dir, ['state', 'close', 'alpha', '--outcome', 'Legacy', '--commit', '5ae9a09', '--folder', '.burhan/work/alpha']);
  assert.equal(close.code, 2);
  assert.match(close.err, /--outcome "Legacy" is not one of QC PASS, Done \(no QC\), Paused, Superseded/);
  const compact = await cli(dir, ['state', 'compact']);
  assert.equal(compact.code, 0, compact.err);
  assert.match(compact.out, /left as it is: alpha: its route cannot be read/);
  assert.equal(readFileSync(join(dir, STATE), 'utf8'), text, 'nothing written');
});
