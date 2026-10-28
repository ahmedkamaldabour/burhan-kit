import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evidenceMatches } from '../src/hooks/core/evidence-cmd.mjs';
import { ereToJs, projectKey, type LedgerRecord } from '../src/lib/evidence.js';
import { fullRunLine, fullRunOf } from '../src/lib/full-run.js';
import { cli, projectWithItem } from './item-fixture.js';
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
  assert.match(readFileSync(join(ROOT, '.burhan/workflow.config'), 'utf8'), /^WF_FULL_TEST_REGEX='\^npm test\( \[0-9\]\*>\.\*\)\?\$'$/m);
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
