import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers.js';
import { projectKey } from '../../src/lib/evidence.js';
import { run } from '../../src/hooks/main.mjs';
import { turnFromRecords } from '../../src/hooks/adapters/claude/transcript.mjs';

// The review SKILL GATE counts a review file the main agent creates or adds a `**Performed by:**` line to — not a fix
// note added to a review the reviewer wrote (reaudit-and-symlink-guard SU3, AC-10).
const GATE = /SKILL GATE: a review file was written/u;
const REVIEW = '.burhan/work/alpha/reviews/alpha-review.md';
const OTHER = '.burhan/work/alpha/reviews/beta-review.md';

function setup(): { project: string; env: NodeJS.ProcessEnv } {
  const project = tmpDir('burhan-review-note-project-');
  mkdirSync(join(project, '.burhan/local'), { recursive: true });
  writeFileSync(join(project, '.burhan/local/PROGRESS.md'), '## Now\n### alpha\n- **Route:** change / bounded\n');
  return { project, env: { ...process.env, WF_EVIDENCE_DIR: tmpDir('burhan-review-note-evidence-'), WF_SKILLS: 'superpowers', WF_DOCS_DIR: '.burhan/work', WF_STATE_FILE: '.burhan/local/PROGRESS.md' } };
}
interface T { agent?: string; created?: string[]; edited?: string[]; cmds?: string[]; steps?: Record<string, unknown>[]; skills?: string[] }
let n = 0;
async function audit(t: T): Promise<string> {
  const s = setup();
  const abs = (f: string): string => join(s.project, f);
  const turn = { files_created: (t.created ?? []).map(abs), files_edited: (t.edited ?? []).map(abs), shell_commands: t.cmds ?? [], skills_used: t.skills ?? [], assistant_text: '',
    steps: (t.steps ?? []).map((st, i) => ({ seq: i + 1, ...st, ...(typeof st.file === 'string' ? { file: abs(st.file) } : {}) })) };
  const event = { event: 'turn_end', agent: t.agent ?? 'claude', project_dir: s.project, session: 'S1', turn_id: `synthetic-${++n}`, turn_scope: 'whole', turn, reentrant: false };
  const r = await run(['core', 'turn-audit'], JSON.stringify(event), s.env);
  assert.equal(r.debug, '');
  return r.stdout;
}
const edit = (file: string, performedBy = false): Record<string, unknown> => ({ kind: 'edit', file, ...(performedBy ? { performed_by: true } : {}) });

test('a fix note added with Edit to a review file does not fire', async () => {
  assert.doesNotMatch(await audit({ edited: [REVIEW], steps: [edit(REVIEW)] }), GATE);
  assert.doesNotMatch(await audit({ edited: [REVIEW], steps: [edit(REVIEW)] }), GATE, 'no text at all');
});

test('a fix note appended by a shell command does not fire; one that adds a Performed by line does', async () => {
  const note = `cat >> ${REVIEW} <<'EOF'\n### Fix\nresolved\nEOF`;
  assert.doesNotMatch(await audit({ cmds: [note] }), GATE);
  const review = `cat >> ${REVIEW} <<'EOF'\n## SU1\n- **Performed by:** me · model · same session\nEOF`;
  assert.match(await audit({ cmds: [review] }), GATE);
});

test('a review file the main agent creates fires; so does an Edit that adds the Performed by line', async () => {
  assert.match(await audit({ created: [REVIEW], steps: [edit(REVIEW)] }), GATE);
  assert.match(await audit({ edited: [REVIEW], steps: [edit(REVIEW, true)] }), GATE);
});

test('two review files, one a fix note and one created: fires once', async () => {
  const out = await audit({ created: [OTHER], edited: [REVIEW], steps: [edit(REVIEW), edit(OTHER)] });
  assert.equal(out.match(/SKILL GATE: a review file/gu)?.length, 1);
});

test('the skill, when used, silences it as before', async () => {
  assert.doesNotMatch(await audit({ created: [REVIEW], skills: ['superpowers:requesting-code-review'], steps: [edit(REVIEW)] }), GATE);
});

test('Codex steps carry no text: an edit of a review file keeps today\'s rule (R-4)', async () => {
  assert.match(await audit({ agent: 'codex', edited: [REVIEW], steps: [edit(REVIEW)] }), GATE);
});

test('a subagent\'s write to a review file is not the main agent writing one (as before)', async () => {
  assert.doesNotMatch(await audit({ steps: [{ kind: 'edit', file: REVIEW, by: 'burhan-reviewer', performed_by: true }] }), GATE);
});

// ---- the adapter: what an edit step carries
const rec = (name: string, input: Record<string, unknown>, tool: Record<string, unknown> = { type: 'update' }): Record<string, unknown>[] => {
  const id = `t${++n}`;
  return [{ type: 'assistant', uuid: `a${n}`, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } },
    { type: 'user', uuid: `r${n}`, toolUseResult: tool, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } }];
};
const turnOf = (...calls: Record<string, unknown>[][]) => turnFromRecords([{ type: 'user', uuid: 'p', message: { role: 'user', content: 'go' } }, ...calls.flat()]);

test('an edit step says when the text it wrote has a Performed by line (Write content, Edit new_string, MultiEdit, NotebookEdit)', () => {
  const line = '- **Performed by:** burhan-reviewer · model · fresh subagent';
  const t = turnOf(
    rec('Write', { file_path: '/p/a', content: `# r\n${line}` }, { type: 'create' }),
    rec('Edit', { file_path: '/p/b', old_string: 'x', new_string: line }),
    rec('MultiEdit', { file_path: '/p/c', edits: [{ old_string: 'x', new_string: 'one' }, { old_string: 'y', new_string: line }] }),
    rec('NotebookEdit', { notebook_path: '/p/d.ipynb', new_source: line }),
    rec('Edit', { file_path: '/p/e', old_string: 'x', new_string: 'a fix note' }),
    rec('Edit', { file_path: '/p/f', old_string: 'Performed by: x', new_string: '' }),
    rec('Write', { file_path: '/p/g', content: 'performed by: someone' }, { type: 'create' }));
  assert.deepEqual(t.steps.map((s) => (s as unknown as { performed_by?: boolean }).performed_by), [true, true, true, true, undefined, undefined, true], 'case-insensitive; only the text written counts, not the text replaced');
});

test('a step without such a line has no extra key, and no written text is ever carried', () => {
  const t = turnOf(rec('Write', { file_path: '/p/a', content: 'x'.repeat(40_000) }, { type: 'create' }), rec('Edit', { file_path: '/p/b', old_string: 'a', new_string: '' }));
  assert.deepEqual(t.steps.map((s) => Object.keys(s).filter((k) => k !== '_ts').sort()), [['file', 'kind', 'seq'], ['file', 'kind', 'seq']]);
});

test('the ledger never stores the text written', async () => {
  const s = setup();
  const dir = tmpDir('burhan-review-note-transcripts-');
  const path = join(dir, 'S9.jsonl');
  const prompt = { type: 'user', uuid: 'p', message: { role: 'user', content: 'go' } };
  writeFileSync(path, [prompt, ...rec('Edit', { file_path: join(s.project, REVIEW), old_string: 'a', new_string: 'SECRET-TEXT' })].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const payload = { hook_event_name: 'Stop', session_id: 'S9', transcript_path: path, cwd: s.project, stop_hook_active: false };
  const r = await run(['claude', 'hook', 'turn-audit'], JSON.stringify(payload), { ...s.env, CLAUDE_PROJECT_DIR: s.project });
  assert.equal(r.debug, '');
  const d = join(s.env.WF_EVIDENCE_DIR!, projectKey(s.project), 'S9');
  const all = readdirSync(d).filter((f) => f.endsWith('.jsonl')).map((f) => readFileSync(join(d, f), 'utf8')).join('');
  assert.match(all, /alpha-review\.md/u);
  assert.doesNotMatch(all, /SECRET-TEXT/u);
});
