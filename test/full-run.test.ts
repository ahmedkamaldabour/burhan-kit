import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evidenceMatches } from '../src/hooks/core/evidence-cmd.mjs';
import { ereToJs, projectKey, type LedgerRecord } from '../src/lib/evidence.js';
import { fullRunFor, fullRunLine, fullRunOf, withRecords, type FullRun } from '../src/lib/full-run.js';
import type { VerifyRecord } from '../src/lib/verify.js';
import { cli, projectWithItem } from './item-fixture.js';
import { recordProject, verifyRun } from './record-fixture.js';
import { tmpDir } from './helpers.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REPO_PATTERN = '^npm test( [0-9]*>.*)?$'; // this repository's own WF_FULL_TEST_REGEX (pinned against .burhan/workflow.config below)
const CFG = { code: '^src/.*\\.ts$', test: '^test/.*\\.test\\.ts$', full: '^npm test$' };

let n = 0;
const rec = (o: Partial<LedgerRecord>): LedgerRecord => ({ ts: new Date(Date.UTC(2026, 9, 28, 10, ++n)).toISOString().replace(/\.\d{3}Z$/, 'Z'), agent: 'claude', session: 'S1', turn: 'T1', seq: n, kind: 'cmd', item: 'foo', project: '/p', ...o });
const edit = (file: string): LedgerRecord => rec({ kind: 'edit', file });
const run = (cmd: string, status = 'ok'): LedgerRecord => rec({ kind: 'cmd', cmd, status, exit: status === 'ok' ? 0 : status === 'failed' ? 1 : null });

test('yes: a passing full run after the last code edit', () => {
  const f = fullRunOf([edit('src/a.ts'), run('npm test')], CFG);
  assert.equal(f.state, 'yes');
  assert.equal(f.command, 'npm test');
  assert.equal(f.edit?.file, 'src/a.ts');
});

test('no: the last code edit is after the last full run', () => {
  const f = fullRunOf([run('npm test'), edit('src/a.ts')], CFG);
  assert.equal(f.state, 'no');
  assert.equal(f.edit?.file, 'src/a.ts');
  assert.equal(f.command, 'npm test');
});

test('a docs-only edit after the run changes nothing: docs, CHANGELOG, ROADMAP and item files are not code', () => {
  const f = fullRunOf([edit('src/a.ts'), run('npm test'), edit('docs/x.md'), edit('CHANGELOG.md'), edit('ROADMAP.md'), edit('.internal/work/foo/foo-story.md')], CFG);
  assert.equal(f.state, 'yes');
  assert.equal(f.edit?.file, 'src/a.ts');
});

test('a test-file edit after the run counts as code', () => {
  const f = fullRunOf([edit('src/a.ts'), run('npm test'), edit('test/a.test.ts')], CFG);
  assert.equal(f.state, 'no');
  assert.equal(f.edit?.file, 'test/a.test.ts');
});

test('a piped run, a failed run, a run of one file and a mention do not count', () => {
  const f = fullRunOf([edit('src/a.ts'), run('npm test | tail -3'), run('npm test', 'failed'), run('node --test test/a.test.js'), run('echo "npm test"'), run('npm test -- test/a.test.ts')], CFG);
  assert.equal(f.state, 'none');
  assert.equal(f.edit?.file, 'src/a.ts');
});

test('a run started in the background has no result: it never counts, and it is named when it follows the last code edit', () => {
  const bg = run('npm test > /tmp/f.log 2>&1', 'background');
  const cfg = { ...CFG, full: REPO_PATTERN };
  const waiting = fullRunOf([edit('src/a.ts'), bg], cfg);
  assert.equal(waiting.state, 'none');
  assert.equal(waiting.background?.command, 'npm test > /tmp/f.log 2>&1');
  assert.match(fullRunLine(waiting), /started in the background at .* no result in the ledger/);
  const stale = fullRunOf([bg, edit('src/a.ts')], cfg); // the background run came before the edit: not waited for
  assert.equal(stale.background, undefined);
  const done = fullRunOf([edit('src/a.ts'), bg, run('npm test')], { ...cfg, full: '^npm test( [0-9]*>.*)?$' });
  assert.equal(done.state, 'yes');
  assert.equal(done.background, undefined);
});

test('no code edit in the ledger and a passing run: yes, and the line says no code edit is recorded', () => {
  const f = fullRunOf([run('npm test')], CFG);
  assert.equal(f.state, 'yes');
  assert.equal(f.edit, null);
  assert.match(fullRunLine(f), /no code edit is in the ledger/);
});

test('both code patterns empty: every edit counts', () => {
  const f = fullRunOf([edit('src/a.ts'), run('npm test'), edit('docs/x.md')], { full: '^npm test$' });
  assert.equal(f.state, 'no');
  assert.equal(f.edit?.file, 'docs/x.md');
});

test('with both code patterns empty or unusable the answer says every edit counts; with one usable it does not', () => {
  const recs = [edit('src/a.ts'), run('npm test'), edit('docs/x.md')];
  for (const cfg of [{ full: '^npm test$' }, { full: '^npm test$', code: '(', test: '' }]) {
    const f = fullRunOf(recs, cfg);
    assert.equal(f.everyEdit, true);
    assert.match(fullRunLine(f), /every edit counts: WF_CODE_REGEX and WF_TEST_REGEX are empty or not usable/);
  }
  const some = fullRunOf(recs, { ...CFG });
  assert.equal(some.everyEdit, undefined);
  assert.doesNotMatch(fullRunLine(some), /every edit counts/);
  assert.match(fullRunLine(fullRunOf([edit('src/a.ts')], { full: '^npm test$' })), /every edit counts/); // the none line too
});

test('cannot tell: no WF_FULL_TEST_REGEX, a pattern that does not compile, or no ledger', () => {
  for (const full of [undefined, '', '(']) {
    const f = fullRunOf([edit('src/a.ts'), run('npm test')], { ...CFG, full });
    assert.equal(f.state, 'unknown', String(full));
    assert.match(f.why ?? '', /WF_FULL_TEST_REGEX/);
  }
  const none = fullRunOf([], CFG);
  assert.equal(none.state, 'unknown');
  assert.match(none.why ?? '', /no record/);
});

test('the lines name the state, and say what the ledger cannot see', () => {
  const yes = fullRunLine(fullRunOf([edit('src/a.ts'), run('npm test')], CFG));
  const no = fullRunLine(fullRunOf([run('npm test'), edit('src/a.ts')], CFG));
  assert.match(yes, /^full run: yes — npm test passed at \S+ after the last code edit \(src\/a\.ts, \S+\)/);
  assert.match(no, /^full run: no — the last code edit is src\/a\.ts at \S+ and no passing full run follows it/);
  for (const l of [yes, no]) assert.match(l, /shell edits \(sed -i, scripts\)/);
  assert.match(fullRunLine(fullRunOf([edit('src/a.ts')], CFG)), /^full run: none — no passing full run is in the ledger/);
  assert.match(fullRunLine(fullRunOf([], { ...CFG, full: '' })), /^full run: cannot tell — WF_FULL_TEST_REGEX is empty or not usable/);
});

test('a long or multi-line command is shown as its first line, cut at 80 characters', () => {
  const long = `cd /x; npm test > /tmp/a.log 2>&1; echo ${'x'.repeat(200)}\ncat >> notes.md <<'EOF'\nmore\nEOF`;
  const line = fullRunLine(fullRunOf([edit('src/a.ts'), run(long)], { ...CFG, full: '^npm test( [0-9]*>.*)?$' }));
  assert.match(line, /^full run: yes — cd \/x; npm test > \/tmp\/a\.log 2>&1; echo x+… passed at /);
  assert.ok(!line.includes('\n') && !line.includes('cat >>') && line.length < 400, line);
});

test('this repository\'s own pattern counts npm test with a redirect and nothing narrower', () => {
  const re = new RegExp(ereToJs(REPO_PATTERN));
  for (const c of ['npm test', 'npm test > /tmp/a.log 2>&1', 'cd /x; npm test > /tmp/f.log 2>&1', 'npm test 2>&1']) assert.equal(evidenceMatches(re, c), true, c);
  for (const c of ['npm test -- test/a.test.ts', 'npm run test:node', 'echo "npm test"', 'node --test test/a.test.js']) assert.equal(evidenceMatches(re, c), false, c);
  const own = join(ROOT, '.burhan/workflow.config'); // git-ignored: absent in a clean checkout, so it is pinned only where it exists
  if (existsSync(own)) assert.match(readFileSync(own, 'utf8'), /^WF_FULL_TEST_REGEX='\^npm test\( \[0-9\]\*>\.\*\)\?\$'$/m);
});

// ---- through the commands ----
const savedState = process.env.XDG_STATE_HOME;
const savedDir = process.env.WF_EVIDENCE_DIR;
afterEach(() => {
  if (savedState === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = savedState;
  if (savedDir === undefined) delete process.env.WF_EVIDENCE_DIR; else process.env.WF_EVIDENCE_DIR = savedDir;
});
function ledger(dir: string, recs: Array<Record<string, unknown>>): void {
  const state = tmpDir('burhan-ledger-');
  process.env.XDG_STATE_HOME = state;
  process.env.WF_EVIDENCE_DIR = '';
  const folder = join(state, 'burhan', 'evidence', projectKey(dir), 'S1');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'T1.jsonl'), recs.map((r, i) => JSON.stringify({ agent: 'claude', session: 'S1', turn: 'T1', seq: i + 1, item: 'foo', project: dir, ...r })).join('\n') + '\n');
}
const config = (dir: string, extra = ''): void => writeFileSync(join(dir, '.burhan', 'workflow.config'), `WF_CODE_REGEX='[.]ts$'\nWF_FULL_TEST_REGEX='^npm test$'\n${extra}`);
const RUNS = [{ kind: 'edit', ts: '2026-10-28T10:00:00Z', file: 'src/a.ts' }, { kind: 'cmd', ts: '2026-10-28T10:05:00Z', cmd: 'npm test', exit: 0, status: 'ok' }];

test('guide prints the full run line and a fullRun object, with or without WF_SKILLS', async () => {
  const dir = await projectWithItem();
  config(dir);
  ledger(dir, RUNS);
  const g = await cli(dir, ['guide', 'foo']);
  assert.equal(g.code, 0, g.err);
  assert.match(g.out, /^full run: yes — npm test passed at 2026-10-28T10:05:00Z after the last code edit \(src\/a\.ts, 2026-10-28T10:00:00Z\)/m);
  assert.doesNotMatch(g.out, /^skill:/m);
  const j = JSON.parse((await cli(dir, ['guide', 'foo', '--json'])).out) as { fullRun: { state: string; command: string; edit: { file: string } }; skill: null };
  assert.equal(j.fullRun.state, 'yes');
  assert.equal(j.fullRun.command, 'npm test');
  assert.equal(j.fullRun.edit.file, 'src/a.ts');
  config(dir, 'WF_SKILLS=superpowers\n');
  assert.match((await cli(dir, ['guide', 'foo'])).out, /^full run: yes — /m);
});

test('guide says it cannot tell when the key is missing, and the command still succeeds', async () => {
  const dir = await projectWithItem();
  writeFileSync(join(dir, '.burhan', 'workflow.config'), "WF_CODE_REGEX='[.]ts$'\n");
  ledger(dir, RUNS);
  const g = await cli(dir, ['guide', 'foo']);
  assert.equal(g.code, 0, g.err);
  assert.match(g.out, /^full run: cannot tell — WF_FULL_TEST_REGEX is empty or not usable/m);
});

test('evidence --item ends with the full run line; its JSON is unchanged', async () => {
  const dir = await projectWithItem();
  config(dir);
  ledger(dir, RUNS);
  const text = await cli(dir, ['evidence', '--item', 'foo']);
  assert.equal(text.code, 0, text.err);
  const lines = text.out.trimEnd().split('\n');
  assert.match(lines[lines.length - 1]!, /^full run: yes — npm test passed at /);
  assert.equal(lines.filter((l) => l.startsWith('full run:')).length, 1);
  const json = JSON.parse((await cli(dir, ['evidence', '--item', 'foo', '--json'])).out) as unknown;
  assert.ok(Array.isArray(json) && json.length === 2);
  const all = await cli(dir, ['evidence']);
  assert.doesNotMatch(all.out, /^full run:/m); // without --item nothing is added
});

// ---- the item's burhan verify records (item evidence-honesty-verify-records) ----
const vrec = (o: Partial<VerifyRecord> = {}): VerifyRecord => ({ schema: 1, ts: '2026-10-28T11:00:00.000Z', cmd: 'npm test', argv: ['npm', 'test'], exit: 0, status: 'ok', fingerprint: 'fp1:aa', files: 3, platform: 'linux', node: 'v22.0.0', ...o });
const laterEdit = (ts: string): LedgerRecord => rec({ kind: 'edit', file: 'src/a.ts', ts });
const SAID = /a record shows that a command ran and how it ended, not that it tests the right thing/;

test('a record on the current code state decides over a ledger that says no, and the line names both sources', () => {
  const ledger = fullRunOf([run('npm test'), edit('src/a.ts')], CFG);
  assert.equal(ledger.state, 'no');
  const f = withRecords(ledger, { kind: 'proven', rec: vrec() });
  assert.equal(f.state, 'yes');
  assert.equal(f.by, 'verify record');
  assert.equal(f.record?.kind, 'proven');
  assert.equal(f.ledger?.state, 'no');
  assert.equal(f.edit?.file, 'src/a.ts');
  const line = fullRunLine(f);
  assert.match(line, /^full run: yes — by burhan verify record: npm test passed at 2026-10-28T11:00:00\.000Z on the current code state/);
  assert.match(line, /the ledger: a code edit \(src\/a\.ts at \S+\) came after its last passing full run \(npm test, \S+\)/);
  assert.match(line, SAID);
  assert.doesNotMatch(line, /not seen by the ledger/, 'the record reads the files, so the ledger\'s blind spots are not the answer\'s');
  assert.equal(withRecords(fullRunOf([edit('src/a.ts'), run('npm test')], CFG), { kind: 'proven', rec: vrec() }).ledger?.state, 'yes');
  assert.match(fullRunLine(withRecords(fullRunOf([], CFG), { kind: 'proven', rec: vrec() })), /the ledger: cannot tell — the evidence ledger has no record for this project yet/);
});

test('a failed latest run on the current code state is a no, even when the ledger says yes (the order item finish reads them in)', () => {
  const f = withRecords(fullRunOf([edit('src/a.ts'), run('npm test')], CFG), { kind: 'failed', rec: vrec({ status: 'failed', exit: 1 }) });
  assert.equal(f.state, 'no');
  assert.equal(f.by, 'verify record');
  assert.equal(f.record?.exit, 1);
  assert.equal(f.ledger?.state, 'yes');
  const line = fullRunLine(f);
  assert.match(line, /^full run: no — by burhan verify record: the latest run of npm test on the current code state FAILED \(exit 1\) at 2026-10-28T11:00:00\.000Z; the ledger: npm test passed at /);
  assert.match(line, SAID);
});

test('a record that does not count leaves the ledger deciding and says why it does not count; an item with no record changes nothing', () => {
  const ledger = fullRunOf([edit('src/a.ts'), run('npm test')], CFG);
  const note = ' (the latest burhan verify run, npm test at 2026-10-28T11:00:00.000Z, was on another code state: the code changed since)';
  const f = withRecords(ledger, { kind: 'none', note });
  assert.equal(f.state, 'yes');
  assert.equal(f.by, undefined);
  assert.equal(f.record?.kind, 'none');
  assert.equal(fullRunLine(f), `${fullRunLine(ledger)}; no burhan verify record counts${note}`);
  for (const l of [ledger, fullRunOf([run('npm test'), edit('src/a.ts')], CFG), fullRunOf([edit('src/a.ts')], CFG), fullRunOf([], CFG)]) {
    assert.equal(withRecords(l, { kind: 'none', note: '' }), l, 'no record: the same answer, untouched');
    assert.doesNotMatch(fullRunLine(withRecords(l, { kind: 'none', note: '' })), /burhan verify/);
  }
  assert.match(fullRunLine(withRecords(fullRunOf([], CFG), { kind: 'none', note })), /^full run: cannot tell — .*; no burhan verify record counts/);
});

test('a pass with no code state is stated: it counts only while the ledger shows no code edit after it, and a time that cannot be read is later', () => {
  const stated = { kind: 'stated', rec: vrec({ fingerprint: null }), why: 'not a git checkout' } as const;
  const f = withRecords(fullRunOf([], CFG), stated);
  assert.equal(f.state, 'yes');
  assert.equal(f.by, 'verify record');
  assert.equal(f.record?.kind, 'stated');
  assert.match(fullRunLine(f), /^full run: yes \(stated\) — by burhan verify record: npm test passed at \S+ with no code state \(not a git checkout\), so it cannot be compared with the files now, and the ledger shows no code edit after it \(not seen by the ledger: shell edits \(sed -i, scripts\), edits outside the session, the current turn\); the ledger: cannot tell/);
  assert.equal(withRecords(fullRunOf([laterEdit('2026-10-28T09:00:00Z')], CFG), stated).by, 'verify record', 'an edit before the record');
  for (const ts of ['2026-10-28T12:00:00Z', 'garbage']) {
    const g = withRecords(fullRunOf([laterEdit(ts)], CFG), stated);
    assert.equal(g.by, undefined, ts);
    assert.equal(g.state, 'none', ts);
    assert.match(fullRunLine(g), new RegExp(`; no burhan verify record counts \\(the burhan verify run npm test at \\S+ has no code state and the ledger shows a code edit after it: src/a\\.ts at ${ts}\\)$`), ts);
  }
});

test('the answer as JSON keeps both sources, and the ledger inside it is not nested again', () => {
  const f = withRecords(fullRunOf([run('npm test'), edit('src/a.ts')], CFG), { kind: 'proven', rec: vrec() });
  const j = JSON.parse(JSON.stringify(f)) as FullRun & { ledger: Record<string, unknown> };
  assert.equal(j.state, 'yes');
  assert.equal(j.by, 'verify record');
  assert.equal(j.ledger.state, 'no');
  assert.deepEqual(['by', 'record', 'ledger'].filter((k) => k in j.ledger), []);
});

test('fullRunFor reads the item\'s verify records: a pass on the current code state is yes without any ledger, a change of code takes it back', async () => {
  const dir = await recordProject();
  const before = fullRunFor(dir, process.env, { slug: 'foo' });
  assert.equal(before.state, 'unknown');
  assert.equal(before.by, undefined);
  assert.equal((await verifyRun(dir, 0)).code, 0);
  const yes = fullRunFor(dir, process.env, { slug: 'foo' });
  assert.equal(yes.state, 'yes');
  assert.equal(yes.by, 'verify record');
  assert.match(fullRunLine(yes), /^full run: yes — by burhan verify record: .*process\.exitCode=0 passed at \S+ on the current code state/);
  assert.equal(fullRunFor(dir).by, undefined, 'without a slug only the ledger is read');
  writeFileSync(join(dir, 'a.ts'), 'changed after the run');
  const stale = fullRunFor(dir, process.env, { slug: 'foo' });
  assert.equal(stale.state, 'unknown');
  assert.equal(stale.by, undefined);
  assert.match(fullRunLine(stale), /; no burhan verify record counts \(the latest burhan verify run, .* was on another code state: the code changed since\)$/);
  assert.equal((await verifyRun(dir, 1)).code, 1);
  const failed = fullRunFor(dir, process.env, { slug: 'foo' });
  assert.equal(failed.state, 'no');
  assert.equal(failed.by, 'verify record');
  assert.equal(failed.record?.exit, 1);
});

test('fullRunFor never takes every verify run for a full run: with no usable WF_FULL_TEST_REGEX the answer is cannot tell, and a bad slug or an item with no folder is the ledger alone', async () => {
  const dir = await recordProject('');
  await verifyRun(dir, 0);
  const none = fullRunFor(dir, process.env, { slug: 'foo' });
  assert.equal(none.state, 'unknown');
  assert.equal(none.by, undefined);
  assert.match(none.why ?? '', /WF_FULL_TEST_REGEX/);
  const dir2 = await recordProject();
  writeFileSync(join(dir2, '.gitignore'), '.burhan/x-verify.jsonl\n'); // so that the copy below does not change the code state
  await verifyRun(dir2, 0);
  copyFileSync(join(dir2, '.burhan', 'work', 'foo', 'foo-verify.jsonl'), join(dir2, '.burhan', 'x-verify.jsonl')); // what the slug "../x" would reach
  assert.equal(fullRunFor(dir2, process.env, { slug: 'foo' }).by, 'verify record');
  for (const slug of ['../x', 'ghost', '']) {
    const f = fullRunFor(dir2, process.env, { slug });
    assert.equal(f.by, undefined, JSON.stringify(slug));
    assert.equal(f.state, 'unknown', JSON.stringify(slug));
  }
});
