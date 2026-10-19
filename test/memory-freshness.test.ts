import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { affectedBy, evidenceItems, factFreshness, fileHash } from '../src/lib/memory.js';
import type { Fact } from '../src/hooks/core/baseline.mjs';
import { runCli } from '../src/main.js';
import { capture, tmpDir } from './helpers.js';

// Freshness: a fact's evidence names files with the first 16 hex of their SHA-256 (whole file, line endings as LF).
const h = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);
const fact = (id: string, evidence: string): Fact => ({ id, state: 'current', file: '.burhan/context/data.md', line: 7, confidence: 'confirmed', evidence, verified: '2026-10-19' });
const HEAD = '## Current\n| ID | Fact | Confidence | Evidence | Verified |\n|--|--|--|--|--|\n';

function project(files: Record<string, string>, rows: string, sup = ''): string {
  const p = tmpDir('burhan-fresh-');
  for (const [rel, text] of Object.entries(files)) { mkdirSync(join(p, rel, '..'), { recursive: true }); writeFileSync(join(p, rel), text); }
  mkdirSync(join(p, '.burhan/context'), { recursive: true });
  writeFileSync(join(p, '.burhan/PROJECT.md'), '- **Baseline:** Draft\n');
  writeFileSync(join(p, '.burhan/context/data.md'), `${HEAD}${rows}${sup ? `\n## Superseded\n| ID | Fact | Confidence | Evidence | Verified | Superseded by | When |\n|--|--|--|--|--|--|--|\n${sup}` : ''}`);
  return p;
}
const git = (p: string, ...args: string[]): void => { const r = spawnSync('git', ['-C', p, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };

test('evidenceItems: backticked paths with an optional hash; line ranges and symbols point at the file; the rest is not checkable', () => {
  assert.deepEqual(evidenceItems('`src/a.ts:12-40` sha256:0123456789abcdef `src/b.ts#run` `docs/`'), [
    { path: 'src/a.ts', hash: '0123456789abcdef' }, { path: 'src/b.ts', hash: null }, { path: 'docs/', hash: null },
  ]);
  assert.deepEqual(evidenceItems('runtime: npm test, 2026-10-19'), []);
  assert.deepEqual(evidenceItems('person: Ahmed · 2026-10-19'), []);
});

test('fileHash: the whole file, CRLF counted as LF (a Windows checkout matches)', () => {
  const p = tmpDir('burhan-hash-');
  writeFileSync(join(p, 'a.txt'), 'one\ntwo\n'); writeFileSync(join(p, 'b.txt'), 'one\r\ntwo\r\n');
  assert.equal(fileHash(join(p, 'a.txt')), h('one\ntwo\n'));
  assert.equal(fileHash(join(p, 'b.txt')), h('one\ntwo\n'));
});

test('factFreshness: unchanged = fresh, edited = changed, deleted = missing, no hash or runtime/person = unchecked', () => {
  const p = project({ 'src/a.ts': 'A\n', 'src/b.ts': 'B\n' }, '');
  assert.equal(factFreshness(fact('DATA-a', `\`src/a.ts\` sha256:${h('A\n')}`), p), 'fresh');
  assert.equal(factFreshness(fact('DATA-b', `\`src/b.ts\` sha256:${h('old\n')}`), p), 'changed');
  assert.equal(factFreshness(fact('DATA-c', `\`src/gone.ts\` sha256:${h('A\n')}`), p), 'missing');
  assert.equal(factFreshness(fact('DATA-d', '`src/a.ts`'), p), 'unchecked');
  assert.equal(factFreshness(fact('DATA-e', 'runtime: npm test'), p), 'unchecked');
  assert.equal(factFreshness(fact('DATA-f', 'person: Ahmed · 2026-10-19'), p), 'unchecked');
});

test('factFreshness: several items — missing beats changed beats unchecked beats fresh', () => {
  const p = project({ 'a': 'A', 'b': 'B' }, '');
  const fresh = `\`a\` sha256:${h('A')}`; const changed = `\`b\` sha256:${h('x')}`; const missing = `\`c\` sha256:${h('A')}`;
  assert.equal(factFreshness(fact('D-a', `${fresh} ${changed} ${missing}`), p), 'missing');
  assert.equal(factFreshness(fact('D-b', `${fresh} ${changed}`), p), 'changed');
  assert.equal(factFreshness(fact('D-c', `${fresh} \`b\``), p), 'unchecked');
  assert.equal(factFreshness(fact('D-d', `${fresh} \`b\` sha256:${h('B')}`), p), 'fresh');
});

test('factFreshness: a symlink, a directory, an absolute path or one outside the project is unchecked, never followed', (t) => {
  const p = project({ 'src/a.ts': 'A' }, '');
  const outside = join(tmpDir('burhan-fresh-out-'), 'x'); writeFileSync(outside, 'A');
  assert.equal(factFreshness(fact('D-dir', `\`src\` sha256:${h('A')}`), p), 'unchecked');
  assert.equal(factFreshness(fact('D-abs', `\`${outside}\` sha256:${h('A')}`), p), 'unchecked');
  assert.equal(factFreshness(fact('D-up', `\`../x\` sha256:${h('A')}`), p), 'unchecked');
  if (process.platform === 'win32') { t.diagnostic('symlink case skipped on Windows'); return; }
  symlinkSync(outside, join(p, 'link'));
  assert.equal(factFreshness(fact('D-link', `\`link\` sha256:${h('A')}`), p), 'unchecked');
});

test('memory status: counts per state, lists the facts that are not fresh, says changed is not false; works without Git', async () => {
  const p = project({ 'src/a.ts': 'A\n', 'src/b.ts': 'B\n' },
    `| DATA-a | A. | confirmed | \`src/a.ts\` sha256:${h('A\n')} | 2026-10-19 |\n| DATA-b | B. | confirmed | \`src/b.ts\` sha256:${h('old')} | 2026-10-19 |\n| DATA-c | C. | inferred | \`src/c.ts\` sha256:${h('A\n')} | 2026-10-19 |\n| DATA-d | D. | inferred | runtime: npm test | 2026-10-19 |\n`,
    `| DATA-old | Old. | inferred | \`src/c.ts\` sha256:${h('A\n')} | 2026-10-01 | DATA-a | 2026-10-19 |\n`);
  const { o, io } = capture(p);
  assert.equal(await runCli(['memory', 'status', p], io), 0, o.err);
  assert.match(o.out, /memory status: 4 facts · 1 fresh · 1 changed · 1 missing · 1 unchecked/);
  assert.match(o.out, /^CHANGED +DATA-b +\.burhan\/context\/data\.md:5 +src\/b\.ts$/m);
  assert.match(o.out, /^MISSING +DATA-c +\.burhan\/context\/data\.md:6 +src\/c\.ts$/m);
  assert.match(o.out, /^UNCHECKED +DATA-d +\.burhan\/context\/data\.md:7$/m);
  assert.ok(!/DATA-a\b/.test(o.out) && !o.out.includes('DATA-old'), 'fresh and superseded facts are not listed');
  assert.match(o.out, /changed does not mean false/);
});

test('memory status: no project memory is not an error', async () => {
  const { o, io } = capture();
  assert.equal(await runCli(['memory', 'status', tmpDir('burhan-fresh-none-')], io), 0);
  assert.match(o.out, /no project memory/);
});

test('affectedBy: a changed path maps to facts citing it, or citing a folder that contains it', () => {
  const facts = [fact('D-a', '`src/a.ts` sha256:0123456789abcdef'), fact('D-dir', '`src/`'), fact('D-other', '`docs/x.md`'), fact('D-near', '`src/a.tsx`')];
  assert.deepEqual(affectedBy(facts, ['src/a.ts']).map((a) => [a.path, a.facts.map((f) => f.id)]), [['src/a.ts', ['D-a', 'D-dir']]]);
  assert.deepEqual(affectedBy(facts, ['README.md']), []);
});

test('memory affected --since: lists the facts touched by changed files (Git)', async () => {
  const p = project({ 'src/a.ts': 'A\n', 'src/b.ts': 'B\n' }, `| DATA-a | A. | confirmed | \`src/a.ts\` sha256:${h('A\n')} | 2026-10-19 |\n| DATA-b | B. | confirmed | \`src/b.ts\` sha256:${h('B\n')} | 2026-10-19 |\n`);
  git(p, 'init', '-q'); git(p, 'add', '-A'); git(p, 'commit', '-qm', 'one');
  writeFileSync(join(p, 'src/a.ts'), 'A2\n');
  const { o, io } = capture(p);
  assert.equal(await runCli(['memory', 'affected', '--since', 'HEAD', p], io), 0, o.err);
  assert.match(o.out, /^src\/a\.ts: DATA-a$/m);
  assert.ok(!o.out.includes('DATA-b'));
  assert.match(o.out, /memory affected: 1 changed file cited by 1 fact/);
});

test('memory affected: clear errors — no --since, a ref that looks like an option, an unknown ref, no Git repository', async () => {
  const p = project({}, '');
  const run = async (...args: string[]): Promise<{ rc: number; err: string }> => { const { o, io } = capture(p); const rc = await runCli(['memory', 'affected', ...args, p], io); return { rc, err: o.err + o.out }; };
  assert.match((await run()).err, /--since <ref>/);
  const opt = await run('--since=--output=x');
  assert.notEqual(opt.rc, 0); assert.match(opt.err, /ref/);
  const noGit = await run('--since', 'HEAD');
  assert.notEqual(noGit.rc, 0); assert.match(noGit.err, /needs Git/);
  git(p, 'init', '-q'); git(p, 'add', '-A'); git(p, 'commit', '-qm', 'one');
  const bad = await run('--since', 'no-such-ref');
  assert.notEqual(bad.rc, 0); assert.match(bad.err, /no-such-ref/);
  rmSync(join(p, '.git'), { recursive: true, force: true });
});

// Review fix round (SU3 review F-1…F-8).
test('F-1: a symlinked parent folder is not followed', (t) => {
  if (process.platform === 'win32') { t.skip('symlinks need privileges on Windows'); return; }
  const p = project({}, '');
  const outside = tmpDir('burhan-fresh-par-'); writeFileSync(join(outside, 'x.ts'), 'S');
  symlinkSync(outside, join(p, 'src'));
  assert.equal(factFreshness(fact('D-par', `\`src/x.ts\` sha256:${h('S')}`), p), 'unchecked');
});

test('F-2: a renamed file shows under its old path too', async () => {
  const p = project({ 'src/old.ts': 'O\n' }, `| DATA-o | O. | confirmed | \`src/old.ts\` sha256:${h('O\n')} | 2026-10-19 |\n`);
  git(p, 'init', '-q'); git(p, 'add', '-A'); git(p, 'commit', '-qm', 'one');
  git(p, 'mv', 'src/old.ts', 'src/new.ts');
  const { o, io } = capture(p);
  assert.equal(await runCli(['memory', 'affected', '--since', 'HEAD', p], io), 0, o.err);
  assert.match(o.out, /^src\/old\.ts: DATA-o$/m);
});

test('F-3: many changed paths against many facts stay fast', () => {
  const facts = Array.from({ length: 500 }, (_, i) => fact(`D-f${i}`, `\`src/m${i}/\` \`src/f${i}.ts\``));
  const paths = Array.from({ length: 100_000 }, (_, i) => `src/m${i % 700}/x${i}.ts`);
  const t0 = performance.now();
  const r = affectedBy(facts, paths);
  assert.ok(performance.now() - t0 < 2000, `took ${performance.now() - t0} ms`);
  assert.equal(r.length, Math.floor(100_000 / 700) * 500 + Math.min(100_000 % 700, 500));
});

test('F-5: rank order, lone CR, folder-prefix negatives, superseded excluded from affected, upper-case hash', async () => {
  const p = project({ 'a': 'A', 'b': 'B' }, '');
  assert.equal(factFreshness(fact('D-r', `\`b\` sha256:${h('x')} \`a\``), p), 'changed', 'changed beats unchecked');
  const q = tmpDir('burhan-cr-');
  writeFileSync(join(q, 'lone'), 'a\rb'); writeFileSync(join(q, 'end'), 'a\r');
  assert.equal(fileHash(join(q, 'lone')), h('a\rb'));
  assert.equal(fileHash(join(q, 'end')), h('a\r'));
  const facts = [fact('D-dir', '`src/`'), fact('D-bare', '`src`')];
  assert.deepEqual(affectedBy(facts, ['srcx/a.ts', 'src2']), []);
  assert.deepEqual(affectedBy(facts, ['src/a.ts']).map((a) => a.facts.map((f) => f.id)), [['D-dir', 'D-bare']]);
  assert.deepEqual(evidenceItems('`a` sha256:0123456789ABCDEF'), [{ path: 'a', hash: null }]);
  const s = project({ 'src/a.ts': 'A\n' }, '', `| DATA-old | Old. | inferred | \`src/a.ts\` sha256:${h('A\n')} | 2026-10-01 | DATA-x | 2026-10-19 |\n`);
  git(s, 'init', '-q'); git(s, 'add', '-A'); git(s, 'commit', '-qm', 'one');
  writeFileSync(join(s, 'src/a.ts'), 'A2\n');
  const { o, io } = capture(s);
  assert.equal(await runCli(['memory', 'affected', '--since', 'HEAD', s], io), 0);
  assert.ok(!o.out.includes('DATA-old'), o.out);
});

test('F-6: status says why facts are unchecked; affected says untracked files are not included', async () => {
  const p = project({}, '| DATA-u | U. | inferred | src/a.ts | 2026-10-19 |\n');
  const { o, io } = capture(p);
  await runCli(['memory', 'status', p], io);
  assert.match(o.out, /unchecked = no hash in the evidence/);
  git(p, 'init', '-q'); git(p, 'add', '-A'); git(p, 'commit', '-qm', 'one');
  const a = capture(p);
  await runCli(['memory', 'affected', '--since', 'HEAD', p], a.io);
  assert.match(a.o.out, /untracked files are not included/);
});

test('F-8: evidence paths are normalised before matching (./, //, /./, backslashes)', () => {
  for (const ev of ['`./src/a.ts`', '`src//a.ts`', '`src/./a.ts`', '`src\\a.ts`']) {
    assert.deepEqual(affectedBy([fact('D-n', ev)], ['src/a.ts']).length, 1, ev);
  }
});

test('N-1: a project inside a larger repository gets paths relative to the project', async () => {
  const repo = tmpDir('burhan-fresh-mono-');
  writeFileSync(join(repo, 'top.txt'), 'T\n');
  mkdirSync(join(repo, 'app'));
  const p = join(repo, 'app');
  mkdirSync(join(p, 'src')); writeFileSync(join(p, 'src/a.ts'), 'A\n');
  mkdirSync(join(p, '.burhan/context'), { recursive: true });
  writeFileSync(join(p, '.burhan/PROJECT.md'), '- **Baseline:** Draft\n');
  writeFileSync(join(p, '.burhan/context/data.md'), `${HEAD}| DATA-a | A. | confirmed | \`src/a.ts\` sha256:${h('A\n')} | 2026-10-19 |\n`);
  git(repo, 'init', '-q'); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'one');
  writeFileSync(join(p, 'src/a.ts'), 'A2\n'); writeFileSync(join(repo, 'top.txt'), 'T2\n');
  const { o, io } = capture(p);
  assert.equal(await runCli(['memory', 'affected', '--since', 'HEAD', p], io), 0, o.err);
  assert.match(o.out, /^src\/a\.ts: DATA-a$/m);
  assert.match(o.out, /\(since HEAD; 1 files changed;/);
});
