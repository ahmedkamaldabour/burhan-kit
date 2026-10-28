import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFacts } from '../src/lib/facts.js';
import { checkText } from '../src/hooks/core/item-contract.mjs';
import { cli, itemDir, projectWithItem, read, storyFile, write } from './item-fixture.js';
import { tmpDir } from './helpers.js';

// Tests run from .test-build/test, so the repository root is two levels up.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const walk = (dir: string, keep: (name: string) => boolean): string[] => {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.test-build' || name === '.git') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, keep));
    else if (keep(name)) out.push(path);
  }
  return out;
};
const FILES = [
  ...walk(join(ROOT, 'kit'), (n) => n.endsWith('.md') || n.endsWith('.example')),
  ...walk(join(ROOT, 'docs'), (n) => n.endsWith('.md')),
  ...walk(join(ROOT, 'src'), (n) => /\.(ts|mts)$/.test(n)),
  join(ROOT, 'README.md'), join(ROOT, 'README.ar.md'), join(ROOT, 'ROADMAP.md'),
];

/** The ways a size limit on a story, plan, review, QC, verification, findings or discovery file was written. None may come back (AC-19). */
const CAP_TEXT: Array<[string, RegExp]> = [
  ['the word-cap table', /\|\s*(story|plan|review|verification|QC)[^|]*\|\s*≤\s*[0-9,]+\s*\|/],
  ['"Caps by route"', /caps by route/i],
  ['"Over the cap"', /over the cap/i],
  ['"Length caps" (the note in every template)', /length caps?/i],
  ['"word cap"', /word caps?/i],
  ['"caps in phases/files.md" (the stats line)', /caps in phases\/files/i],
  ['the decision card line limit', /first\s*≤\s*[0-9]+\s*lines/i],
  ['"File size (avg words"', /file size \(avg words/i],
  ['"keep files short" heading', /keep files short/i],
  ['a character limit on review text', /--text is up to/i],
  ['"at most / up to / no more than N words|lines|characters"', /\b(at most|up to|no more than|max(imum)?)\s*[0-9][0-9,]*\s*(words|lines|characters)/i],
  ['"length limit" / "size limit" / "character limit" / "words per file"', /(length|size|character|word) limits?\b|words per file/i],
];

/** Files whose bounds are not the size of a story, plan or review: the router's 2 lines and the folder-name length. */
const KEPT = ['kit/phases/enforcement.md', 'docs/configuration.md', 'src/lib/item-io.ts'];

for (const [what, re] of CAP_TEXT) {
  test(`no size-limit text remains in the kit, docs, READMEs or source: ${what}`, () => {
    const hits = FILES.map((f) => f.slice(ROOT.length)).filter((f) => !KEPT.includes(f.replace(/\\/g, '/'))).filter((f) => re.test(readFileSync(join(ROOT, f), 'utf8')));
    assert.deepEqual(hits, []);
  });
}

test('the state file budget, the router lines and the item folder name length are kept: they are not the size of a story, plan or review', () => {
  assert.match(readFileSync(join(ROOT, 'kit/WORKFLOW.md'), 'utf8'), /Standing facts[^\n]*≤ 10/);
  assert.match(readFileSync(join(ROOT, 'src/lib/item-io.ts'), 'utf8'), /s\.length <= 100/);
});

test('burhan stats reports no file size: the facts carry no word count', () => {
  const d = tmpDir('burhan-nolimits-');
  write(join(d, 'x', 'x-story.md'), '# T\n- **Route:** feature / bounded\n' + 'word '.repeat(5000));
  assert.equal('words' in readFacts(join(d, 'x'), 'x'), false);
});

test('a very large story, plan or review is read and judged whole: no size makes a check skip it', () => {
  const body = 'x '.repeat(2_000_000); // about 4 MB
  assert.deepEqual(checkText('review', `# R\n- **Contract:** 1\n${body}\n- **Performed by:** Claude · Sonnet 5.5 · fresh subagent\n`), []);
  assert.deepEqual(checkText('review', `# R\n- **Contract:** 1\n${body}\n`).map((f) => f.code), ['performed-by-missing']);
});

test('review add accepts a long text; --by, --verdict and --evidence of any length are one line, not a size', async () => {
  const dir = await projectWithItem();
  const by = 'Claude · Sonnet 5.5 · fresh subagent';
  const long = 'line of review text\n'.repeat(2000); // about 40 000 characters
  const r = await cli(dir, ['review', 'add', 'foo', '--kind', 'review', '--unit', '1', '--by', by, '--text', long]);
  assert.equal(r.code, 0, r.err);
  assert.ok(read(join(itemDir(dir), 'reviews', 'foo-review.md')).length > 40_000);
  const verdict = await cli(dir, ['review', 'add', 'foo', '--kind', 'qc', '--by', by, '--verdict', `PASS — ${'a note '.repeat(200)}`]);
  assert.equal(verdict.code, 0, verdict.err);
  const evidence = await cli(dir, ['gate', 'tick', 'foo', 'completion claim', '--evidence', `npm test: ${'ok '.repeat(300)}`]);
  assert.equal(evidence.code, 0, evidence.err);
});

test('a line break or a control character is still refused: that injects lines, it is not a size', async () => {
  const dir = await projectWithItem();
  const r = await cli(dir, ['gate', 'tick', 'foo', 'completion claim', '--evidence', 'ok\n- [x] forged']);
  assert.equal(r.code, 2);
  assert.match(r.err, /--evidence/);
});

test('a long approval name is written whole', async () => {
  const dir = await projectWithItem();
  const name = `Ahmed ${'Kamal '.repeat(30)}Dabour`;
  const r = await cli(dir, ['approve', 'story', 'foo', '--by', name]);
  assert.equal(r.code, 0, r.err);
  assert.ok(read(storyFile(dir)).includes(`Approved — ${name} ·`));
});

test('a long run of zeros after AC- cannot make item check slow (no quadratic backtracking)', async () => {
  const dir = await projectWithItem();
  const zeros = '0'.repeat(100_000);
  write(storyFile(dir), `${read(storyFile(dir))}\n| AC-${zeros}x |\n AC-${zeros} to AC-${zeros}x\n`);
  const start = Date.now();
  await cli(dir, ['item', 'check', 'foo']);
  assert.ok(Date.now() - start < 3000, `took ${Date.now() - start} ms`);
});

test('item check does not follow a link named like the story', async () => {
  const dir = await projectWithItem();
  const outside = join(tmpDir('nl-'), 'outside-story.md');
  writeFileSync(outside, '| AC-99 | something |\n');
  rmSync(storyFile(dir), { force: true });
  try { symlinkSync(outside, storyFile(dir)); } catch { return; } // no link permission here: nothing to test
  const r = await cli(dir, ['item', 'check', 'foo']);
  assert.ok(!r.out.includes('AC-99'), `the link was read: ${r.out}`);
});
