import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectKey, projectRoot } from '../src/lib/evidence.js';
import { cli, project, projectWithItem, STATE } from './item-fixture.js';
import { tmpDir } from './helpers.js';

/** Marks a fixture as an install: the file the commands look for when they walk up. */
const installed = (dir: string): string => { writeFileSync(join(dir, '.burhan', 'WORKFLOW.md'), '# burhan\n'); return dir; };
const sub = (dir: string): string => { const s = join(dir, 'src', 'sub'); mkdirSync(s, { recursive: true }); return s; };

test('item new from a subfolder writes the item and its state block in the project, not in the subfolder, and says which project (AC-02, AC-07)', async () => {
  const dir = installed(project());
  const s = sub(dir);
  const r = await cli(s, ['item', 'new', 'bar', '--type', 'change', '--scope', 'bounded']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.err, `project: ${dir}\n`);
  assert.ok(existsSync(join(dir, '.burhan', 'work', 'bar', 'bar-story.md')));
  assert.match(readFileSync(join(dir, STATE), 'utf8'), /^### bar$/m);
  assert.equal(existsSync(join(s, '.burhan')), false);
});

test('from a subfolder each command gives what it gives from the project folder, plus the project line on stderr (AC-01, AC-03)', async () => {
  const dir = installed(await projectWithItem());
  const s = sub(dir);
  const cmds = [['status'], ['guide', 'foo'], ['item', 'check', 'foo'], ['stats'], ['pr-body', '--item', 'foo'], ['evidence'], ['state', 'compact'], ['memory', 'check'], ['inspect'], ['uninstall'], ['setup', '--agent'], ['use', 'foo']];
  for (const args of cmds) {
    const fromSub = await cli(s, args);
    const fromRoot = await cli(dir, args);
    assert.equal(fromSub.code, fromRoot.code, args.join(' '));
    assert.equal(fromSub.out, fromRoot.out, args.join(' '));
    assert.equal(fromSub.err, `project: ${dir}\n${fromRoot.err}`, args.join(' '));
  }
});

test('a folder argument walks up too; a write command from a subfolder writes into the project (AC-01, AC-03)', async () => {
  const dir = installed(await projectWithItem());
  const s = sub(dir);
  const st = await cli(tmpDir('burhan-elsewhere-'), ['status', s]);
  assert.equal(st.err, `project: ${dir}\n`);
  assert.equal(st.out, (await cli(dir, ['status'])).out);
  const rv = await cli(s, ['review', 'add', 'foo', '--kind', 'review', '--unit', '1', '--by', 'a · m · fresh subagent', '--text', 'ok']);
  assert.equal(rv.code, 0, rv.err);
  assert.ok(existsSync(join(dir, '.burhan', 'work', 'foo', 'reviews', 'foo-review.md')));
  const vf = await cli(s, ['verify', 'foo', '--', process.execPath, '-e', '0']);
  assert.equal(vf.code, 0, vf.err);
  assert.ok(existsSync(join(dir, '.burhan', 'work', 'foo', 'foo-verify.jsonl')));
  assert.equal(existsSync(join(s, '.burhan')), false);
});

test('doctor and upgrade from a subfolder of an installed project check the project (AC-03)', async () => {
  const dir = tmpDir('burhan-doctor-sub-');
  const init = await cli(dir, ['init', dir, '--agents', 'claude', '--apply']);
  assert.equal(init.code, 0, init.err);
  const s = sub(dir);
  const d = await cli(s, ['doctor']);
  assert.doesNotMatch(d.out, /not installed here/);
  assert.equal(d.out, (await cli(dir, ['doctor'])).out);
  assert.equal(d.err.split('\n')[0], `project: ${dir}`);
  const u = await cli(s, ['upgrade']);
  assert.equal(u.out, (await cli(dir, ['upgrade'])).out);
});

const savedState = process.env.XDG_STATE_HOME;
const savedDir = process.env.WF_EVIDENCE_DIR;
afterEach(() => {
  if (savedState === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = savedState;
  if (savedDir === undefined) delete process.env.WF_EVIDENCE_DIR; else process.env.WF_EVIDENCE_DIR = savedDir;
});

test('guide and evidence read the project ledger from a subfolder (AC-04)', async () => {
  const dir = installed(await projectWithItem());
  writeFileSync(join(dir, '.burhan', 'workflow.config'), "WF_CODE_REGEX='[.]ts$'\nWF_FULL_TEST_REGEX='^npm test$'\n");
  const state = tmpDir('burhan-ledger-');
  process.env.XDG_STATE_HOME = state;
  process.env.WF_EVIDENCE_DIR = '';
  const folder = join(state, 'burhan', 'evidence', projectKey(realpathSync(dir)), 'S1');
  mkdirSync(folder, { recursive: true });
  const recs = [{ kind: 'edit', ts: '2026-10-28T10:00:00Z', file: 'src/a.ts' }, { kind: 'cmd', ts: '2026-10-28T10:05:00Z', cmd: 'npm test', exit: 0, status: 'ok' }];
  writeFileSync(join(folder, 'T1.jsonl'), recs.map((r, i) => JSON.stringify({ agent: 'claude', session: 'S1', turn: 'T1', seq: i + 1, item: 'foo', project: dir, ...r })).join('\n') + '\n');
  const s = sub(dir);
  for (const args of [['guide', 'foo'], ['evidence', '--item', 'foo']]) {
    const fromSub = await cli(s, args);
    assert.match(fromSub.out, /^full run: yes — npm test passed/m, args.join(' '));
    assert.equal(fromSub.out, (await cli(dir, args)).out, args.join(' '));
  }
});

test('a stray .burhan/ in a subfolder is not a project, for the commands and for projectRoot (AC-05)', async () => {
  const dir = installed(project());
  const s = sub(dir);
  mkdirSync(join(s, '.burhan', 'work'), { recursive: true });
  const r = await cli(s, ['item', 'new', 'baz', '--type', 'change', '--scope', 'bounded']);
  assert.equal(r.code, 0, r.err);
  assert.ok(existsSync(join(dir, '.burhan', 'work', 'baz')));
  assert.equal(existsSync(join(s, '.burhan', 'work', 'baz')), false);
  assert.equal(projectRoot(s), realpathSync(dir));
});

test('with no install at or above the folder, the command uses the folder as given and prints no project line (AC-06)', async () => {
  const dir = project(); // .burhan/ but no WORKFLOW.md: not an install
  const s = sub(dir);
  const r = await cli(s, ['item', 'new', 'qux', '--type', 'change', '--scope', 'bounded']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.err, '');
  assert.ok(existsSync(join(s, '.burhan', 'work', 'qux')));
});

test('init never walks up: it installs in the folder given (AC-08)', async () => {
  const dir = tmpDir('burhan-init-sub-');
  assert.equal((await cli(dir, ['init', dir, '--agents', 'claude', '--apply'])).code, 0);
  const s = sub(dir);
  const r = await cli(s, ['init', '--agents', 'claude', '--apply']);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.err, /^project: /m);
  assert.ok(existsSync(join(s, '.burhan', 'WORKFLOW.md')));
});

test('a folder argument that does not exist, or a file, is not walked up from: the command refuses it as before, with no project line (review F1, Deviation 1)', async () => {
  const dir = tmpDir('burhan-bad-arg-');
  assert.equal((await cli(dir, ['init', dir, '--agents', 'claude', '--apply'])).code, 0);
  writeFileSync(join(dir, 'afile'), 'x');
  for (const bad of [join(dir, 'typo'), join(dir, 'afile')]) {
    for (const args of [['uninstall', bad], ['doctor', bad], ['inspect', bad], ['status', bad]]) assert.doesNotMatch((await cli(dir, args)).err, /^project: /m, args.join(' '));
    const u = await cli(dir, ['uninstall', bad]);
    assert.equal(u.code, 2); assert.match(u.err, /target is not a directory/);
    const d = await cli(dir, ['doctor', bad]);
    assert.equal(d.code, 1); assert.match(d.out, /not a directory/);
    assert.equal((await cli(dir, ['inspect', bad])).code, 2);
  }
});
