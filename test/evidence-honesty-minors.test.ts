import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evidence, projectKey } from '../src/lib/evidence.js';
import { fullRunFor } from '../src/lib/full-run.js';
import { itemRecordsQuiet, type ItemRecords } from '../src/lib/verify.js';
import { runCli } from '../src/main.js';
import { cli, planFile, projectWithItem, read, write } from './item-fixture.js';
import { reviewsDecided } from './findings-fixture.js';
import { ledgerFor, NODE, recordProject, verifyRun } from './record-fixture.js';
import { capture, tmpDir } from './helpers.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const flat = (file: string): string => readFileSync(join(ROOT, file), 'utf8').replace(/\s+/g, ' ');
const lastLine = (out: string): string => out.trimEnd().split('\n').pop()!;
const saved = { state: process.env.XDG_STATE_HOME, ev: process.env.WF_EVIDENCE_DIR };
afterEach(() => {
  if (saved.state === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = saved.state;
  if (saved.ev === undefined) delete process.env.WF_EVIDENCE_DIR; else process.env.WF_EVIDENCE_DIR = saved.ev;
});

test('docs/configuration.md names the pattern each command reads, says what "records first" means, and the empty-key behaviour (AC-01, AC-10)', () => {
  const d = flat('docs/configuration.md');
  assert.ok(d.includes('this line picks the commands that count with `WF_FULL_TEST_REGEX`, and `item finish` picks them with `WF_EVIDENCE_REGEX`'));
  assert.ok(d.includes('so when the two patterns differ a record can make this line `yes` where `item finish` does not count it'));
  assert.ok(d.includes('the records are weighed first and the ledger decides only when no record counts'));
  assert.ok(!d.includes('with the function `item finish` uses and in its order (records first)'));
  assert.ok(d.includes('With `WF_FULL_TEST_REGEX` empty the `full run:` line is `cannot tell` and no record is read for it, yet `burhan evidence --item <slug>` still prints its `verify records:` line'));
});

test('stage-finish.md says the burhan verify command must match WF_FULL_TEST_REGEX (AC-02)', () => {
  const s = flat('kit/phases/stage-finish.md');
  assert.ok(s.includes('through `burhan verify <slug> -- <command>` with a command `WF_FULL_TEST_REGEX` matches: its record is taken against the files as they are now'));
  assert.ok(s.includes('(with the key empty it says `cannot tell`)'));
});

const complete = async (dir: string): Promise<void> => {
  write(planFile(dir), read(planFile(dir))
  .replace(/^- \*\*Overall status:\*\* .*$/m, '- **Overall status:** In progress').replace(/· ⬜ Draft$/gm, '· ✅ Reviewed').replace(/- \[ \]/g, '- [x]'));
  await reviewsDecided(dir);
};

test('a record whose command does not match: the full run line names WF_FULL_TEST_REGEX and item finish names WF_EVIDENCE_REGEX (AC-03)', async () => {
  const dir = await recordProject('process[.]exitCode', "WF_EVIDENCE_REGEX='nothing-matches-this'\n");
  await complete(dir);
  assert.equal((await cli(dir, ['verify', 'foo', '--', NODE, '-e', '1'])).code, 0);
  assert.match(lastLine((await cli(dir, ['guide', 'foo'])).out), /no burhan verify record counts \(no burhan verify record runs a proof command: 1 record\(s\), none matches WF_FULL_TEST_REGEX\)$/);
  const r = await cli(dir, ['item', 'finish', 'foo']);
  assert.equal(r.code, 2);
  assert.match(r.err, /none matches WF_EVIDENCE_REGEX/);
});

test('item finish with --evidence says "no burhan verify record that counts" when a record exists and does not count, and keeps the old words with no record (AC-04)', async () => {
  const dir = await recordProject('process[.]exitCode', "WF_EVIDENCE_REGEX='node'\n");
  await complete(dir);
  assert.equal((await verifyRun(dir, 0)).code, 0);
  writeFileSync(join(dir, 'a.ts'), 'changed after the proof');
  const r = await cli(dir, ['item', 'finish', 'foo', '--evidence', 'ran it by hand']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /not proven: no hook ledger and no burhan verify record that counts\)/);

  const bare = await recordProject('process[.]exitCode', "WF_EVIDENCE_REGEX='node'\n");
  await complete(bare);
  const b = await cli(bare, ['item', 'finish', 'foo', '--evidence', 'ran it by hand']);
  assert.equal(b.code, 0, b.err);
  assert.match(b.out, /not proven: no hook ledger and no burhan verify record\)/);
});

test('the (stated) line with a readable but empty ledger says nothing was looked at; with steps in the ledger it keeps its claim (AC-05)', async () => {
  const dir = await projectWithItem(); // not a git checkout: a record has no code state
  writeFileSync(join(dir, '.burhan', 'workflow.config'), "WF_CODE_REGEX='[.]ts$'\nWF_FULL_TEST_REGEX='process[.]exitCode'\n");
  process.env.XDG_STATE_HOME = tmpDir('burhan-noledger-');
  process.env.WF_EVIDENCE_DIR = '';
  assert.equal((await verifyRun(dir, 0)).code, 0);
  const empty = lastLine((await cli(dir, ['guide', 'foo'])).out);
  assert.match(empty, /^full run: yes \(stated\) — by burhan verify record: .* so it cannot be compared with the files now, and the ledger holds no step for this project, so a code edit after it was not looked for; the ledger: cannot tell — /);
  assert.doesNotMatch(empty, /the ledger shows no code edit after it/);
  ledgerFor(dir, [{ kind: 'edit', ts: '2026-10-28T09:00:00Z', file: 'docs/x.md' }]);
  const steps = lastLine((await cli(dir, ['guide', 'foo'])).out);
  assert.match(steps, /and the ledger shows no code edit after it \(not seen by the ledger: shell edits/);
});

test('evidence --last 0 says it shows no steps, and still shows the verify records line (AC-06)', async () => {
  const dir = await recordProject();
  ledgerFor(dir, [{ kind: 'cmd', ts: '2026-10-28T10:00:00Z', cmd: 'npm test', exit: 0, status: 'ok' }]);
  await verifyRun(dir, 0);
  const e = await cli(dir, ['evidence', '--item', 'foo', '--last', '0']);
  assert.equal(e.code, 0, e.err);
  const lines = e.out.trimEnd().split('\n');
  assert.equal(lines[0], 'no steps shown: --last 0 asks for none');
  assert.match(lines[1]!, /^verify records: 1 for foo — /);
  assert.doesNotMatch(e.out, /no evidence recorded|no hook-ledger steps recorded/);
  const p = await cli(dir, ['evidence', '--last', '0']);
  assert.equal(p.out.split('\n')[0], 'no steps shown: --last 0 asks for none');
  assert.deepEqual(JSON.parse((await cli(dir, ['evidence', '--item', 'foo', '--last', '0', '--json'])).out), []);
});

test('with WF_FULL_TEST_REGEX empty and a record, evidence --item prints the hook-ledger line and the verify records line, and full run says cannot tell (AC-10)', async () => {
  const dir = await recordProject('');
  await verifyRun(dir, 0);
  const lines = (await cli(dir, ['evidence', '--item', 'foo'])).out.trimEnd().split('\n');
  assert.match(lines[0]!, /^no hook-ledger steps recorded for item "foo" — /);
  assert.match(lines[1]!, /^verify records: 1 for foo — /);
  assert.match(lines[2]!, /^full run: cannot tell — WF_FULL_TEST_REGEX is empty or not usable/);
  assert.equal(lines.length, 3);
});

test('evidence and fullRunFor use the records they are given and do not read the item again (AC-07)', async () => {
  const dir = await recordProject();
  await verifyRun(dir, 0);
  const real = itemRecordsQuiet(dir, 'foo')!;
  const failed: ItemRecords = { records: real.records.map((r) => ({ ...r, status: 'failed' as const, exit: 1 })), current: real.current };
  assert.equal(fullRunFor(dir, process.env, { slug: 'foo' }).record?.kind, 'proven', 'control: read from the files');
  assert.equal(fullRunFor(dir, process.env, { slug: 'foo', records: failed }).record?.kind, 'failed');
  assert.equal(fullRunFor(dir, process.env, { slug: 'foo', records: null }).record, undefined, 'null: the item has no records to read');
  const c = capture(dir);
  assert.equal(evidence({ target: dir, item: 'foo', json: false, records: failed }, c.io), 0);
  assert.match(c.o.out, /verify records: 1 for foo — the latest, .*, FAILED \(exit 1\)/);
  const none = capture(dir);
  assert.equal(evidence({ target: dir, item: 'foo', json: false, records: null }, none.io), 0);
  assert.doesNotMatch(none.o.out, /verify records:/);
  // the CLI gives the same lines as before when the files do not change
  const e = (await cli(dir, ['evidence', '--item', 'foo'])).out.trimEnd().split('\n');
  assert.match(e[1]!, /^verify records: 1 for foo — .*passed \(exit 0\)/);
  assert.equal(e[2], lastLine((await cli(dir, ['guide', 'foo'])).out));
});

test('burhan stats on a ledger folder that cannot be listed gives one line and exit 2, the words burhan evidence uses (AC-08)', async () => {
  const dir = await recordProject();
  const folder = join(process.env.XDG_STATE_HOME!, 'burhan', 'evidence', projectKey(dir));
  mkdirSync(join(folder, '..'), { recursive: true });
  writeFileSync(folder, 'a file where the ledger folder should be');
  const s = capture(dir);
  assert.equal(await runCli(['stats'], s.io), 2);
  assert.match(s.o.err, /^burhan: the evidence ledger could not be read \(\w+\): .+\n$/);
  const ev = capture(dir);
  assert.equal(await runCli(['evidence'], ev.io), 2);
  assert.equal(s.o.err, ev.o.err);
});

test('item finish treats a ledger folder with no step of the item like no ledger; a step of the item (a docs edit) still finishes it (AC-09)', async () => {
  const dir = await recordProject('process[.]exitCode', "WF_EVIDENCE_REGEX='node'\n");
  await complete(dir);
  writeFileSync(join(dir, 'a.ts'), 'code changed, nothing proved it');
  mkdirSync(join(process.env.XDG_STATE_HOME!, 'burhan', 'evidence', projectKey(dir)), { recursive: true });
  const refused = await cli(dir, ['item', 'finish', 'foo']);
  assert.equal(refused.code, 2);
  assert.match(refused.err, /cannot finish foo: the hook ledger has no step of this item and no burhan verify record proves the current code state/);
  const stated = await cli(dir, ['item', 'finish', 'foo', '--evidence', 'ran it by hand']);
  assert.equal(stated.code, 0, stated.err);
  assert.match(stated.out, /not proven: the hook ledger has no step of this item and no burhan verify record\)/);

  const docsOnly = await recordProject('process[.]exitCode', "WF_EVIDENCE_REGEX='node'\n");
  await complete(docsOnly);
  ledgerFor(docsOnly, [{ kind: 'edit', ts: '2026-10-28T09:00:00Z', file: 'docs/x.md' }]);
  const ok = await cli(docsOnly, ['item', 'finish', 'foo']);
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.out, /no code edit of this item is in the ledger, so no proof was asked for/);

  const proven = await recordProject('process[.]exitCode', "WF_EVIDENCE_REGEX='node'\n");
  await complete(proven);
  mkdirSync(join(process.env.XDG_STATE_HOME!, 'burhan', 'evidence', projectKey(proven)), { recursive: true });
  assert.equal((await verifyRun(proven, 0)).code, 0);
  assert.match((await cli(proven, ['item', 'finish', 'foo'])).out, /proven by burhan verify/);
});

test('docs/configuration.md says an empty-for-this-item ledger asks for a proof (AC-09)', () => {
  assert.ok(flat('docs/configuration.md').includes('`item finish` treats a ledger folder that holds no step of the item, and none under no item, like no ledger'));
});
