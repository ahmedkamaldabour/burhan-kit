import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join, resolve } from 'node:path';
import { normalizeCodexEvents } from '../../src/hooks/adapters/codex/normalize.mjs';
import { recordCall } from '../../src/hooks/adapters/codex/ledger.mjs';
import { tmpDir } from '../helpers.js';

// A Codex patch names files relative to the folder the session runs in (item evidence-honesty, AC-06). When that folder is a
// subfolder of the project, the path is resolved against it, so the hooks judge the real file.
// Paths are built with node:path so the same tests hold on Windows (drive letter, backslashes).
const ROOT = resolve('/proj');
const SUB = join(ROOT, 'sub');
const OUTSIDE = resolve('/elsewhere');
const EXPECTED = join(SUB, 'src', 'a.ts');
const PATCH = '*** Begin Patch\n*** Add File: src/a.ts\n+x\n*** End Patch\n';
const env = (): NodeJS.ProcessEnv => ({ ...process.env, WF_PROJECT_ROOT: ROOT, WF_CODEX_LEDGER_DIR: tmpDir('burhan-codex-cwd-') });
const post = (cwd: string, patch = PATCH): Record<string, unknown> => ({ session_id: 'S', turn_id: 'T', transcript_path: '', cwd, hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_input: { command: patch }, tool_response: 'Exit code: 0', tool_use_id: 'p1' });
const files = (payload: Record<string, unknown>, e: NodeJS.ProcessEnv): string[] => normalizeCodexEvents(JSON.stringify(payload), e).map((line) => (JSON.parse(line) as { file: string }).file);

test('a patch path is resolved against a session folder that is a subfolder of the project', () => {
  assert.deepEqual(files(post(SUB), env()), [EXPECTED]);
});
test('unchanged: session folder is the project root, a path already absolute, a folder outside the project, an empty folder', () => {
  assert.deepEqual(files(post(ROOT), env()), ['src/a.ts']);
  assert.deepEqual(files(post(SUB, PATCH.replace('src/a.ts', join(ROOT, 'src', 'a.ts'))), env()), [join(ROOT, 'src', 'a.ts')]);
  assert.deepEqual(files(post(OUTSIDE), env()), ['src/a.ts']);
  assert.deepEqual(files(post(''), env()), ['src/a.ts']);
});
test('the pre-edit event rebases too (skills on, so the patch is passed on)', () => {
  const pre = { ...post(SUB), hook_event_name: 'PreToolUse' };
  delete (pre as Record<string, unknown>).tool_response;
  assert.deepEqual(files(pre, { ...env(), WF_SKILLS: 'superpowers' }), [EXPECTED]);
});
test('the turn end sees the rebased file in files_created and in its edit steps, using the folder the patch ran in', () => {
  const e = env();
  recordCall(e, 'S', 'T', post(SUB));                       // the patch ran in /proj/sub
  const stop = { session_id: 'S', turn_id: 'T', transcript_path: '', cwd: ROOT, hook_event_name: 'Stop', last_assistant_message: 'done' };   // the turn ends at the root
  const event = JSON.parse(normalizeCodexEvents(JSON.stringify(stop), e)[0]!) as { turn: { files_created: string[]; steps: { kind: string; file: string }[] } };
  assert.deepEqual(event.turn.files_created, [EXPECTED]);
  assert.deepEqual(event.turn.steps.filter((step) => step.kind === 'edit').map((step) => step.file), [EXPECTED]);
});
test('a patch that ran at the project root stays unchanged when the turn ends in a subfolder (the record has no folder: it means the root)', () => {
  const e = env();
  recordCall(e, 'S', 'T', post(ROOT));
  const stop = { session_id: 'S', turn_id: 'T', transcript_path: '', cwd: SUB, hook_event_name: 'Stop', last_assistant_message: 'done' };
  const event = JSON.parse(normalizeCodexEvents(JSON.stringify(stop), e)[0]!) as { turn: { files_created: string[]; steps: { kind: string; file: string }[] } };
  assert.deepEqual(event.turn.files_created, ['src/a.ts']);
  assert.deepEqual(event.turn.steps.filter((step) => step.kind === 'edit').map((step) => step.file), ['src/a.ts']);
});
