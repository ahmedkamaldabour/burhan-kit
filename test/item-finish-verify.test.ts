import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectKey } from '../src/lib/evidence.js';
import { itemFinish } from '../src/lib/item-finish.js';
import { verifyFile } from '../src/lib/verify.js';
import { capture, tmpDir } from './helpers.js';
import { cli, itemDir, planFile, projectWithItem, read, write } from './item-fixture.js';
import { reviewsDecided } from './findings-fixture.js';

const NODE = process.execPath;
const savedState = process.env.XDG_STATE_HOME;
afterEach(() => { if (savedState === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = savedState; });

/** An item ready to finish except for its proof, in a git checkout (unless `git: false`), with code = *.ts and a proof = a command that names `proof` (default
 *  `node`: the tests run node as their proof). The evidence store is an empty folder of this test, so there is no hook ledger unless `withLedger` writes one. */
async function ready(o: { git?: boolean; proof?: string } = {}): Promise<string> {
  const dir = await projectWithItem();
  if (o.git !== false) spawnSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(join(dir, '.burhan', 'workflow.config'), `WF_CODE_REGEX='[.]ts$'\nWF_EVIDENCE_REGEX='${o.proof ?? 'node'}'\n`);
  process.env.XDG_STATE_HOME = tmpDir('burhan-noledger-');
  write(planFile(dir), read(planFile(dir)).replace(/^- \*\*Overall status:\*\* .*$/m, '- **Overall status:** In progress').replace(/· ⬜ Draft$/gm, '· ✅ Reviewed').replace(/- \[ \]/g, '- [x]'));
  await reviewsDecided(dir);
  return dir;
}
function withLedger(dir: string, recs: object[]): void {
  const folder = join(process.env.XDG_STATE_HOME!, 'burhan', 'evidence', projectKey(dir), 'S1');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'T1.jsonl'), recs.map((r, i) => JSON.stringify({ agent: 'claude', session: 'S1', turn: 'T1', seq: i + 1, item: 'foo', project: dir, ...r })).join('\n') + '\n');
}
const verify = (dir: string, code: number) => cli(dir, ['verify', 'foo', '--', NODE, '-e', `process.exit(${code})`]);
const finish = (dir: string, ...args: string[]) => cli(dir, ['item', 'finish', 'foo', ...args]);
const status = (dir: string): string => /\*\*Overall status:\*\* (.*)$/m.exec(read(planFile(dir)))?.[1] ?? '';

test('a passing verify record on the current code state proves the finish, with or without hooks', async () => {
  const dir = await ready();
  assert.equal((await verify(dir, 0)).code, 0);
  const r = await finish(dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /proven by burhan verify: .* passed at .* on the current code state/);
  assert.equal(status(dir), 'Completed');
  // with hooks: the ledger shows a code edit and no proof after it; the verify record still proves the finish
  const hooked = await ready();
  withLedger(hooked, [{ kind: 'edit', ts: '2026-10-27T10:00:00Z', file: 'src/a.ts' }]);
  assert.equal((await verify(hooked, 0)).code, 0);
  assert.equal((await finish(hooked)).code, 0);
});

test('the latest proof run on the current code state decides: a later failure stops the finish, even with --evidence', async () => {
  const dir = await ready();
  await verify(dir, 0);
  await verify(dir, 1);
  const r = await finish(dir, '--evidence', 'it passed earlier');
  assert.equal(r.code, 2);
  assert.match(r.err, /the latest burhan verify run on the current code state failed/);
  assert.equal(status(dir), 'In progress');
  await verify(dir, 0);
  assert.equal((await finish(dir)).code, 0);
});

test('a record taken before the code changed does not count, and the refusal says so', async () => {
  const dir = await ready();
  await verify(dir, 0);
  writeFileSync(join(dir, 'a.ts'), 'changed after the proof');
  const r = await finish(dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /was on another code state: the code changed since/);
  assert.match(r.err, /burhan verify foo -- <proof command>/);
});

test('a record whose command is not a proof command does not count', async () => {
  const dir = await ready({ proof: 'npm test' });
  await verify(dir, 0);
  const r = await finish(dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /none matches WF_EVIDENCE_REGEX/);
});

test('with no hook ledger and no verify record, finish refuses and names burhan verify, or takes --evidence as stated', async () => {
  const dir = await ready();
  const r = await finish(dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /no hook ledger and no burhan verify record/);
  assert.match(r.err, /burhan verify foo -- <proof command>/);
  const stated = await finish(dir, '--evidence', 'ran the tests by hand');
  assert.equal(stated.code, 0, stated.err);
  assert.equal(status(dir), 'Completed · stated evidence: ran the tests by hand');
});

test('a passing record with no code state is only stated', async () => {
  const dir = await ready({ git: false });
  await verify(dir, 0);
  const r = await finish(dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /not proven: the burhan verify record has no code state/);
  assert.match(status(dir), /^Completed · stated evidence: burhan verify .* passed at .* with no code state/);
});

test('hand-written or torn lines in the record file are skipped', async () => {
  const dir = await ready();
  mkdirSync(itemDir(dir), { recursive: true });
  appendFileSync(verifyFile(itemDir(dir), 'foo'), 'not json\n{"schema":1,"cmd":"node"}\n');
  const r = await finish(dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /no hook ledger and no burhan verify record/);
});

test('outside a git checkout a failed latest run stops the finish too, even with --evidence', async () => {
  const dir = await ready({ git: false });
  await verify(dir, 0);
  await verify(dir, 1);
  const r = await finish(dir, '--evidence', 'it passed earlier');
  assert.equal(r.code, 2);
  assert.match(r.err, /the latest burhan verify run \(no code state\) failed/);
});

test('outside a git checkout a passing run does not count when the ledger shows a code edit after it', async () => {
  const stale = await ready({ git: false });
  await verify(stale, 0);
  withLedger(stale, [{ kind: 'edit', ts: '2999-01-01T00:00:00Z', file: 'src/a.ts' }]);
  const r = await finish(stale);
  assert.equal(r.code, 2);
  assert.match(r.err, /has no code state and the ledger shows a code edit after it: src\/a\.ts/);
  const fresh = await ready({ git: false });
  withLedger(fresh, [{ kind: 'edit', ts: '2000-01-01T00:00:00Z', file: 'src/a.ts' }]);
  await verify(fresh, 0);
  const ok = await finish(fresh);
  assert.equal(ok.code, 0, ok.err);
  assert.match(status(fresh), /^Completed · stated evidence: burhan verify /);
});

test('a record that says ok with an exit other than 0 is not a record', async () => {
  const dir = await ready();
  await verify(dir, 0);
  const file = verifyFile(itemDir(dir), 'foo');
  const real = JSON.parse(readFileSync(file, 'utf8').trim()) as Record<string, unknown>;
  writeFileSync(file, `${JSON.stringify({ ...real, exit: 3 })}\n`);
  const r = await finish(dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /no hook ledger and no burhan verify record/);
});

// ---- item evidence-honesty-verify-records ----
test('an empty WF_EVIDENCE_REGEX takes any burhan verify command, and then the plan says the proof was stated, not proven', async () => {
  const dir = await ready({ proof: '' });
  await verify(dir, 0);
  const r = await finish(dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /\(evidence stated, not proven: WF_EVIDENCE_REGEX is empty, so the burhan verify command was not checked to be a proof command\)/);
  assert.doesNotMatch(r.out, /proven by burhan verify/);
  assert.match(status(dir), /^Completed · stated evidence: burhan verify .* passed at \S+ on the current code state; WF_EVIDENCE_REGEX is empty, so any command counted$/);
  const failing = await ready({ proof: '' });
  await verify(failing, 1);
  const f = await finish(failing, '--evidence', 'by hand');
  assert.equal(f.code, 2);
  assert.match(f.err, /the latest burhan verify run on the current code state failed/);
});

test('with an empty WF_EVIDENCE_REGEX the refusal does not promise a command the pattern matches', async () => {
  const empty = await finish(await ready({ proof: '' }));
  assert.equal(empty.code, 2);
  assert.match(empty.err, /burhan verify foo -- <proof command> \(WF_EVIDENCE_REGEX is empty, so any command counts, and the plan will say the proof was stated\)/);
  assert.doesNotMatch(empty.err, /a command WF_EVIDENCE_REGEX matches/);
  const set = await finish(await ready());
  assert.match(set.err, /burhan verify foo -- <proof command> \(a command WF_EVIDENCE_REGEX matches\)/);
});

test('a record with no code state, in a project that has a code state now, is refused as not comparable, not as "the code changed since"', async () => {
  const dir = await ready({ git: false });
  await verify(dir, 0);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const r = await finish(dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /the latest burhan verify run, .* at \S+, has no code state and the project has one now, so it cannot be compared: run burhan verify again/);
  assert.doesNotMatch(r.err, /the code changed since/);
  assert.equal((await verify(dir, 0)).code, 0);
  assert.equal((await finish(dir)).code, 0, 'a new record, taken with the code state, proves');
});

test('a ledger edit whose time cannot be read counts as later than a record with no code state', async () => {
  const dir = await ready({ git: false });
  await verify(dir, 0);
  withLedger(dir, [{ kind: 'edit', ts: 'garbage', file: 'src/a.ts' }]);
  const r = await finish(dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /has no code state and the ledger shows a code edit after it: src\/a\.ts at garbage/);
  assert.equal(status(dir), 'In progress');
});

test('a record that proves, or fails, is decided without reading the ledger: a damaged ledger cannot turn it into a stack trace', async () => {
  const unreadable = new Proxy({}, { get: () => { throw new Error('the ledger was read'); } }) as NodeJS.ProcessEnv;
  const proven = await ready();
  await verify(proven, 0);
  const c = capture(proven);
  assert.equal(itemFinish(proven, 'foo', c.io, { env: unreadable }), 0);
  assert.match(c.o.out, /proven by burhan verify/);
  const failed = await ready();
  await verify(failed, 1);
  assert.throws(() => itemFinish(failed, 'foo', capture(failed).io, { env: unreadable }), /the latest burhan verify run on the current code state failed/);
});

test('a ledger that cannot be read is said, not a stack trace, and it never lets a finish through without a proof', async () => {
  const dir = await ready();
  const folder = join(process.env.XDG_STATE_HOME!, 'burhan', 'evidence', projectKey(dir));
  mkdirSync(join(folder, '..'), { recursive: true });
  writeFileSync(folder, 'a file where the ledger folder should be');
  const r = await finish(dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /cannot finish foo: the evidence ledger could not be read \(\w+\) and no burhan verify record proves the current code state/);
  const stated = await finish(dir, '--evidence', 'ran it by hand');
  assert.equal(stated.code, 0, stated.err);
  assert.match(stated.out, /evidence stated, not proven: the evidence ledger could not be read/);
  assert.equal(status(dir), 'Completed · stated evidence: ran it by hand');
  const g = await cli(dir, ['guide', 'foo']);
  assert.equal(g.code, 0, g.err);
  assert.match(g.out, /^full run: cannot tell — the evidence ledger could not be read \(\w+\)$/m);
  const e = await cli(dir, ['evidence', '--item', 'foo']);
  assert.equal(e.code, 2);
  assert.match(e.err, /^burhan: the evidence ledger could not be read \(\w+\): /);
  assert.doesNotMatch(e.err, /node:internal|node:fs|\n\s+at /, 'no stack trace');
});

test('an item folder that is a link leading outside the project gives no record: the finish asks for a proof, as for an item with none', async () => {
  const dir = await ready();
  assert.equal((await verify(dir, 0)).code, 0);
  const outside = join(tmpDir('burhan-outside-'), 'foo');
  renameSync(itemDir(dir), outside);
  symlinkSync(outside, itemDir(dir));
  const r = await finish(dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /cannot finish foo: this project has no hook ledger and no burhan verify record proves the current code state/);
  assert.doesNotMatch(r.out + r.err, /Completed|proven by burhan verify/);
  assert.match(status(dir), /^In progress/, 'the plan is not touched');
});

test('a record with no code state, finished while the ledger cannot be read: the plan and the output say the code-edit check was not made; a readable ledger leaves the text as it was', async () => {
  const clause = /; the evidence ledger could not be read \(\w+\), so a code edit after the record was not looked for/;
  const unreadable = await ready({ git: false });
  assert.equal((await verify(unreadable, 0)).code, 0);
  const folder = join(process.env.XDG_STATE_HOME!, 'burhan', 'evidence', projectKey(unreadable));
  mkdirSync(join(folder, '..'), { recursive: true });
  writeFileSync(folder, 'a file where the ledger folder should be');
  const denied = await finish(unreadable);
  assert.equal(denied.code, 0, denied.err);
  assert.match(denied.out, /^item finish: foo is Completed \(evidence stated, not proven: the burhan verify record has no code state; the evidence ledger could not be read \(\w+\), so a code edit after the record was not looked for\)$/m);
  assert.match(status(unreadable), /^Completed · stated evidence: burhan verify .* passed at .* with no code state \(.*\); the evidence ledger could not be read \(\w+\), so a code edit after the record was not looked for$/);

  const readable = await ready({ git: false });
  assert.equal((await verify(readable, 0)).code, 0);
  withLedger(readable, [{ kind: 'cmd', cmd: 'node x.js', status: 'ok', ts: '2020-01-01T00:00:00.000Z' }]);
  const allowed = await finish(readable);
  assert.equal(allowed.code, 0, allowed.err);
  assert.match(allowed.out, /^item finish: foo is Completed \(evidence stated, not proven: the burhan verify record has no code state\)$/m);
  assert.doesNotMatch(allowed.out, clause);
  assert.doesNotMatch(status(readable), /ledger/);
});
