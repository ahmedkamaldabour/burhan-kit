import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyFile, type VerifyRecord } from '../src/lib/verify.js';
import { cli, itemDir, projectWithItem, STATE } from './item-fixture.js';

const NODE = process.execPath;
const records = (dir: string): VerifyRecord[] => readFileSync(verifyFile(itemDir(dir), 'foo'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as VerifyRecord);
async function gitItem(): Promise<string> {
  const dir = await projectWithItem();
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}
const verify = (dir: string, ...command: string[]) => cli(dir, ['verify', 'foo', '--', ...command]);

test('a passing run is recorded with its command, exit code, time and code state', async () => {
  const dir = await gitItem();
  const r = await verify(dir, NODE, '-e', 'process.exit(0)');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /verify: passed — exit 0/);
  assert.match(r.out, /recorded in \.burhan\/work\/foo\/foo-verify\.jsonl/);
  const [rec] = records(dir);
  assert.equal(rec!.schema, 1);
  assert.deepEqual(rec!.argv, [NODE, '-e', 'process.exit(0)']);
  assert.equal(rec!.exit, 0);
  assert.equal(rec!.status, 'ok');
  assert.match(rec!.fingerprint ?? '', /^fp1:[0-9a-f]{64}$/);
  assert.ok(rec!.files > 0);
  assert.ok(!Number.isNaN(Date.parse(rec!.ts)));
});

test('a failing run and a command that cannot start are recorded as failures, and nothing is deleted', async () => {
  const dir = await gitItem();
  const failed = await verify(dir, NODE, '-e', 'process.exit(3)');
  assert.equal(failed.code, 1);
  assert.match(failed.out, /verify: FAILED — exit 3/);
  const missing = await verify(dir, 'burhan-no-such-program-xyz');
  assert.equal(missing.code, 1);
  assert.match(missing.out, /could not start/);
  const all = records(dir);
  assert.equal(all.length, 2);
  assert.deepEqual([all[0]!.status, all[0]!.exit], ['failed', 3]);
  assert.deepEqual([all[1]!.status, all[1]!.exit], ['not-started', null]);
});

test('writing the record, the state file and .burhan/local do not change the code state, a source edit does', async () => {
  const dir = await gitItem();
  await verify(dir, NODE, '-e', '0');
  writeFileSync(join(dir, STATE), '# State\n\n## Now\n- changed\n');
  await verify(dir, NODE, '-e', '0');
  writeFileSync(join(dir, 'a.ts'), 'code');
  await verify(dir, NODE, '-e', '0');
  const [a, b, c] = records(dir).map((r) => r.fingerprint);
  assert.equal(b, a);
  assert.notEqual(c, a);
});

test('outside a git checkout the record says there is no code state', async () => {
  const dir = await projectWithItem();
  const r = await verify(dir, NODE, '-e', '0');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /no code state/);
  const [rec] = records(dir);
  assert.equal(rec!.fingerprint, null);
  assert.match(rec!.why ?? '', /not a git checkout/);
});

test('an item with no folder, a bad slug and a missing command are refused and nothing is recorded', async () => {
  const dir = await gitItem();
  assert.equal((await cli(dir, ['verify', 'nope', '--', NODE, '-e', '0'])).code, 2);
  assert.equal((await cli(dir, ['verify', '../x', '--', NODE, '-e', '0'])).code, 2);
  const none = await cli(dir, ['verify', 'foo']);
  assert.equal(none.code, 2);
  assert.match(none.err, /needs a command after --/);
  assert.equal((await cli(dir, ['verify', 'foo', '--'])).code, 2);
  assert.equal((await cli(dir, ['verify', 'foo', 'extra', '--', NODE])).code, 2);
  assert.equal(existsSync(verifyFile(itemDir(dir), 'foo')), false);
});

test('a command that writes into the code state is reported: the record keeps the state before the run', async () => {
  const dir = await gitItem();
  const r = await verify(dir, NODE, '-e', "require('fs').writeFileSync('out.txt', 'x')");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /changed files the code state covers/);
});
