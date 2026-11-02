import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectKey } from '../src/lib/evidence.js';
import { verifyFile } from '../src/lib/verify.js';
import { tmpDir } from './helpers.js';
import { cli, itemDir, planFile, projectWithItem, read, write } from './item-fixture.js';

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
