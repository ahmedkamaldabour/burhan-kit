import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectKey } from '../src/lib/evidence.js';
import { tmpDir } from './helpers.js';
import { cli, itemDir, projectWithItem } from './item-fixture.js';
import { ledgerFor, recordProject, verifyRun } from './record-fixture.js';

const savedState = process.env.XDG_STATE_HOME;
const savedDir = process.env.WF_EVIDENCE_DIR;
afterEach(() => {
  if (savedState === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = savedState;
  if (savedDir === undefined) delete process.env.WF_EVIDENCE_DIR; else process.env.WF_EVIDENCE_DIR = savedDir;
});
const lastLine = (out: string): string => out.trimEnd().split('\n').pop()!;

test('guide with no hooks: a passing burhan verify makes the full run line yes, by the record, and a code change takes it back', async () => {
  const dir = await recordProject();
  assert.match(lastLine((await cli(dir, ['guide', 'foo'])).out), /^full run: cannot tell — the evidence ledger has no record for this project yet$/);
  assert.equal((await verifyRun(dir, 0)).code, 0);
  const g = await cli(dir, ['guide', 'foo']);
  assert.equal(g.code, 0, g.err);
  assert.match(lastLine(g.out), /^full run: yes — by burhan verify record: .*process\.exitCode=0 passed at \S+ on the current code state/);
  const j = JSON.parse((await cli(dir, ['guide', 'foo', '--json'])).out) as { fullRun: { state: string; by: string; record: { kind: string }; ledger: { state: string } } };
  assert.deepEqual([j.fullRun.state, j.fullRun.by, j.fullRun.record.kind, j.fullRun.ledger.state], ['yes', 'verify record', 'proven', 'unknown']);
  assert.match(lastLine((await cli(dir, ['guide'])).out), /^full run: yes — by burhan verify record:/, 'the one item in Now, no slug given');
  writeFileSync(join(dir, 'a.ts'), 'changed after the run');
  assert.match(lastLine((await cli(dir, ['guide', 'foo'])).out), /^full run: cannot tell — .*; no burhan verify record counts \(the latest burhan verify run, .* was on another code state: the code changed since\)$/);
});

test('guide with hooks, right after burhan verify in the same turn: the ledger has the edit and not the run, the record decides and the line shows the ledger too', async () => {
  const dir = await recordProject();
  ledgerFor(dir, [{ kind: 'edit', ts: '2026-10-28T10:00:00Z', file: 'src/a.ts' }, { kind: 'cmd', ts: '2026-10-28T10:01:00Z', cmd: 'burhan verify foo -- npm test', exit: 0, status: 'ok' }]);
  const before = lastLine((await cli(dir, ['guide', 'foo'])).out);
  assert.match(before, /^full run: none — no passing full run is in the ledger \(the last code edit is src\/a\.ts at 2026-10-28T10:00:00Z\)/);
  await verifyRun(dir, 0);
  const after = lastLine((await cli(dir, ['guide', 'foo'])).out);
  assert.match(after, /^full run: yes — by burhan verify record: .* on the current code state \(the files now are the files it ran on\); the ledger: no passing full run is recorded \(the last code edit is src\/a\.ts at 2026-10-28T10:00:00Z\); a record shows that a command ran/);
});

test('a failed latest record stops the answer at no, as it stops item finish', async () => {
  const dir = await recordProject();
  await verifyRun(dir, 0);
  await verifyRun(dir, 1);
  const line = lastLine((await cli(dir, ['guide', 'foo'])).out);
  assert.match(line, /^full run: no — by burhan verify record: the latest run of .*process\.exitCode=1 on the current code state FAILED \(exit 1\) at \S+; the ledger: /);
});

test('without an item (no item in Now, or several) guide reads the ledger alone, as before', async () => {
  const dir = await recordProject();
  await verifyRun(dir, 0);
  const state = join(dir, '.burhan', 'local', 'PROGRESS.md');
  writeFileSync(state, '# State\n\n## Now\n\n## Waiting on you\n- nothing\n');
  const g = await cli(dir, ['guide']);
  assert.equal(g.code, 0, g.err);
  assert.match(lastLine(g.out), /^full run: cannot tell — the evidence ledger has no record for this project yet$/);
});

test('evidence --item says what the records show: with an empty ledger the first line no longer says "no evidence", and the full run line is the same as guide\'s', async () => {
  const dir = await recordProject();
  const none = await cli(dir, ['evidence', '--item', 'foo']);
  assert.match(none.out.split('\n')[0]!, /^no evidence recorded for item "foo" — /, 'no record: the line is unchanged');
  assert.doesNotMatch(none.out, /verify records:/);
  await verifyRun(dir, 0);
  const e = await cli(dir, ['evidence', '--item', 'foo']);
  assert.equal(e.code, 0, e.err);
  const lines = e.out.trimEnd().split('\n');
  assert.match(lines[0]!, /^no hook-ledger steps recorded for item "foo" — the turn-audit hook writes the ledger when a turn ends/);
  assert.match(lines[1]!, /^verify records: 1 for foo — the latest, .*process\.exitCode=0, passed \(exit 0\) at \S+ on the current code state; a record shows that a command ran and how it ended, not that it tests the right thing$/);
  assert.match(lines[2]!, /^full run: yes — by burhan verify record:/);
  assert.equal(lines.length, 3);
  assert.equal(lines[2], lastLine((await cli(dir, ['guide', 'foo'])).out));
  assert.deepEqual(JSON.parse((await cli(dir, ['evidence', '--item', 'foo', '--json'])).out), [], 'the JSON is the ledger alone, as before');
  assert.doesNotMatch((await cli(dir, ['evidence'])).out, /verify records:/, 'without --item nothing is added');
});

test('evidence --item with ledger steps lists them, then the records line, then the full run line; a record on another code state is said so', async () => {
  const dir = await recordProject();
  ledgerFor(dir, [{ kind: 'edit', ts: '2026-10-28T10:00:00Z', file: 'src/a.ts' }]);
  await verifyRun(dir, 1);
  writeFileSync(join(dir, 'a.ts'), 'changed after the run');
  const lines = (await cli(dir, ['evidence', '--item', 'foo'])).out.trimEnd().split('\n');
  assert.equal(lines.length, 3, lines.join('\n'));
  assert.match(lines[0]!, /edit {2}src\/a\.ts {2}\[foo\]$/);
  assert.match(lines[1]!, /^verify records: 1 for foo — the latest, .*process\.exitCode=1, FAILED \(exit 1\) at \S+ on another code state \(the code changed since\);/);
  assert.match(lines[2]!, /^full run: none — no passing full run is in the ledger.*; no burhan verify record counts \(the latest burhan verify run, .* was on another code state/);
});

test('an item slug that is not one, or has no folder, adds nothing and fails nothing', async () => {
  const dir = await recordProject();
  for (const slug of ['ghost', '../foo']) {
    const e = await cli(dir, ['evidence', '--item', slug]);
    assert.equal(e.code, 0, `${slug}: ${e.err}`);
    assert.doesNotMatch(e.out, /verify records:/, slug);
  }
});

test('an item folder that is a link leading outside the project is not read: guide and evidence --item see no record there; a link that stays inside is read', async () => {
  const dir = await recordProject();
  await verifyRun(dir, 0);
  const inside = itemDir(dir, 'moved-foo');
  renameSync(itemDir(dir), inside);
  symlinkSync(inside, itemDir(dir));
  assert.match(lastLine((await cli(dir, ['guide', 'foo'])).out), /^full run: yes — by burhan verify record:/, 'allowed: the link stays inside the project');
  assert.match((await cli(dir, ['evidence', '--item', 'foo'])).out, /verify records: 1 for foo/, 'allowed: evidence reads it too');
  const outside = join(tmpDir('burhan-outside-'), 'foo');
  unlinkSync(itemDir(dir));
  renameSync(inside, outside);
  symlinkSync(outside, itemDir(dir));
  const g = await cli(dir, ['guide', 'foo']);
  assert.equal(g.code, 0, g.err);
  assert.match(lastLine(g.out), /^full run: cannot tell — the evidence ledger has no record for this project yet$/, 'denied: the record outside is not read');
  const e = await cli(dir, ['evidence', '--item', 'foo']);
  assert.equal(e.code, 0, e.err);
  assert.doesNotMatch(e.out, /verify records:|by burhan verify record/);
  assert.match(e.out, /^no evidence recorded for item "foo"/);
});

test('guide with no git checkout and a ledger that cannot be read: the stated line says the ledger was not looked at', async () => {
  const dir = await projectWithItem();
  writeFileSync(join(dir, '.burhan', 'workflow.config'), "WF_CODE_REGEX='[.]ts$'\nWF_FULL_TEST_REGEX='process[.]exitCode'\n");
  process.env.XDG_STATE_HOME = tmpDir('burhan-noledger-');
  process.env.WF_EVIDENCE_DIR = '';
  assert.equal((await verifyRun(dir, 0)).code, 0);
  const ok = lastLine((await cli(dir, ['guide', 'foo'])).out);
  assert.match(ok, /^full run: yes \(stated\) — by burhan verify record: .* and the ledger holds no step for this project, so a code edit after it was not looked for/, 'control: with a readable, empty ledger the line says nothing was looked at');
  const folder = join(process.env.XDG_STATE_HOME, 'burhan', 'evidence', projectKey(dir));
  mkdirSync(join(folder, '..'), { recursive: true });
  writeFileSync(folder, 'a file where the ledger folder should be');
  const g = await cli(dir, ['guide', 'foo']);
  assert.equal(g.code, 0, g.err);
  assert.match(lastLine(g.out), /^full run: yes \(stated\) — by burhan verify record: .* so it cannot be compared with the files now, and the ledger could not be read, so a code edit after it was not looked for; the ledger: cannot tell — the evidence ledger could not be read \(\w+\); a record shows/);
  assert.doesNotMatch(lastLine(g.out), /the ledger shows no code edit after it/);
});
