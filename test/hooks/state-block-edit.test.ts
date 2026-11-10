import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../src/hooks/main.mjs';
import { projectKey } from '../../src/hooks/core/store.mjs';
import { tmpDir } from '../helpers.js';

// A block of another live session changed by this session: a hand edit (hash of the block before this session's first write and after its last) or a `burhan state set|close` run.
const STATE = '.burhan/local/PROGRESS.md';
const two = (bar: string, foo = 'one'): string => `# s\n## Now\n### foo\n- **Next action:** ${foo}\n### bar\n- **Next action:** ${bar}\n## Waiting on you\n`;

interface Scene { project: string; store: string; env: NodeJS.ProcessEnv; state: string }
function scene(): Scene {
  const project = tmpDir('burhan-blockedit-project-');
  const store = tmpDir('burhan-blockedit-store-');
  mkdirSync(join(project, '.burhan/local'), { recursive: true });
  writeFileSync(join(project, '.burhan/workflow.config'), ['WF_DOCS_DIR=AI_SPEC/docs', 'WF_DISCOVERY_DIR=AI_SPEC/discovery', `WF_STATE_FILE=${STATE}`, `WF_EVIDENCE_DIR='${store}'`].join('\n') + '\n');
  return { project, store, env: { ...process.env, WF_EVIDENCE_DIR: store }, state: join(project, STATE) };
}
const put = (s: Scene, text: string): void => writeFileSync(s.state, text);
const dirOf = (s: Scene, session: string): string => join(s.store, projectKey(s.project), session);
const call = async (s: Scene, check: string, event: Record<string, unknown>): Promise<string> =>
  (await run(['core', check], JSON.stringify({ project_dir: s.project, session: 'S', ...event }), s.env)).stdout;
const beforeWrite = (s: Scene): Promise<string> => call(s, 'pre-edit-skill', { event: 'pre_edit', file: s.state, turn: { skills_used: [], assistant_text: '' } });
const afterWrite = (s: Scene): Promise<string> => call(s, 'post-edit-reminder', { event: 'post_edit', file: s.state });
const turnEnd = (s: Scene, edited: string[], cmds: string[] = []): Promise<string> =>
  call(s, 'turn-audit', { event: 'turn_end', turn: { skills_used: [], assistant_text: 'ok', files_created: [], files_edited: edited, shell_commands: cmds, steps: [] } });
function foreign(s: Scene, session: string, slug: string, age = 5): void {
  const dir = dirOf(s, session);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'item'), `${slug}\n`);
  const f = join(dir, 'ledger-0.jsonl'); writeFileSync(f, '{}\n'); const t = Date.now() / 1000 - age; utimesSync(f, t, t);
}
const CHANGED = /You changed the `bar` block — another session \(active [5-9]s ago\) is working on it\. Change only your own block, with `burhan state` \(WORKFLOW §5\)\./u;

test('a hand edit of another live session\'s block is reported, and the own block is not', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  await beforeWrite(s);
  put(s, two('hand edited', 'mine'));
  await afterWrite(s); // the edit tool's own post-edit hook judges this one write (owner option A, 2026-11-10)
  const out = await turnEnd(s, [s.state]);
  assert.match(out, CHANGED);
  assert.doesNotMatch(out, /You changed the `foo` block/u);
});

test('own block edited, nobody else on the other one: no report', async () => {
  const s = scene();
  put(s, two('old'));
  await beforeWrite(s);
  put(s, two('old', 'mine'));
  assert.doesNotMatch(await turnEnd(s, [s.state]), /You changed the/u);
});

test('a block another session changed before this session\'s first write is not blamed on it', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  put(s, two('changed by the other session'));
  await beforeWrite(s);
  put(s, two('changed by the other session', 'mine'));
  assert.doesNotMatch(await turnEnd(s, [s.state]), /You changed the/u);
});

test('a block another session changed after this session\'s last edit-tool write is not blamed on it', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  await beforeWrite(s);
  put(s, two('old', 'mine'));
  await afterWrite(s);
  put(s, two('changed later by the other session', 'mine'));
  assert.doesNotMatch(await turnEnd(s, [s.state]), /You changed the/u);
});

test('a burhan state run on another live session\'s block is reported, and never blocks', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  for (const cmd of ['node dist/cli.js state set bar "Next action" x', 'burhan state close bar --outcome Paused --commit uncommitted --folder f', 'cd /tmp && burhan state set bar Branch main']) {
    const out = await turnEnd(s, [], [cmd]);
    assert.match(out, CHANGED, cmd);
    assert.doesNotMatch(out, /"decision"\s*:\s*"block"/u, cmd);
  }
});

test('text that only mentions the command, and a read, are not reported', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  for (const cmd of ['echo "burhan state set bar x y"', 'burhan state show bar', 'grep -n "state set bar" notes.md']) assert.doesNotMatch(await turnEnd(s, [], [cmd]), /You changed the/u, cmd);
});

test('no other live session on the block: a state run is not reported', async () => {
  const s = scene();
  put(s, two('old'));
  assert.doesNotMatch(await turnEnd(s, [], ['burhan state set bar "Next action" x']), /You changed the/u);
});

test('the block hashes are cleared by the audit', async () => {
  const s = scene();
  put(s, two('old'));
  await beforeWrite(s);
  assert.equal(existsSync(join(dirOf(s, 'S'), 'now-blocks')), true);
  await turnEnd(s, [s.state]); // a write whose post hook never ran: the audit forgets its baseline
  assert.equal(existsSync(join(dirOf(s, 'S'), 'now-blocks')), false);
});

test('a burhan state run that failed or never ran is not reported; a successful one and a run with no known status still are', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  const cmd = 'burhan state set bar "Next action" x';
  const end = (steps: Record<string, unknown>[]): Promise<string> => call(s, 'turn-audit', { event: 'turn_end', turn: { skills_used: [], assistant_text: 'ok', files_created: [], files_edited: [], shell_commands: [cmd], steps } });
  assert.doesNotMatch(await end([{ seq: 1, kind: 'cmd', cmd, status: 'failed', exit: 2 }]), /You changed the/u, 'exit 2');
  assert.doesNotMatch(await end([{ seq: 1, kind: 'cmd', cmd, status: 'blocked', exit: null }]), /You changed the/u, 'blocked');
  assert.match(await end([{ seq: 1, kind: 'cmd', cmd, status: 'ok', exit: 0 }]), CHANGED, 'ok');
  assert.match(await end([{ seq: 1, kind: 'cmd', cmd, status: 'unknown', exit: null }]), CHANGED, 'unknown');
  assert.match(await end([]), CHANGED, 'no step');
});

test('a block another live session changed between two writes of this session is not blamed on this session', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  await beforeWrite(s);
  put(s, two('old', 'mine'));
  await afterWrite(s);
  put(s, two('changed by the other session', 'mine')); // the other session's own write, between the two writes of this one
  await beforeWrite(s);
  put(s, two('changed by the other session', 'mine again'));
  await afterWrite(s);
  assert.doesNotMatch(await turnEnd(s, [s.state]), /You changed the/u);
});

test('a second write of this session that really changes another live session\'s block is still reported', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  await beforeWrite(s);
  put(s, two('old', 'mine'));
  await afterWrite(s);
  put(s, two('changed by the other session', 'mine')); // the other session's own write, between the two writes of this one
  await beforeWrite(s);
  put(s, two('hand edited by me', 'mine'));
  await afterWrite(s);
  assert.match(await turnEnd(s, [s.state]), CHANGED);
});

test('a pre-write with no post hook before it does not make another session\'s change of a block look like this session\'s (QC round 2 #7)', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  await beforeWrite(s); // a write whose post hook never ran (a failed edit)
  put(s, two('changed by the other session'));
  await beforeWrite(s);
  put(s, two('changed by the other session', 'mine'));
  await afterWrite(s);
  assert.doesNotMatch(await turnEnd(s, [s.state]), /You changed the `bar` block/u);
});

test('a pre-write with no post hook before it does not hide this session\'s real change of another live session\'s block (QC round 2 #7)', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  await beforeWrite(s); // a write whose post hook never ran (a failed edit)
  await beforeWrite(s);
  put(s, two('hand edited by me', 'mine'));
  await afterWrite(s);
  assert.match(await turnEnd(s, [s.state]), CHANGED);
});

// Owner decision 2026-11-10 (option A): gate J reports only when sure, i.e. one edit-tool write's own before and after show the change, or a successful `burhan state` run names the block.

test('a shell write of the state file is not judged: a block it changed is not reported, even when another session changes it before the turn end', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  const cmd = `cat > ${STATE} <<'EOF'\n${two('changed by the shell', 'mine')}EOF`;
  await call(s, 'pre-commit-check', { event: 'pre_shell', command: cmd, turn: { skills_used: [], assistant_text: '' } });
  put(s, two('changed by the shell', 'mine'));
  put(s, two('changed again by the other session', 'mine'));
  assert.doesNotMatch(await turnEnd(s, [], [cmd]), /You changed the/u);
});

test('a post-edit hook with no matching pre-write reports nothing', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  await beforeWrite(s);
  put(s, two('old', 'mine'));
  await afterWrite(s); // a matched pair that changed nothing
  put(s, two('changed by an edit whose pre-write hook did not run', 'mine'));
  await afterWrite(s);
  assert.doesNotMatch(await turnEnd(s, [s.state]), /You changed the/u);
});

test('one Edit of this session that really changes another live session\'s block, judged by its own pre-write and post-edit hooks, is reported', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  await beforeWrite(s);
  put(s, two('changed by this one edit', 'mine'));
  await afterWrite(s);
  assert.match(await turnEnd(s, [s.state]), CHANGED);
});

test('a successful burhan state set on another live session\'s block is reported', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  const cmd = 'burhan state set bar "Next action" x';
  const out = await call(s, 'turn-audit', { event: 'turn_end', turn: { skills_used: [], assistant_text: 'ok', files_created: [], files_edited: [], shell_commands: [cmd], steps: [{ seq: 1, kind: 'cmd', cmd, status: 'ok', exit: 0 }] } });
  assert.match(out, CHANGED);
});

test('a failed burhan state set on another live session\'s block is not reported', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  const cmd = 'burhan state set bar "Next action" x';
  const out = await call(s, 'turn-audit', { event: 'turn_end', turn: { skills_used: [], assistant_text: 'ok', files_created: [], files_edited: [], shell_commands: [cmd], steps: [{ seq: 1, kind: 'cmd', cmd, status: 'failed', exit: 2 }] } });
  assert.doesNotMatch(out, /You changed the/u);
});

// Fix (state-file-safe-write, unit 3): with `||` in the command, a state run after the `||` (or after an `&&`) is not certain to have run.
test('a burhan state run after a || in a command that exits 0 is not reported (the run never ran)', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  const cmd = 'ok || burhan state set bar x';
  const out = await call(s, 'turn-audit', { event: 'turn_end', turn: { skills_used: [], assistant_text: 'ok', files_created: [], files_edited: [], shell_commands: [cmd], steps: [{ seq: 1, kind: 'cmd', cmd, status: 'ok', exit: 0 }] } });
  assert.doesNotMatch(out, /You changed the/u);
});

test('a burhan state run followed by && echo on a command that exits 0 is still reported', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  const cmd = 'burhan state set bar x && echo done';
  const out = await call(s, 'turn-audit', { event: 'turn_end', turn: { skills_used: [], assistant_text: 'ok', files_created: [], files_edited: [], shell_commands: [cmd], steps: [{ seq: 1, kind: 'cmd', cmd, status: 'ok', exit: 0 }] } });
  assert.match(out, CHANGED);
});

test('a plain burhan state set run on a command that exits 0 is still reported', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  const cmd = 'burhan state set bar x';
  const out = await call(s, 'turn-audit', { event: 'turn_end', turn: { skills_used: [], assistant_text: 'ok', files_created: [], files_edited: [], shell_commands: [cmd], steps: [{ seq: 1, kind: 'cmd', cmd, status: 'ok', exit: 0 }] } });
  assert.match(out, CHANGED);
});

// Fix (state-file-safe-write, QC r3 finding 8): a state run is judged only when every part of the command is certain to have run (parts joined by && only).
const endRun = (s: Scene, cmd: string, status: string, exit: number | null): Promise<string> =>
  call(s, 'turn-audit', { event: 'turn_end', turn: { skills_used: [], assistant_text: 'ok', files_created: [], files_edited: [], shell_commands: [cmd], steps: [{ seq: 1, kind: 'cmd', cmd, status, exit }] } });

test('QC r3 #8: a failed state set followed by ; echo that exits 0 is not reported', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  assert.doesNotMatch(await endRun(s, 'burhan state set bar x; echo done', 'ok', 0), /You changed the/u);
});

test('QC r3 #8: a state set piped to tee that exits 0 is not reported', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  assert.doesNotMatch(await endRun(s, 'burhan state set bar x | tee log', 'ok', 0), /You changed the/u);
});

test('QC r3 #8: a state set followed by || echo that exits 0 is not reported', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  assert.doesNotMatch(await endRun(s, 'burhan state set bar x || echo', 'ok', 0), /You changed the/u);
});

test('QC r3 #8: cd x && burhan state set bar x that exits 0 is reported (the whole && chain succeeded)', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  assert.match(await endRun(s, 'cd x && burhan state set bar x', 'ok', 0), CHANGED);
});

test('QC r3 #8: a single burhan state set that exits 0 is still reported', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  assert.match(await endRun(s, 'burhan state set bar x', 'ok', 0), CHANGED);
});

test('QC r3 #8: a failed single burhan state set is not reported', async () => {
  const s = scene();
  put(s, two('old'));
  foreign(s, 'F', 'bar');
  assert.doesNotMatch(await endRun(s, 'burhan state set bar x', 'failed', 2), /You changed the/u);
});
