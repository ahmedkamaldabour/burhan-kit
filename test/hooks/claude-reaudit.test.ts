import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers.js';
import { projectKey } from '../../src/lib/evidence.js';
import { run } from '../../src/hooks/main.mjs';

// A Claude Stop after a background-agent wake-up audits only work that no earlier Stop of the same prompt audited
// (reaudit-and-symlink-guard SU2, AC-05 – AC-09). Synthetic transcripts; nothing is mocked below the hook entry.
const REVIEW_GATE = /SKILL GATE: a review file was written/u;
const STATE_GATE = /STATE-TRANSITION GATE/u;
const REVIEW = '.burhan/work/alpha/reviews/alpha-review.md';
const NOTE = '.burhan/work/alpha/alpha-notes.md';

let n = 0;
const uid = (): string => `synthetic-${++n}`;
const ts = (): string => new Date(Date.UTC(2026, 9, 20, 0, 0, n)).toISOString();
type Rec = Record<string, unknown>;
const prompt = (text: string): Rec => ({ type: 'user', uuid: uid(), timestamp: ts(), message: { role: 'user', content: text } });
const wake = (id: string): Rec => prompt(`<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n</task-notification>`);
const toolUse = (name: string, input: Rec): [string, Rec] => { const id = uid(); return [id, { type: 'assistant', uuid: uid(), timestamp: ts(), message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } }]; };
const result = (id: string, toolUseResult: Rec = {}): Rec => ({ type: 'user', uuid: uid(), timestamp: ts(), toolUseResult, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
const say = (text: string): Rec => ({ type: 'assistant', uuid: uid(), timestamp: ts(), message: { role: 'assistant', content: [{ type: 'text', text }] } });
const call = (name: string, input: Rec, toolUseResult: Rec = { type: 'update' }): Rec[] => { const [id, rec] = toolUse(name, input); return [rec, result(id, toolUseResult)]; };

interface World { project: string; root: string; env: NodeJS.ProcessEnv; dir: string }
function world(): World {
  const project = tmpDir('burhan-reaudit-project-');
  const root = tmpDir('burhan-reaudit-evidence-');
  const dir = tmpDir('burhan-reaudit-transcripts-');
  mkdirSync(join(project, '.burhan/local'), { recursive: true });
  writeFileSync(join(project, '.burhan/local/PROGRESS.md'), '## Now\n### alpha\n- **Route:** change / bounded\n');
  const env = { ...process.env, CLAUDE_PROJECT_DIR: project, WF_EVIDENCE_DIR: root, WF_SKILLS: 'superpowers', WF_DOCS_DIR: '.burhan/work', WF_STATE_FILE: '.burhan/local/PROGRESS.md', WF_CODE_REGEX: '\\.src$', WF_EVIDENCE_LEDGER: 'on' };
  return { project, root, env, dir };
}
function session(w: World, id: string): { id: string; path: string; add: (...recs: (Rec | Rec[])[]) => void } {
  const path = join(w.dir, `${id}.jsonl`);
  writeFileSync(path, '');
  return { id, path, add: (...recs) => { for (const r of recs.flat()) appendFileSync(path, JSON.stringify(r) + '\n'); } };
}
async function stop(w: World, s: { id: string; path: string }, active = false): Promise<string> {
  const payload = { hook_event_name: 'Stop', session_id: s.id, transcript_path: s.path, cwd: w.project, stop_hook_active: active };
  const r = await run(['claude', 'hook', 'turn-audit'], JSON.stringify(payload), w.env);
  assert.equal(r.debug, '');
  return r.stdout;
}
const P = (w: World, rel: string): string => join(w.project, rel);
// A review the main agent creates counts for the review gate (a fix note added to an existing one does not — SU3).
const editReview = (w: World): Rec[] => call('Write', { file_path: P(w, REVIEW), content: '# review' }, { type: 'create' });
const count = (text: string, re: RegExp): number => text.match(new RegExp(re, 'gu'))?.length ?? 0;
const marker = (w: World, session: string): string => join(w.root, projectKey(w.project), session, 'audited');
const ledger = (w: World, session: string): string[] => {
  const d = join(w.root, projectKey(w.project), session);
  return readdirSync(d).filter((f) => f.endsWith('.jsonl')).sort().flatMap((f) => readFileSync(join(d, f), 'utf8').split('\n').filter(Boolean));
};

test('the repro: a wake-up that wrote nothing is not audited again', async () => {
  const w = world(); const s = session(w, 'S1');
  s.add(prompt('add the fix note'), editReview(w), say('note added'));
  assert.match(await stop(w, s), REVIEW_GATE);
  s.add(wake('t1'), say('the background agent finished; nothing to do'));
  assert.equal(await stop(w, s), '');
});

test('work done after the earlier Stop is audited at the next Stop — once', async () => {
  const w = world(); const s = session(w, 'S1');
  s.add(prompt('review it'), editReview(w), say('first'));
  assert.equal(count(await stop(w, s), REVIEW_GATE), 1);
  s.add(wake('t1'), editReview(w), say('second note'));
  assert.equal(count(await stop(w, s), REVIEW_GATE), 1, 'the new write fires again');
  s.add(wake('t2'), say('nothing new'));
  assert.equal(await stop(w, s), '');
});

test('a completion claim and its evidence are judged in the part where they were made', async () => {
  const w = world(); const s = session(w, 'S1');
  s.add(prompt('build'), call('Edit', { file_path: P(w, 'src/a.src') }), say('all done'));
  assert.match(await stop(w, s), /VERIFICATION GATE/u);
  s.add(wake('t1'), say('still waiting on the agent'));
  assert.equal(await stop(w, s), '', 'the old claim is not judged a second time');
});

test('a background agent that finishes after a Stop is audited once, at the Stop after its notification', async () => {
  const w = world(); const s = session(w, 'S1');
  const [aid, agent] = toolUse('Agent', { subagent_type: 'burhan-reviewer', prompt: 'review', run_in_background: true });
  s.add(prompt('review SU1'), agent, result(aid, { agentId: 'synthetic01', isAsync: true, status: 'async_launched' }), say('launched'));
  assert.equal(await stop(w, s), '', 'nothing written yet');
  const sub = join(s.path.replace(/\.jsonl$/u, ''), 'subagents');
  mkdirSync(sub, { recursive: true });
  const [wid, write] = toolUse('Write', { file_path: P(w, NOTE), content: '# n' });
  writeFileSync(join(sub, 'agent-synthetic01.jsonl'), [prompt('review'), write, result(wid, { type: 'create' })].map((r) => JSON.stringify({ ...r, isSidechain: true })).join('\n') + '\n');
  s.add(wake('synthetic01'), say('the review is back'));
  assert.equal(count(await stop(w, s), STATE_GATE), 1, 'the agent work is audited at the wake-up Stop');
  s.add(wake('t2'), say('nothing more'));
  assert.equal(await stop(w, s), '', 'and not again');
});

test('a marker that is missing, corrupt, from another prompt or points at an unknown record → the whole window, as today', async () => {
  for (const bad of ['{not json', '{"turn":"other","upTo":"x","agents":{}}', '{"turn":"%TURN%","upTo":"no-such-record","agents":{}}', '']) {
    const w = world(); const s = session(w, 'S1');
    const first = prompt('add the fix note');
    s.add(first, editReview(w), say('note added'));
    assert.match(await stop(w, s), REVIEW_GATE);
    writeFileSync(marker(w, 'S1'), bad.replace('%TURN%', String(first.uuid)));
    s.add(wake('t1'), say('nothing to do'));
    assert.match(await stop(w, s), REVIEW_GATE, `fails open to the whole window (${bad || 'empty'})`);
  }
});

test('another session is not affected by this session\'s marker', async () => {
  const w = world(); const a = session(w, 'S1'); const b = session(w, 'S2');
  a.add(prompt('x'), editReview(w), say('a'));
  assert.match(await stop(w, a), REVIEW_GATE);
  b.add(prompt('y'), editReview(w), say('b'));
  assert.match(await stop(w, b), REVIEW_GATE);
});

test('a Stop after the hook blocked (reentrant) moves the marker: the continuation is not audited at the next wake-up', async () => {
  const w = world(); const s = session(w, 'S1');
  s.add(prompt('review it'), editReview(w), say('first'));
  assert.match(await stop(w, s), REVIEW_GATE);
  s.add(editReview(w), say('fixed after the block'));
  assert.equal(await stop(w, s, true), '');
  s.add(wake('t1'), say('nothing'));
  assert.equal(await stop(w, s), '');
});

test('the ledger holds every step of the user turn exactly once, across the parts', async () => {
  const w = world(); const s = session(w, 'S1');
  s.add(prompt('go'), call('Edit', { file_path: P(w, 'src/a.src') }), call('Bash', { command: 'npm test' }, {}), say('part one'));
  await stop(w, s);
  s.add(wake('t1'), call('Edit', { file_path: P(w, 'src/b.src') }), say('part two'));
  await stop(w, s);
  s.add(wake('t2'), say('nothing'));
  await stop(w, s);
  const steps = ledger(w, 'S1').map((l) => JSON.parse(l) as { kind: string; file?: string; cmd?: string; part: number; seq: number; turn: string })
    .sort((a, b) => a.part - b.part || a.seq - b.seq); // the order `burhan evidence` reads them in
  assert.deepEqual(steps.map((x) => x.file ?? x.cmd), ['src/a.src', 'npm test', 'src/b.src']);
  assert.equal(new Set(steps.map((x) => x.turn)).size, 1, 'one turn id');
  assert.deepEqual(steps.map((x) => x.part), [0, 0, 1]);
});

test('the marker holds ids and counts only, and is private', async () => {
  const w = world(); const s = session(w, 'S1');
  s.add(prompt('SECRET-PROMPT-TEXT'), editReview(w), say('SECRET-ANSWER-TEXT'));
  await stop(w, s);
  const text = readFileSync(marker(w, 'S1'), 'utf8');
  assert.doesNotMatch(text, /SECRET/u);
  assert.doesNotMatch(text, new RegExp(w.project.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&'), 'u'));
  if (process.platform !== 'win32') assert.equal((await import('node:fs')).statSync(marker(w, 'S1')).mode & 0o777, 0o600);
});

test('with the evidence ledger off there is no session store, so no marker: the whole turn is audited as before', async () => {
  const w = world(); w.env.WF_EVIDENCE_LEDGER = 'off'; const s = session(w, 'S1');
  s.add(prompt('add the fix note'), editReview(w), say('note added'));
  assert.match(await stop(w, s), REVIEW_GATE);
  s.add(wake('t1'), say('nothing to do'));
  assert.match(await stop(w, s), REVIEW_GATE);
});

test('a lost marker at a later Stop (the whole turn again) does not double the ledger (review M-2)', async () => {
  const w = world(); const s = session(w, 'S1');
  s.add(prompt('go'), call('Edit', { file_path: P(w, 'src/a.src') }), say('one'));
  await stop(w, s);
  s.add(wake('t1'), call('Edit', { file_path: P(w, 'src/b.src') }), say('two'));
  await stop(w, s);
  writeFileSync(marker(w, 'S1'), '{broken');
  s.add(wake('t2'), say('three'));
  await stop(w, s);
  const files = ledger(w, 'S1').map((l) => (JSON.parse(l) as { file: string }).file).sort();
  assert.deepEqual(files, ['src/a.src', 'src/b.src']);
});

test('an agent audited at n steps that grows to n+k is audited for the k only (review M-4)', async () => {
  const w = world(); const s = session(w, 'S1');
  const [aid, agent] = toolUse('Agent', { subagent_type: 'burhan-builder', prompt: 'build', run_in_background: true });
  s.add(prompt('build it'), agent, result(aid, { agentId: 'synthetic01', isAsync: true, status: 'async_launched' }), say('launched'));
  const sub = join(s.path.replace(/\.jsonl$/u, ''), 'subagents');
  mkdirSync(sub, { recursive: true });
  const step = (rel: string): Rec[] => { const [id, rec] = toolUse('Write', { file_path: P(w, rel), content: 'x' }); return [rec, result(id, { type: 'create' })]; };
  const agentFile = join(sub, 'agent-synthetic01.jsonl');
  const put = (...recs: Rec[]): void => appendFileSync(agentFile, recs.map((r) => JSON.stringify({ ...r, isSidechain: true })).join('\n') + '\n');
  put(prompt('build'), ...step('src/a.src'));
  await stop(w, s);
  put(...step('src/b.src'));
  s.add(wake('synthetic01'), say('done'));
  await stop(w, s);
  s.add(wake('t2'), say('nothing'));
  await stop(w, s);
  const files = ledger(w, 'S1').map((l) => (JSON.parse(l) as { file: string }).file).sort();
  assert.deepEqual(files, ['src/a.src', 'src/b.src'], 'each agent step recorded once');
});

test('the evidence folder named only in workflow.config is the one the marker uses (V finding: the adapter read the environment alone)', async () => {
  const w = world();
  const configured = tmpDir('burhan-reaudit-configured-');
  delete w.env.WF_EVIDENCE_DIR;
  w.env.XDG_STATE_HOME = tmpDir('burhan-reaudit-xdg-'); // the default root, which must stay empty
  writeFileSync(join(w.project, '.burhan/workflow.config'), `WF_EVIDENCE_DIR="${configured}"\n`);
  const s = session(w, 'S1');
  s.add(prompt('add the fix note'), editReview(w), say('note added'));
  assert.match(await stop(w, s), REVIEW_GATE);
  s.add(wake('t1'), say('nothing to do'));
  assert.equal(await stop(w, s), '');
  assert.ok(readFileSync(join(configured, projectKey(w.project), 'S1', 'audited'), 'utf8').includes('upTo'));
  assert.deepEqual(readdirSync(w.env.XDG_STATE_HOME), [], 'nothing written under the default root');
});

test('a skill used in an earlier part of the user turn still counts in a later part (the gates ask "this turn")', async () => {
  const w = world(); const s = session(w, 'S1');
  s.add(prompt('review it'), call('Skill', { skill: 'superpowers:requesting-code-review' }, {}), say('dispatching'));
  await stop(w, s);
  s.add(wake('t1'), editReview(w), say('wrote the review'));
  assert.doesNotMatch(await stop(w, s), REVIEW_GATE, 'the skill was used earlier in this same user turn');
  const other = world(); const o = session(other, 'S2');
  o.add(prompt('review it'), say('thinking'));
  await stop(other, o);
  o.add(wake('t1'), editReview(other), say('wrote the review'));
  assert.match(await stop(other, o), REVIEW_GATE, 'without the skill it fires');
  const text = readFileSync(marker(w, 'S1'), 'utf8');
  assert.match(text, /requesting-code-review/u);
  assert.doesNotMatch(text, /review it/u, 'names only, no prompt text');
});
