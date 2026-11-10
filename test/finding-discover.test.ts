import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cli, planFile, projectWithItem, read, write } from './item-fixture.js';
import { addFinding, BY, OWNER, reviewFile, withReviews } from './findings-fixture.js';

const today = (): string => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const discover = (dir: string, ...args: string[]) => cli(dir, ['finding', 'discover', 'foo', ...args]);
const folder = (dir: string): string => join(dir, '.burhan', 'discovery');
const row = (dir: string, id: number): string => read(reviewFile(dir)).split('\n').find((l) => l.startsWith(`| ${id} |`)) ?? '';

/** Findings: #1 Minor, #2 Important, #3 Critical, #4 Minor already decided as fixed. */
async function four(): Promise<string> {
  const dir = await withReviews([1, 2]);
  await addFinding(dir, 'review:1', 'Minor', 'src/a.ts:1 a small thing');
  await addFinding(dir, 'review:1', 'Important', 'src/b.ts:2 a | pipe');
  await addFinding(dir, 'review:2', 'Critical', 'src/c.ts:3 a big thing');
  await addFinding(dir, 'review:2', 'Minor', 'src/d.ts:4 decided already');
  await cli(dir, ['finding', 'decide', 'foo', '4', '--fixed', 'unit:2', '--by', OWNER]);
  return dir;
}

test('discover opens a Planned discovery per undecided finding, adds its index line, and records the finding as discovery with that file; a Critical and a decided finding are left (AC-06, AC-08)', async () => {
  const dir = await four();
  const r = await discover(dir, '--by', OWNER);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /finding discover: 2 discovery files opened in \.burhan\/discovery\/ and recorded as the decision of dev-dabour; it was run from the shell, so the turn-end report lists it as agent-run/);
  assert.match(r.out, /Critical findings are never opened this way \(#3\)/);
  const a = `${today()}-foo-finding-1.md`;
  const b = `${today()}-foo-finding-2.md`;
  assert.deepEqual(readdirSync(folder(dir)).sort(), [a, b, 'README.md'].sort());
  const text = read(join(folder(dir), a));
  assert.match(text, /^# Minor finding #1 of foo: src\/a\.ts:1 a small thing$/m);
  assert.match(text, /^- \*\*Status:\*\* Planned$/m);
  assert.match(text, /^- \*\*Found while working on:\*\* \.burhan\/work\/foo\/ \(review Sub-unit 1, reviews\/foo-review\.md\)$/m);
  assert.match(text, new RegExp(`^- \\*\\*Date:\\*\\* ${today()}$`, 'm'));
  assert.match(text, /## Problem\nMinor finding #1 \(review Sub-unit 1\): src\/a\.ts:1 a small thing\n\nLeft to a discovery by dev-dabour on /);
  assert.match(text, /## Root cause/);
  assert.match(read(join(folder(dir), b)), /Important finding #2 \(review Sub-unit 1\): src\/b\.ts:2 a \| pipe/);
  const index = read(join(folder(dir), 'README.md')).split('\n');
  assert.ok(index.includes(`- ${today()} — Minor finding #1 of foo: src/a.ts:1 a small thing — Planned (opened by burhan finding discover from foo) — ${a}`));
  assert.equal(index.filter((l) => l.startsWith('- ')).length, 2);
  assert.match(row(dir, 1), new RegExp(`\\| discovery \\| ${a} \\| dev-dabour · ${today()} \\|$`));
  assert.match(row(dir, 2), new RegExp(`\\| discovery \\| ${b} \\|`));
  assert.equal(row(dir, 3), '| 3 | Critical | src/c.ts:3 a big thing |  |  |  |');
  assert.match(row(dir, 4), /\| fixed \| unit 2 \|/);
  assert.match((await cli(dir, ['finding', 'list', 'foo'])).out, /4 findings, 1 without a decision/);
});

test('discover never overwrites a discovery file: a taken name refuses before anything is written (AC-06)', async () => {
  const dir = await four();
  mkdirSync(folder(dir), { recursive: true });
  const taken = join(folder(dir), `${today()}-foo-finding-2.md`);
  writeFileSync(taken, 'mine\n');
  const before = read(reviewFile(dir));
  const r = await discover(dir, '--by', OWNER);
  assert.equal(r.code, 2);
  assert.match(r.err, /already exists: finding discover never overwrites one, and wrote nothing/);
  assert.equal(read(taken), 'mine\n');
  assert.equal(read(reviewFile(dir)), before);
  assert.deepEqual(readdirSync(folder(dir)), [`${today()}-foo-finding-2.md`]);
});

test('discover appends to an existing discovery index and keeps its lines; WF_DISCOVERY_DIR says where (AC-06)', async () => {
  const dir = await four();
  writeFileSync(join(dir, '.burhan', 'workflow.config'), 'WF_DISCOVERY_DIR=notes/found\n');
  mkdirSync(join(dir, 'notes', 'found'), { recursive: true });
  writeFileSync(join(dir, 'notes', 'found', 'README.md'), '- 2026-01-01 — an old one — Resolved — x.md');
  assert.equal((await discover(dir, '--by', OWNER)).code, 0);
  const lines = read(join(dir, 'notes', 'found', 'README.md')).split('\n');
  assert.equal(lines[0], '- 2026-01-01 — an old one — Resolved — x.md');
  assert.equal(lines.filter((l) => l.includes('Planned (opened by burhan finding discover from foo)')).length, 2);
  assert.ok(!existsSync(folder(dir)));
});

test('discover is the owner\'s: --by must be a person; with nothing open, or only Criticals, it writes nothing (AC-04, AC-06)', async () => {
  const dir = await four();
  assert.match((await discover(dir)).err, /--by is needed: the name of the person who decides/);
  assert.match((await discover(dir, '--by', 'Claude')).err, /person who decides/);
  assert.ok(!existsSync(folder(dir)));
  await discover(dir, '--by', OWNER);
  const again = await discover(dir, '--by', OWNER);
  assert.equal(again.code, 0);
  assert.match(again.out, /no finding that can be opened this way; nothing was written/);
  assert.match(again.out, /Critical findings are never opened this way \(#3\)/);
  const clean = await withReviews([1]);
  assert.match((await discover(clean, '--by', OWNER)).out, /no finding without a decision; nothing was written/);
});

test('item finish keeps refusing until discover (or a decision per finding) has run, and then finishes (AC-06, AC-02)', async () => {
  const dir = await projectWithItem();
  for (const n of [1, 2]) await cli(dir, ['review', 'add', 'foo', '--kind', 'review', '--unit', String(n), '--by', BY]);
  await addFinding(dir, 'review:1', 'Minor', 'src/a.ts:1 a');
  await addFinding(dir, 'review:1', 'Important', 'src/b.ts:2 b');
  await cli(dir, ['finding', 'add', 'foo', '--in', 'review:2', '--none']);
  write(planFile(dir), read(planFile(dir)).replace(/^- \*\*Overall status:\*\* .*$/m, '- **Overall status:** In progress').replace(/· ⬜ Draft$/gm, '· ✅ Reviewed').replace(/- \[ \]/g, '- [x]'));
  const finish = () => cli(dir, ['item', 'finish', 'foo', '--evidence', 'ran the proof by hand']);
  assert.equal((await finish()).code, 2);
  assert.equal((await discover(dir, '--by', OWNER)).code, 0);
  const r = await finish();
  assert.equal(r.code, 0, r.err);
});

test('discover writes nothing when a review file cannot be written (Deviation 7, review Minor 17)', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const dir = await four();
  chmodSync(reviewFile(dir), 0o444);
  const r = await discover(dir, '--by', OWNER);
  chmodSync(reviewFile(dir), 0o644);
  assert.equal(r.code, 2);
  assert.match(r.err, /cannot be written: finding discover wrote nothing/);
  assert.equal(existsSync(folder(dir)) ? readdirSync(folder(dir)).length : 0, 0, 'no discovery file was written');
});

test('discover names a discovery folder that is a plain file and writes nothing (Deviation 7, review Minor 18)', async () => {
  const dir = await four();
  mkdirSync(join(dir, '.burhan'), { recursive: true });
  writeFileSync(folder(dir), 'not a folder');
  const r = await discover(dir, '--by', OWNER);
  assert.equal(r.code, 2);
  assert.match(r.err, /the discovery folder \.burhan\/discovery is not a folder/);
  assert.doesNotMatch(row(dir, 1), /discovery/);
});

test('discover prints the real folder when WF_DISCOVERY_DIR is an absolute path: it lands under the project (Deviation 18, review Minor 19)', async () => {
  const dir = await four();
  writeFileSync(join(dir, '.burhan', 'workflow.config'), 'WF_DISCOVERY_DIR=/found\n');
  const r = await discover(dir, '--by', OWNER);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /opened in found\//);
  assert.doesNotMatch(r.out, /opened in \/found/);
  assert.ok(existsSync(join(dir, 'found')));
});

test('discover puts back everything it wrote when a later write fails (Deviation 19, review Minor 21)', async () => {
  const dir = await four();
  mkdirSync(join(folder(dir), 'README.md'), { recursive: true });
  const before = read(reviewFile(dir));
  const r = await discover(dir, '--by', OWNER);
  assert.equal(r.code, 2);
  assert.match(r.err, /put back/);
  assert.deepEqual(readdirSync(folder(dir)).sort(), ['README.md']);
  assert.equal(read(reviewFile(dir)), before);
});
