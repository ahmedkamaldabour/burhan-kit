import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { BROWNFIELD_MIN_SOURCE_FILES, DIR_MAX_ENTRIES, HOOK_MAX_ENTRIES, HOOK_MAX_MS, INSPECT_MAX_MS, INSPECT_MAX_DEPTH, INSPECT_MAX_ENTRIES, isBrownfield, sourceTest, walkTree } from '../src/hooks/core/baseline.mjs';
import { inspect } from '../src/lib/inspect.js';
import { runCli } from '../src/main.js';
import { capture, tmpDir } from './helpers.js';

// `burhan inspect`: a bounded, read-only look at the tree, no LLM. Brownfield = at least BROWNFIELD_MIN_SOURCE_FILES
// source files (WF_CODE_REGEX when set, else a built-in list of source extensions).
function tree(files: string[], config = ''): string {
  const p = tmpDir('burhan-insp-');
  for (const f of files) { mkdirSync(join(p, f, '..'), { recursive: true }); writeFileSync(join(p, f), 'x'); }
  if (config) { mkdirSync(join(p, '.burhan'), { recursive: true }); writeFileSync(join(p, '.burhan/workflow.config'), config); }
  return p;
}
const sources = (n: number, dir = 'src', ext = 'ts'): string[] => Array.from({ length: n }, (_, i) => `${dir}/f${i}.${ext}`);

test('the threshold is 10 source files: one below is greenfield, at it is brownfield', () => {
  assert.equal(BROWNFIELD_MIN_SOURCE_FILES, 10);
  assert.equal(isBrownfield(tree(sources(9)), ''), false);
  assert.equal(isBrownfield(tree(sources(10)), ''), true);
  assert.equal(inspect(tree(sources(9))).kind, 'greenfield');
  assert.equal(inspect(tree(sources(10))).kind, 'brownfield');
});

test('a manifest, docs and config alone are greenfield', () => {
  const p = tree(['package.json', 'README.md', 'docs/a.md', 'docs/b.md', '.github/workflows/ci.yml', ...Array.from({ length: 20 }, (_, i) => `notes/n${i}.md`)]);
  assert.equal(isBrownfield(p, ''), false);
  const r = inspect(p);
  assert.equal(r.kind, 'greenfield');
  assert.ok(r.important.includes('package.json') && r.important.includes('README.md') && r.important.includes('.github/workflows/ci.yml'), r.important.join(','));
});

test('the skip list is honoured (dependencies, build output, VCS and burhan folders)', () => {
  const p = tree([...sources(30, 'node_modules/x'), ...sources(30, 'dist'), ...sources(30, '.git/hooks'), ...sources(30, '.burhan/hooks'), ...sources(30, 'vendor/y'), ...sources(3)]);
  assert.equal(isBrownfield(p, ''), false);
  assert.equal(inspect(p).sourceFiles, 3);
});

test('a symlink is counted, never followed', (t) => {
  if (process.platform === 'win32') { t.skip('symlinks need privileges on Windows'); return; }
  const outside = tree(sources(50));
  const p = tree(sources(2));
  symlinkSync(join(outside, 'src'), join(p, 'linked'));
  const r = inspect(p);
  assert.equal(r.sourceFiles, 2);
  assert.equal(r.symlinks, 1);
  assert.equal(isBrownfield(p, ''), false);
});

test('depth and entry limits truncate deterministically and say so', () => {
  assert.equal(INSPECT_MAX_DEPTH, 12); assert.equal(INSPECT_MAX_ENTRIES, 20_000);
  const deep = tree([`${Array.from({ length: 14 }, (_, i) => `d${i}`).join('/')}/x.ts`]);
  const d = inspect(deep);
  assert.equal(d.truncated.depth, true); assert.equal(d.truncated.entries, false); assert.equal(d.sourceFiles, 0);
  const wide = tree(Array.from({ length: 30 }, (_, i) => `a${i}.md`));
  const w1 = inspect(wide, { maxEntries: 10 }); const w2 = inspect(wide, { maxEntries: 10 });
  assert.equal(w1.truncated.entries, true);
  assert.equal(w1.entries, 10);
  assert.deepEqual(w1, w2);
});

test('WF_CODE_REGEX replaces the built-in extensions', () => {
  const custom = tree([...Array.from({ length: 12 }, (_, i) => `rules/r${i}.dsl`), ...sources(3)], "WF_CODE_REGEX='^rules/.*\\.dsl$'\n");
  assert.equal(inspect(custom).kind, 'brownfield');
  assert.equal(inspect(custom).sourceFiles, 12);
  assert.equal(isBrownfield(custom, '^rules/.*\\.dsl$'), true);
  assert.equal(isBrownfield(tree(sources(12)), '^rules/.*\\.dsl$'), false);
});

test('isBrownfield stops at the threshold (early exit) and stays fast on a large tree', () => {
  const big = tree([...sources(10), ...Array.from({ length: 3000 }, (_, i) => `z/doc${i}.md`)]);
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) assert.equal(isBrownfield(big, ''), true);
  const per = (performance.now() - t0) / 10;
  const docsOnly = tree(Array.from({ length: 6000 }, (_, i) => `z${i % 30}/doc${i}.md`));
  const t1 = performance.now();
  assert.equal(isBrownfield(docsOnly, ''), false);
  const worst = performance.now() - t1;
  assert.ok(per < 50 && worst < 300, `early exit ${per.toFixed(1)} ms, worst ${worst.toFixed(1)} ms`);
});

test('an unreadable folder is listed, never fatal', (t) => {
  const p = tree([...sources(10)]);
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    mkdirSync(join(p, 'locked'), { mode: 0o000 });
    const r = inspect(p);
    chmodSync(join(p, 'locked'), 0o755);
    assert.equal(r.kind, 'brownfield');
    assert.ok(r.unreadable.includes('locked'), r.unreadable.join(','));
  } else t.diagnostic('unreadable-folder case skipped (Windows or root)');
});

test('burhan inspect prints the kind, the reason, the counts, the important files and any truncation; --json too', async () => {
  const p = tree([...sources(12), 'package.json', 'README.md']);
  const { o, io } = capture(p);
  assert.equal(await runCli(['inspect', p], io), 0, o.err);
  assert.match(o.out, /^brownfield — 12 source files \(threshold 10\)/m);
  assert.match(o.out, /^important: .*package\.json/m);
  assert.match(o.out, /not truncated/);
  const j = capture(p);
  assert.equal(await runCli(['inspect', '--json', p], j.io), 0);
  const parsed = JSON.parse(j.o.out);
  assert.equal(parsed.kind, 'brownfield');
  assert.equal(parsed.sourceFiles, 12);
});

// Review fix round (SU4 review I-1…I-3, M-1…M-7).
test('I-1: a heavy WF_CODE_REGEX cannot slow a turn past the hook time limit', () => {
  assert.equal(HOOK_MAX_MS, 1000);
  const long = 'n'.repeat(200);
  const p = tree(Array.from({ length: 3000 }, (_, i) => `d${i % 20}/${long}${i}.txt`));
  const t0 = performance.now();
  assert.equal(isBrownfield(p, '.{1000}~'), false);
  assert.ok(performance.now() - t0 < 1500, `took ${(performance.now() - t0).toFixed(0)} ms`);
});

test('I-2: one wide folder cannot use up the walk — src after a huge assets folder is still seen', () => {
  assert.equal(DIR_MAX_ENTRIES, 1000);
  const p = tree([...Array.from({ length: 6000 }, (_, i) => `assets/a${i}.png`), ...sources(12)]);
  assert.equal(isBrownfield(p, ''), true);
  const r = inspect(p);
  assert.equal(r.kind, 'brownfield');
  assert.equal(r.truncated.wide, true);
});

test('I-3: a path that does not exist or is not a folder is an error (exit 2), never "greenfield"', async () => {
  const p = tree(['a.txt']);
  for (const bad of [join(p, 'nope'), join(p, 'a.txt')]) {
    const { o, io } = capture(p);
    assert.equal(await runCli(['inspect', bad], io), 2, o.out);
    assert.match(o.err, /not a folder/);
  }
});

test('M-1: when WF_CODE_REGEX cannot be used, the reason says the built-in list was used', () => {
  const p = tree(sources(12), "WF_CODE_REGEX='(a)\\1'\n");
  assert.match(inspect(p).reason, /built-in source extensions \(WF_CODE_REGEX could not be used\)/);
  assert.equal(sourceTest('(a)\\1').kind, 'builtin');
});

test('M-2: a shell project with its scripts in bin/ is brownfield', () => {
  assert.equal(isBrownfield(tree(sources(12, 'bin', 'sh')), ''), true);
});

test('M-3: the depth boundary, the early exit, the hook cap, a FIFO named like source, name order', (t) => {
  assert.equal(HOOK_MAX_ENTRIES, 5000);
  const at12 = tree([`${Array.from({ length: 11 }, (_, i) => `d${i}`).join('/')}/x.ts`]);
  assert.equal(inspect(at12).sourceFiles, 1, 'a file at depth 12 is read');
  const at13 = tree([`${Array.from({ length: 12 }, (_, i) => `d${i}`).join('/')}/x.ts`]);
  assert.equal(inspect(at13).sourceFiles, 0, 'a file at depth 13 is not');
  const many = tree([...sources(40), ...Array.from({ length: 40 }, (_, i) => `z${i}.md`)]);
  const w = walkTree(many, { isSource: sourceTest('').test, stopAt: 10, maxEntries: HOOK_MAX_ENTRIES });
  assert.equal(w.stopped, true); assert.equal(w.sourceFiles, 10); assert.ok(w.entries < 80, `read ${w.entries}`);
  const order: string[] = [];
  walkTree(tree(['b.md', 'a.md', 'c.md']), { isSource: () => false, onEntry: (rel) => order.push(rel) });
  assert.deepEqual(order, ['a.md', 'b.md', 'c.md']);
  if (process.platform === 'win32') { t.diagnostic('FIFO case skipped on Windows'); return; }
  const f = tree(sources(9));
  const mk = spawnSync('mkfifo', [join(f, 'src/pipe.ts')]);
  if (mk.status !== 0) { t.diagnostic('mkfifo unavailable'); return; }
  assert.equal(inspect(f).sourceFiles, 9);
});

test('M-6: the human output caps long lists', async () => {
  const p = tree(Array.from({ length: 70 }, (_, i) => `.github/workflows/w${i}.yml`));
  const { o, io } = capture(p);
  await runCli(['inspect', p], io);
  assert.match(o.out, /important: .*… \+\d+ more/);
});

test('confirmation: inspect has its own time limit and reports it; the unreadable list is capped', async (t) => {
  assert.equal(INSPECT_MAX_MS, 10_000);
  const p = tree(Array.from({ length: 200 }, (_, i) => `d${i % 5}/${'n'.repeat(150)}${i}.txt`));
  const r = inspect(p, { maxMs: -1 });
  assert.equal(r.truncated.time, true);
  const { o, io } = capture(p);
  await runCli(['inspect', p], io);
  assert.ok(!o.out.includes('time limit'), o.out);
  if (process.platform === 'win32' || process.getuid?.() === 0) { t.diagnostic('unreadable cap skipped (Windows or root)'); return; }
  const q = tree(sources(2));
  for (let i = 0; i < 15; i++) mkdirSync(join(q, `l${i}`), { mode: 0o000 });
  const c = capture(q);
  await runCli(['inspect', q], c.io);
  for (let i = 0; i < 15; i++) chmodSync(join(q, `l${i}`), 0o755);
  assert.match(c.o.out, /unreadable: .*… \+5 more/);
});
