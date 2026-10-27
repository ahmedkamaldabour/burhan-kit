import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../src/hooks/main.mjs';
import { normalizeClaude } from '../../src/hooks/adapters/claude/normalize.mjs';
import { normalizeCodexEvents } from '../../src/hooks/adapters/codex/normalize.mjs';
import { projectKey } from '../../src/hooks/core/store.mjs';
import { relPath } from '../../src/hooks/core/lib.mjs';
import { shellWrites } from '../../src/hooks/core/shell-writes.mjs';
import { slashes, tmpDir } from '../helpers.js';

// Two sessions on one state file (item multi-session-safety, sub-unit 1): gate I compares the Now list taken just before THIS session's
// own write with the file after it, never the list taken when the session started.
const STATE = '.burhan/local/PROGRESS.md';
const block = (slug: string): string => `### ${slug}\n- **Route:** change / bounded\n`;
const file = (...slugs: string[]): string => `# s\n## Now\n${slugs.map(block).join('')}## Waiting on you\n`;

interface Scene { project: string; store: string; env: NodeJS.ProcessEnv; state: string }
function scene(extra: string[] = []): Scene {
  const project = tmpDir('burhan-multi-project-');
  const store = tmpDir('burhan-multi-store-');
  mkdirSync(join(project, '.burhan/local'), { recursive: true });
  writeFileSync(join(project, '.burhan/workflow.config'), ['WF_DOCS_DIR=AI_SPEC/docs', 'WF_DISCOVERY_DIR=AI_SPEC/discovery', `WF_STATE_FILE=${STATE}`, `WF_EVIDENCE_DIR='${store}'`, ...extra].join('\n') + '\n');
  return { project, store, env: { ...process.env, WF_EVIDENCE_DIR: store }, state: join(project, STATE) };
}
const put = (s: Scene, text: string): void => writeFileSync(s.state, text);
const dirOf = (s: Scene, session: string): string => join(s.store, projectKey(s.project), session);
const call = async (s: Scene, check: string, event: Record<string, unknown>): Promise<string> =>
  (await run(['core', check], JSON.stringify({ project_dir: s.project, session: 'S', ...event }), s.env)).stdout;
const start = (s: Scene): Promise<string> => call(s, 'session-gates', { event: 'session_start' });
const beforeWrite = (s: Scene, path = s.state): Promise<string> => call(s, 'pre-edit-skill', { event: 'pre_edit', file: path, turn: { skills_used: [], assistant_text: '' } });
const turnEnd = (s: Scene, edited: string[]): Promise<string> =>
  call(s, 'turn-audit', { event: 'turn_end', turn: { skills_used: [], assistant_text: 'ok', files_created: [], files_edited: edited, shell_commands: [], steps: [] } });
/** One own write of the state file: the pre-write hook, the write, the turn-end audit. Returns what the audit said. */
async function ownWrite(s: Scene, text: string): Promise<string> { await beforeWrite(s); put(s, text); return turnEnd(s, [s.state]); }
/** Another session that works on `slug`; its ledger files are `ages` seconds old. */
function foreign(s: Scene, session: string, slug: string, ages: number[] = [5]): void {
  const dir = dirOf(s, session);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'item'), `${slug}\n`);
  ages.forEach((age, i) => { const f = join(dir, `ledger-${i}.jsonl`); writeFileSync(f, '{}\n'); const t = Date.now() / 1000 - age; utimesSync(f, t, t); });
}
const removed = (out: string): string => (out.match(/You removed the `[^`]+` block[^.]*\./u) ?? [''])[0];

// ---- AC-01: not blamed for a block another session removed ----
test('AC-01: a block that vanished since this session started, removed by another session → this session\'s own write gets no warning', async () => {
  const s = scene();
  put(s, file('foo', 'gone'));
  await start(s);
  foreign(s, 'F', 'gone');
  put(s, file('foo'));                       // the other session removed it
  const out = await ownWrite(s, file('foo').replace('change / bounded', 'change / patch'));
  assert.equal(removed(out), '', out);
});

// ---- AC-02: blamed for a block this session's own write drops, also when it was added after the start ----
test('AC-02: a block another session added after this one started, dropped by this session\'s own write → warned', async () => {
  const s = scene();
  put(s, file('foo'));
  await start(s);
  put(s, file('foo', 'bar'));                // added later by the other session
  foreign(s, 'F', 'bar');
  const out = await ownWrite(s, file('foo'));
  assert.match(out, /You removed the `bar` block — another session \(active [5-8]s ago\) is working on it\. Put it back\./u);
});

// ---- AC-03: the age is the newest activity ----
test('AC-03: the age comes from the newest ledger file of the other session', async () => {
  const s = scene();
  put(s, file('foo', 'bar'));
  foreign(s, 'F', 'bar', [90000, 80000, 70000, 60000, 50000, 40000, 30000, 20000, 10000, 5]);
  const out = await ownWrite(s, file('foo'));
  assert.match(out, /another session \(active [5-8]s ago\)/u);
});
test('AC-03: a session whose newest ledger file is older than 24 h does not count', async () => {
  const s = scene();
  put(s, file('foo', 'bar'));
  foreign(s, 'F', 'bar', [90000, 100000]);
  assert.equal(removed(await ownWrite(s, file('foo'))), '');
});
test('AC-03: with two sessions on the slug the newer one is named', async () => {
  const s = scene();
  put(s, file('foo', 'bar'));
  foreign(s, 'F1', 'bar', [7200]);
  foreign(s, 'F2', 'bar', [30]);
  assert.match(await ownWrite(s, file('foo')), /another session \(active (29|3[0-9])s ago\)/u);
});

// ---- AC-05, AC-06 ----
test('AC-05: removing this session\'s own block (close-out) is never warned', async () => {
  const s = scene();
  put(s, file('foo', 'bar'));
  foreign(s, 'S', 'bar');                    // this session's own directory: it links bar and its ledger is fresh
  assert.equal(removed(await ownWrite(s, file('foo'))), '');
});
test('AC-06: one session only, a block dropped → no warning', async () => {
  const s = scene();
  put(s, file('foo', 'bar'));
  assert.equal(removed(await ownWrite(s, file('foo'))), '');
});
test('a dropped block that no session owns → no warning', async () => {
  const s = scene();
  put(s, file('foo', 'bar'));
  foreign(s, 'F', 'something-else');
  assert.equal(removed(await ownWrite(s, file('foo'))), '');
});

// ---- the baseline (R1, R2, R3) ----
test('R2: no baseline (no pre-write hook ran) → gate I stays silent, whatever the start list said', async () => {
  const s = scene();
  put(s, file('foo', 'bar'));
  await start(s);
  foreign(s, 'F', 'bar');
  put(s, file('foo'));
  assert.equal(removed(await turnEnd(s, [s.state])), '');
});
test('R3: the first pre-write of a turn is the baseline; a second one in the same turn does not replace it', async () => {
  const s = scene();
  put(s, file('foo', 'bar'));
  foreign(s, 'F', 'bar');
  await beforeWrite(s);
  put(s, file('foo'));                       // first write drops bar
  await beforeWrite(s);                      // second write of the same turn
  put(s, file('foo').replace('change / bounded', 'change / patch'));
  assert.match(await turnEnd(s, [s.state]), /You removed the `bar` block/u);
});
test('the baseline is cleared by the audit: the next turn starts from its own first write', async () => {
  const s = scene();
  put(s, file('foo', 'bar'));
  foreign(s, 'F', 'bar');
  await ownWrite(s, file('foo'));
  assert.equal(existsSync(join(dirOf(s, 'S'), 'now-slugs')), false);
  put(s, file('foo', 'bar'));                // the block is back, then the next turn drops it again
  assert.match(await ownWrite(s, file('foo')), /You removed the `bar` block/u);
});
test('an audit where the state file was not written clears a baseline left by a write that never happened', async () => {
  const s = scene();
  put(s, file('foo', 'bar'));
  foreign(s, 'F', 'bar');
  await beforeWrite(s);
  await turnEnd(s, []);
  put(s, file('foo'));                       // the other session removes it; this session then writes elsewhere in the file
  assert.equal(removed(await ownWrite(s, file('foo').replace('change / bounded', 'change / patch'))), '');
});
const reentrantEnd = (s: Scene): Promise<string> =>
  call(s, 'turn-audit', { event: 'turn_end', reentrant: 'true', turn: { skills_used: [], assistant_text: '', files_created: [], files_edited: [], shell_commands: [], steps: [] } });
test('a reentrant Stop (right after a warning and the "put it back" write) clears the baseline', async () => {
  const s = scene();
  put(s, file('foo', 'bar'));
  foreign(s, 'F', 'bar');
  await beforeWrite(s);                      // the put-back write of the warned turn
  await reentrantEnd(s);
  assert.equal(existsSync(join(dirOf(s, 'S'), 'now-slugs')), false);
  put(s, file('foo'));                       // the other session removes bar meanwhile; this session's next write is elsewhere
  assert.equal(removed(await ownWrite(s, file('foo').replace('change / bounded', 'change / patch'))), '');
});
test('a new prompt clears a baseline left by an interrupted turn (no Stop ran)', async () => {
  const s = scene();
  put(s, file('foo', 'bar'));
  await beforeWrite(s);
  assert.equal(existsSync(join(dirOf(s, 'S'), 'now-slugs')), true);
  await call(s, 'prompt-router', { event: 'prompt', prompt: 'continue' });
  assert.equal(existsSync(join(dirOf(s, 'S'), 'now-slugs')), false);
});
test('SessionStart no longer writes the Now list, and removes a stale one', async () => {
  const s = scene();
  put(s, file('foo', 'bar'));
  await start(s);
  assert.equal(existsSync(join(dirOf(s, 'S'), 'now-slugs')), false);
  await beforeWrite(s);
  assert.equal(existsSync(join(dirOf(s, 'S'), 'now-slugs')), true);
  await start(s);
  assert.equal(existsSync(join(dirOf(s, 'S'), 'now-slugs')), false);
});

// ---- which writes take a baseline ----
test('a write of another file takes no baseline', async () => {
  const s = scene();
  put(s, file('foo'));
  await beforeWrite(s, join(s.project, 'src/app.ts'));
  assert.equal(existsSync(join(dirOf(s, 'S'), 'now-slugs')), false);
});
test('a shell write of the state file takes the baseline', async () => {
  const s = scene();
  put(s, file('foo'));
  await call(s, 'pre-commit-check', { event: 'pre_shell', command: `printf x > ${STATE}` });
  assert.equal(existsSync(join(dirOf(s, 'S'), 'now-slugs')), true);
});
test('a shell command that does not write the state file takes none', async () => {
  const s = scene();
  put(s, file('foo'));
  await call(s, 'pre-commit-check', { event: 'pre_shell', command: `cat ${STATE} > /tmp/copy.md` });
  assert.equal(existsSync(join(dirOf(s, 'S'), 'now-slugs')), false);
});
test('the pre-write step never prints anything in this sub-unit and never blocks', async () => {
  const s = scene();
  put(s, file('foo', 'bar'));
  foreign(s, 'F', 'bar');
  assert.equal(await beforeWrite(s), '');
});

// ---- the adapters hand the state-file write to the core, also with Superpowers off (R5) ----
const claudePre = (s: Scene, tool: string, path: string): Record<string, unknown> | null => {
  const out = normalizeClaude(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { file_path: path }, session_id: 'S', cwd: s.project }), { ...s.env, CLAUDE_PROJECT_DIR: s.project });
  return out === '' ? null : JSON.parse(out) as Record<string, unknown>;
};
test('Claude: a write of the state file with Superpowers off → a pre_edit event with the file', () => {
  const s = scene();
  for (const tool of ['Write', 'Edit', 'MultiEdit']) assert.deepEqual([claudePre(s, tool, s.state)?.event, claudePre(s, tool, s.state)?.file], ['pre_edit', s.state], tool);
});
test('Claude: a write of another file with Superpowers off → no event (unchanged)', () => {
  assert.equal(claudePre(scene(), 'Write', join('/x', 'src/app.ts')), null);
});
test('Claude: with Superpowers on, other files still get their event', () => {
  const s = scene(['WF_SKILLS=superpowers']);
  assert.equal(claudePre(s, 'Write', join(s.project, 'src/app.ts'))?.event, 'pre_edit');
});
const patchOf = (path: string): string => `*** Begin Patch\n*** Update File: ${path}\n@@\n-a\n+b\n*** End Patch`;
const codexPre = (s: Scene, path: string): Record<string, unknown>[] =>
  normalizeCodexEvents(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: patchOf(path) }, session_id: 'S', cwd: s.project }), { ...s.env, CODEX_PROJECT_DIR: s.project, PWD: s.project })
    .map((line) => JSON.parse(line) as Record<string, unknown>);
test('Codex: a patch of the state file with Superpowers off → a pre_edit event for it; another file → none', () => {
  const s = scene();
  const events = codexPre(s, STATE);
  assert.deepEqual(events.map((e) => [e.event, String(e.file).endsWith(STATE)]), [['pre_edit', true]]);
  assert.deepEqual(codexPre(s, 'src/app.ts'), []);
});

// ---- sub-unit 2: a warning before a whole-file write that drops a live session's block (AC-04, R6, R7) ----
const writeOf = (s: Scene, content: string): Promise<string> => call(s, 'pre-edit-skill', { event: 'pre_edit', file: s.state, content, turn: { skills_used: [], assistant_text: '' } });
const shellOf = (s: Scene, command: string): Promise<string> => call(s, 'pre-commit-check', { event: 'pre_shell', command });
const warned = (out: string): string => (out === '' ? '' : (JSON.parse(out) as { message: string }).message);
const DROPS = /⚠ This write drops the `bar` block — another session \(active [5-8]s ago\) is working on it\. Keep it in the new content \(WORKFLOW §5: edit only your own block\)\./u;
const live = (): Scene => { const s = scene(); put(s, file('foo', 'bar')); foreign(s, 'F', 'bar'); return s; };

test('AC-04: a Write whose content drops a live foreign block → one warning naming it and its age', async () => {
  assert.match(warned(await writeOf(live(), file('foo'))), DROPS);
});
test('AC-04: a Write that keeps the block → silent', async () => {
  assert.equal(await writeOf(live(), file('foo', 'bar')), '');
});
test('AC-04: dropping a block whose other session is older than 24 h, or no session owns, or is this session\'s own → silent', async () => {
  const old = scene(); put(old, file('foo', 'bar')); foreign(old, 'F', 'bar', [90000]);
  assert.equal(await writeOf(old, file('foo')), '');
  const none = scene(); put(none, file('foo', 'bar')); foreign(none, 'F', 'other');
  assert.equal(await writeOf(none, file('foo')), '');
  const own = scene(); put(own, file('foo', 'bar')); foreign(own, 'S', 'bar');
  assert.equal(await writeOf(own, file('foo')), '');
});
test('AC-04: content with no "## Now" section drops every live foreign block', async () => {
  const s = scene(); put(s, file('foo', 'bar', 'baz')); foreign(s, 'F1', 'bar'); foreign(s, 'F2', 'baz');
  const m = warned(await writeOf(s, '# s\n## Waiting on you\n'));
  assert.match(m, /drops the `bar` block/u);
  assert.match(m, /drops the `baz` block/u);
});
test('AC-04: an empty Write (the file is emptied) is a drop too', async () => {
  assert.match(warned(await writeOf(live(), '')), DROPS);
});
test('AC-04: a block of another session added after this one started is protected too', async () => {
  const s = scene(); put(s, file('foo')); await start(s);
  put(s, file('foo', 'bar')); foreign(s, 'F', 'bar');
  assert.match(warned(await writeOf(s, file('foo'))), DROPS);
});
test('AC-04: the warning comes with the baseline, and the write is never blocked (a message, no decision)', async () => {
  const s = live();
  const out = await writeOf(s, file('foo'));
  assert.deepEqual(Object.keys(JSON.parse(out) as object), ['message']);
  assert.equal(existsSync(join(dirOf(s, 'S'), 'now-slugs')), true);
});
test('AC-04: an Edit (no whole content) gets the baseline and no warning', async () => {
  assert.equal(await beforeWrite(live()), '');
});

const heredoc = (target: string, body: string, op = '>'): string => `cat ${op} ${target} <<'EOF'\n${body}EOF\n`;
test('AC-04 shell: a heredoc written to the state file with > that drops a live block → warned', async () => {
  const s = live();
  assert.match(warned(await shellOf(s, heredoc(STATE, file('foo')))), DROPS);
  assert.equal(existsSync(join(dirOf(s, 'S'), 'now-slugs')), true);
});
test('AC-04 shell: the absolute path, tee, a quoted path and <<- all count', async () => {
  const variants: ((s: Scene) => string)[] = [
    (s) => heredoc(slashes(s.state), file('foo')),   // the form a bash command has on Windows: `C:\Users\x` written unquoted would lose its backslashes in bash itself
    () => `tee ${STATE} <<EOF\n${file('foo')}EOF\n`,
    () => `cat > "${STATE}" <<"EOF"\n${file('foo')}EOF\n`,
    () => `cat > ${STATE} <<-EOF\n\t${file('foo')}\tEOF\n`,
  ];
  for (const make of variants) { const s = live(); const command = make(s); assert.match(warned(await shellOf(s, command)), DROPS, command); }
});
test('AC-04 shell, Windows form: a drive path with forward slashes resolves to the state file; with backslashes bash drops them', () => {
  const project = 'C:\\Users\\RUNNER~1\\p';
  const slashed = shellWrites([`cat > C:/Users/RUNNER~1/p/${STATE} <<'EOF'\nx\nEOF\n`]);
  assert.deepEqual(slashed.map((target) => relPath(target, project, true)), [STATE]);
  const backslashed = shellWrites([`cat > C:\\Users\\RUNNER~1\\p\\.burhan\\local\\PROGRESS.md <<'EOF'\nx\nEOF\n`]);
  assert.deepEqual(backslashed, ['C:UsersRUNNER~1p.burhanlocalPROGRESS.md']);
});
test('AC-04 shell: a heredoc that keeps the block → silent', async () => {
  assert.equal(await shellOf(live(), heredoc(STATE, file('foo', 'bar'))), '');
});
test('AC-04 shell: an append (>> or tee -a) cannot drop a block → silent', async () => {
  const s = live();
  assert.equal(await shellOf(s, heredoc(STATE, '- a line\n', '>>')), '');
  assert.equal(await shellOf(s, `tee -a ${STATE} <<EOF\n- a line\nEOF\n`), '');
});
test('R6: a state-file write whose content is not in the command (printf, echo, cp, sed -i) → no warning', async () => {
  const s = live();
  for (const cmd of [`printf '%s' x > ${STATE}`, `echo x > ${STATE}`, `cp /tmp/new.md ${STATE}`, `sed -i s/a/b/ ${STATE}`, `cat /tmp/new.md > ${STATE}`]) assert.equal(await shellOf(s, cmd), '', cmd);
});
test('AC-04 shell: another file\'s heredoc, a here-string, an unterminated heredoc → no warning', async () => {
  const s = live();
  assert.equal(await shellOf(s, heredoc('notes.md', file('foo'))), '');
  assert.equal(await shellOf(s, `cat > ${STATE} <<< 'x'`), '');
  assert.equal(await shellOf(s, `cat > ${STATE} <<'EOF'\n${file('foo')}`), '');
});
test('AC-04: a malformed foreign session directory does not hide another live one', async () => {
  const s = live();
  mkdirSync(join(dirOf(s, 'BAD')), { recursive: true });
  writeFileSync(join(dirOf(s, 'BAD'), 'item'), 'bar\n');                       // a link with no ledger
  mkdirSync(join(dirOf(s, 'BAD2'), 'item'), { recursive: true });              // item is a directory
  assert.match(warned(await writeOf(s, file('foo'))), DROPS);
});

test('AC-04 Claude adapter: a Write of the state file carries its content; another file does not; nothing is sent with Superpowers off for other files', () => {
  const s = scene();
  const ev = (path: string): Record<string, unknown> | null => {
    const out = normalizeClaude(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path, content: 'NEW' }, session_id: 'S', cwd: s.project }), { ...s.env, CLAUDE_PROJECT_DIR: s.project });
    return out === '' ? null : JSON.parse(out) as Record<string, unknown>;
  };
  assert.equal(ev(s.state)?.content, 'NEW');
  assert.equal(ev(join(s.project, 'src/app.ts')), null);
  const on = scene(['WF_SKILLS=superpowers']);
  const withSkills = normalizeClaude(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(on.project, 'src/app.ts'), content: 'BIG' }, session_id: 'S', cwd: on.project }), { ...on.env, CLAUDE_PROJECT_DIR: on.project });
  assert.equal((JSON.parse(withSkills) as Record<string, unknown>).content, undefined, 'content is sent for the state file only');
});

test('AC-04 shell: only the tee itself decides "append" (a later grep -a does not), --append is an append, a second heredoc is found', async () => {
  assert.match(warned(await shellOf(live(), `tee ${STATE} <<EOF | grep -a x\n${file('foo')}EOF\n`)), DROPS);
  assert.equal(await shellOf(live(), `tee --append ${STATE} <<EOF\n- x\nEOF\n`), '');
  const two = `cat > notes.md <<'A'\nx\nA\ncat > ${STATE} <<'B'\n${file('foo')}B\n`;
  assert.match(warned(await shellOf(live(), two)), DROPS);
});
test('AC-04 Claude adapter: an Edit of the state file sends no content (only the baseline)', () => {
  const s = scene();
  const out = normalizeClaude(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: s.state, old_string: 'a', new_string: 'b' }, session_id: 'S', cwd: s.project }), { ...s.env, CLAUDE_PROJECT_DIR: s.project });
  assert.equal((JSON.parse(out) as Record<string, unknown>).content, undefined);
});

// ---- sub-unit 4: the list right after this session's last write (QC D1), duplicate headings (D3), slug length (D6) ----
const afterWrite = (s: Scene, path = s.state): Promise<string> => call(s, 'post-edit-reminder', { event: 'post_edit', file: path });
const turnEndWith = (s: Scene, over: Record<string, unknown>): Promise<string> =>
  call(s, 'turn-audit', { event: 'turn_end', turn: { skills_used: [], assistant_text: 'ok', files_created: [], files_edited: [s.state], shell_commands: [], steps: [], ...over } });

test('D1: another session removes its block AFTER this session\'s last edit and before the Stop → no warning', async () => {
  const s = scene();
  put(s, file('foo', 'bar'));
  foreign(s, 'F', 'bar');
  await beforeWrite(s);
  put(s, file('foo', 'bar').replace('bounded', 'patch'));
  await afterWrite(s);
  put(s, file('foo').replace('bounded', 'patch'));               // F closes out `bar` later in the same turn
  assert.equal(removed(await turnEnd(s, [s.state])), '');
});
test('D1: this session\'s own edit drops the live block → still warned at the Stop', async () => {
  const s = scene();
  put(s, file('foo', 'bar'));
  foreign(s, 'F', 'bar');
  await beforeWrite(s);
  put(s, file('foo'));
  await afterWrite(s);
  assert.match(await turnEnd(s, [s.state]), /You removed the `bar` block/u);
});
test('D1: the last own write decides (a later write puts the block back → silent; a later write drops it → warned)', async () => {
  const s = scene();
  put(s, file('foo', 'bar'));
  foreign(s, 'F', 'bar');
  await beforeWrite(s); put(s, file('foo')); await afterWrite(s);
  await beforeWrite(s); put(s, file('foo', 'bar')); await afterWrite(s);
  assert.equal(removed(await turnEnd(s, [s.state])), '');
  const t = scene();
  put(t, file('foo', 'bar')); foreign(t, 'F', 'bar');
  await beforeWrite(t); put(t, file('foo', 'bar')); await afterWrite(t);
  await beforeWrite(t); put(t, file('foo')); await afterWrite(t);
  assert.match(await turnEnd(t, [t.state]), /You removed the `bar` block/u);
});
test('D1: a shell write of the state file in the turn → the file at the Stop is read (there is no post event for a shell)', async () => {
  const s = scene();
  put(s, file('foo', 'bar'));
  foreign(s, 'F', 'bar');
  await beforeWrite(s); await afterWrite(s);                    // an edit that kept bar
  await shellOf(s, `printf x > ${STATE}`);
  put(s, file('foo'));                                          // the shell write dropped it
  assert.match(await turnEndWith(s, { shell_commands: [`printf x > ${STATE}`] }), /You removed the `bar` block/u);
});
test('D1: the list after the write is cleared with the baseline, and a write of another file leaves none', async () => {
  const s = scene();
  put(s, file('foo', 'bar'));
  await afterWrite(s, join(s.project, 'src/app.ts'));
  assert.equal(existsSync(join(dirOf(s, 'S'), 'after-slugs')), false);
  await beforeWrite(s); await afterWrite(s);
  assert.equal(existsSync(join(dirOf(s, 'S'), 'after-slugs')), true);
  await turnEnd(s, [s.state]);
  assert.equal(existsSync(join(dirOf(s, 'S'), 'after-slugs')), false);
  await beforeWrite(s); await afterWrite(s);
  await call(s, 'prompt-router', { event: 'prompt', prompt: 'continue' });
  assert.equal(existsSync(join(dirOf(s, 'S'), 'after-slugs')), false);
});
test('D1: the post step never prints anything', async () => {
  const s = scene(); put(s, file('foo', 'bar')); foreign(s, 'F', 'bar');
  await beforeWrite(s);
  assert.equal(await afterWrite(s), '');
});

test('D3: a duplicate heading in the state file warns once for a dropped live block', async () => {
  const s = scene();
  put(s, file('foo', 'bar', 'bar')); foreign(s, 'F', 'bar');
  const m = warned(await writeOf(s, file('foo')));
  assert.equal((m.match(/drops the `bar` block/gu) ?? []).length, 1, m);
});

const LONG = 'x'.repeat(5000);
test('D6: a very long slug is cut in the pre-write warning and in the turn-end warning', async () => {
  const s = scene();
  put(s, file('foo', LONG)); foreign(s, 'F', LONG);
  const m = warned(await writeOf(s, file('foo')));
  assert.ok(m.length < 400, `pre-write message is ${m.length} characters`);
  assert.match(m, /drops the `x{20,}…` block/u);
  put(s, file('foo', LONG));
  const out = await ownWrite(s, file('foo'));
  assert.ok(out.length < 500, `turn-end output is ${out.length} characters`);
  assert.match(out, /You removed the `x{20,}…` block/u);
});
test('D6: a normal slug is printed whole', async () => {
  assert.match(warned(await writeOf(live(), file('foo'))), /drops the `bar` block/u);
});

test('D1 Codex adapter: an apply_patch of the state file reaches the core as a post_edit event with the file', () => {
  const s = scene();
  const events = normalizeCodexEvents(JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_input: { command: patchOf(STATE) }, session_id: 'S', cwd: s.project }), { ...s.env, CODEX_PROJECT_DIR: s.project, PWD: s.project }).map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(events.map((e) => [e.event, String(e.file).endsWith(STATE)]), [['post_edit', true]]);
});
test('D1: a write that failed or was denied (a baseline, no post event) → the file at the Stop is read, as before', async () => {
  const s = scene();
  put(s, file('foo', 'bar')); foreign(s, 'F', 'bar');
  await beforeWrite(s);
  put(s, file('foo'));                                          // the file changed, no post event came
  assert.match(await turnEnd(s, [s.state]), /You removed the `bar` block/u);
});
