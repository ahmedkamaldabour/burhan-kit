import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { run } from '../../src/hooks/main.mjs';
import { tmpDir } from '../helpers.js';

// A story, plan or review written through the shell (`cat > file <<EOF`, `>`, `>>`, `tee`) gets the same skill reminder as one written with
// the edit tools (item skills-link-and-shell-writes). The reminder rides on the Bash hook that is already installed (`pre-commit-check`).
const D = 'AI_SPEC/docs';
const BRAIN = 'superpowers:brainstorming';
const PLANS = 'superpowers:writing-plans';
const REVIEW = 'superpowers:requesting-code-review';
const STORY_CMD = `cat > ${D}/foo/foo-story.md <<'EOF'\n# story\nEOF`;
const PLAN_CMD = `cat > ${D}/foo/foo-implementation-plan.md <<'EOF'\nplan\nEOF`;
const REVIEW_CMD = `echo review | tee ${D}/foo/reviews/foo-review.md`;

interface Scene { project: string; store: string; env: NodeJS.ProcessEnv }
function scene(extra: string[] = []): Scene {
  const project = tmpDir('burhan-shellw-project-');
  const store = tmpDir('burhan-shellw-store-');
  mkdirSync(join(project, '.burhan/local'), { recursive: true });
  writeFileSync(join(project, '.burhan/workflow.config'), [`WF_DOCS_DIR=${D}`, 'WF_DISCOVERY_DIR=AI_SPEC/discovery', 'WF_STATE_FILE=.burhan/local/PROGRESS.md', 'WF_SKILLS=superpowers', 'WF_CHECK_CMD=true', `WF_EVIDENCE_DIR='${store}'`, ...extra].join('\n') + '\n');
  writeFileSync(join(project, '.burhan/local/PROGRESS.md'), '# s\n## Now\n## Waiting on you\n');
  return { project, store, env: { ...process.env, WF_EVIDENCE_DIR: store } };
}
const core = async (s: Scene, command: string, skills: string[] = [], over: Record<string, unknown> = {}): Promise<string> =>
  (await run(['core', 'pre-commit-check'], JSON.stringify({ event: 'pre_shell', command, project_dir: s.project, session: 'S', turn: { skills_used: skills, assistant_text: '' }, ...over }), s.env)).stdout;
const used = (s: Scene, skills: string[]) => run(['core', 'turn-audit'], JSON.stringify({ event: 'turn_end', session: 'S', project_dir: s.project, turn: { skills_used: skills, assistant_text: 'ok', files_created: [], files_edited: [], shell_commands: [], steps: [] } }), s.env);

// ---- AC-01 / AC-02: the reminder, for the three file kinds ----
test('a heredoc story without brainstorming prints the story line', async () => {
  assert.match(await core(scene(), STORY_CMD), /Skill \(story\): invoke superpowers:brainstorming and read its instructions before you start/u);
});
test('a heredoc plan without writing-plans prints the plan line', async () => {
  assert.match(await core(scene(), PLAN_CMD), /Skill \(plan\): invoke superpowers:writing-plans/u);
});
test('a tee review without requesting-code-review prints the review line', async () => {
  assert.match(await core(scene(), REVIEW_CMD), /Skill \(review\): invoke superpowers:requesting-code-review/u);
});
test('an append (>>) to a story is covered too', async () => {
  assert.match(await core(scene(), `echo x >> ${D}/foo/foo-story.md`), /Skill \(story\)/u);
});
test('the skill used in this turn → nothing', async () => {
  assert.equal(await core(scene(), STORY_CMD, [BRAIN]), '');
  assert.equal(await core(scene(), PLAN_CMD, [PLANS]), '');
  assert.equal(await core(scene(), REVIEW_CMD, [REVIEW]), '');
});
test('the skill used in an earlier turn of the session → nothing', async () => {
  const s = scene();
  await used(s, [BRAIN]);
  assert.equal(await core(s, STORY_CMD), '');
});
test('a different phase skill does not stand in', async () => {
  assert.match(await core(scene(), PLAN_CMD, [BRAIN]), /Skill \(plan\)/u);
});
test('once per session, item and skill', async () => {
  const s = scene();
  assert.notEqual(await core(s, STORY_CMD), '');
  assert.equal(await core(s, STORY_CMD), '');
});

// ---- AC-03: everything else says nothing ----
for (const [name, command] of [['a plain command', 'ls -la'], ['an echo', 'echo hi'], ['a redirect to a non-work file', 'echo x > notes.txt'],
  ['a redirect to the state file', 'echo x >> .burhan/local/PROGRESS.md'], ['a QC report', `echo x > ${D}/foo/reviews/foo-qc.md`], ['a verification report', `echo x > ${D}/foo/reviews/foo-verification.md`],
  ['a source', `echo x > ${D}/foo/sources/old-story.md`], ['a read of a story', `cat ${D}/foo/foo-story.md`]] as const) {
  test(`${name} prints nothing`, async () => assert.equal(await core(scene(), command), ''));
}
test('a story that already exists is not reminded (as for the edit tools)', async () => {
  const s = scene();
  const file = join(s.project, D, 'foo/foo-story.md'); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, '# old\n');
  assert.equal(await core(s, STORY_CMD), '');
});
test('a subagent stays silent', async () => assert.equal(await core(scene(), STORY_CMD, [], { agent_id: 'a1' }), ''));
test('with the skills off nothing is printed', async () => {
  const s = scene(); writeFileSync(join(s.project, '.burhan/workflow.config'), `WF_DOCS_DIR=${D}\nWF_SKILLS=none\nWF_EVIDENCE_DIR='${s.store}'\n`);
  assert.equal(await core(s, STORY_CMD), '');
});

// ---- AC-04: the git commit check is unchanged, and both can speak ----
test('git commit alone: the pre-commit gate only', async () => {
  const out = await core(scene(), 'git commit -m x');
  assert.match(out, /Pre-commit gate — measured: PASS/u);
  assert.doesNotMatch(out, /Skill \(/u);
});
test('a command that commits and writes a story: both messages', async () => {
  const out = await core(scene(), `${STORY_CMD}\ngit commit -m x`);
  assert.match(out, /Pre-commit gate/u);
  assert.match(out, /Skill \(story\)/u);
});

// ---- the Claude adapter: the transcript is read only for a command that writes a work file (AC-01, AC-03) ----
const turnWith = (skill: string): string => [
  JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: 'go' } }),
  JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill } }] } }),
  JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }),
].join('\n') + '\n';
function payload(s: Scene, command: string, transcript: string): string {
  const path = join(s.project, 'transcript.jsonl'); writeFileSync(path, transcript);
  return JSON.stringify({ session_id: 'S', transcript_path: path, cwd: s.project, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
}
const normalize = async (s: Scene, command: string, transcript: string): Promise<Record<string, any>> =>
  JSON.parse((await run(['claude', 'normalize'], payload(s, command, transcript), { ...s.env, CLAUDE_PROJECT_DIR: s.project })).stdout);
test('adapter: a command that writes a story carries this turn\'s skills', async () => {
  const e = await normalize(scene(), STORY_CMD, turnWith(BRAIN));
  assert.equal(e.event, 'pre_shell');
  assert.deepEqual(e.turn?.skills_used, [BRAIN]);
});
test('adapter: a command that writes nothing is not read against the transcript', async () => {
  for (const command of ['ls -la', 'echo x > notes.txt', 'git commit -m x']) {
    const e = await normalize(scene(), command, turnWith(BRAIN));
    assert.equal(e.event, 'pre_shell');
    assert.ok(!e.turn?.skills_used?.length, `${command}: ${JSON.stringify(e.turn)}`);
  }
});
test('adapter: with the skills off the transcript is not read even for a story write', async () => {
  const s = scene(); writeFileSync(join(s.project, '.burhan/workflow.config'), `WF_DOCS_DIR=${D}\nWF_SKILLS=none\n`);
  assert.ok(!(await normalize(s, STORY_CMD, turnWith(BRAIN))).turn?.skills_used?.length);
});
test('adapter end to end: the installed Bash hook prints the line, and nothing once the skill was used', async () => {
  const s = scene();
  const env = { ...s.env, CLAUDE_PROJECT_DIR: s.project };
  const first = (await run(['claude', 'hook', 'pre-commit-check'], payload(s, STORY_CMD, ''), env)).stdout;
  assert.match(first, /"hookEventName":"PreToolUse"/u);
  assert.match(first, /Skill \(story\): invoke superpowers:brainstorming/u);
  const s2 = scene();
  const second = (await run(['claude', 'hook', 'pre-commit-check'], payload(s2, STORY_CMD, turnWith(BRAIN)), { ...s2.env, CLAUDE_PROJECT_DIR: s2.project })).stdout;
  assert.equal(second, '');
});

// ---- Codex: the same, with the skills read earlier in the turn taken from its per-turn ledger (AC-07) ----
function codexPayload(s: Scene, command: string): string {
  return JSON.stringify({ session_id: 'CS', turn_id: 'CT', cwd: s.project, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
}
function codexEnv(s: Scene, skillRead: string | null): NodeJS.ProcessEnv {
  const ledger = tmpDir('burhan-shellw-codex-');
  if (skillRead !== null) {
    mkdirSync(join(ledger, 'CS'), { recursive: true }); writeFileSync(join(ledger, '.burhan-ledger'), '');
    writeFileSync(join(ledger, 'CS', 'CT.jsonl'), JSON.stringify({ tool_name: 'Bash', tool_input: { command: `sed -n 1,80p /home/u/.codex/superpowers/skills/${skillRead}/SKILL.md` }, tool_use_id: 'x', patch_exit: null }) + '\n');
  }
  return { ...s.env, WF_CODEX_LEDGER_DIR: ledger };
}
const codexNormalize = async (s: Scene, command: string, skillRead: string | null): Promise<Record<string, any>[]> =>
  (await run(['codex', 'normalize'], codexPayload(s, command), codexEnv(s, skillRead))).stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
test('codex: a command that writes a story carries the skills read earlier in the turn', async () => {
  const [e] = await codexNormalize(scene(), STORY_CMD, 'brainstorming');
  assert.equal(e?.event, 'pre_shell');
  assert.deepEqual(e?.turn?.skills_used, [BRAIN]);
});
test('codex: a command that writes nothing does not read the ledger', async () => {
  const [e] = await codexNormalize(scene(), 'echo x > notes.txt', 'brainstorming');
  assert.equal(e?.event, 'pre_shell');
  assert.ok(!e?.turn?.skills_used?.length);
});
test('codex: with the skills off nothing extra is attached', async () => {
  const s = scene(); writeFileSync(join(s.project, '.burhan/workflow.config'), `WF_DOCS_DIR=${D}\nWF_SKILLS=none\n`);
  const [e] = await codexNormalize(s, STORY_CMD, 'brainstorming');
  assert.ok(!e?.turn?.skills_used?.length);
});

// ---- turn-end: a story or plan written through the shell is checked like one written with the edit tools (AC-05) ----
const endTurn = async (s: Scene, commands: string[], skills: string[] = [], extra: Record<string, unknown> = {}): Promise<string> =>
  (await run(['core', 'turn-audit'], JSON.stringify({ event: 'turn_end', session: 'S', project_dir: s.project, ...extra, turn: { skills_used: skills, assistant_text: 'written', files_created: [], files_edited: [], shell_commands: commands, steps: [] } }), s.env)).stdout;
test('turn end: a heredoc story with brainstorming never run → the story warning, worded for the shell', async () => {
  const out = await endTurn(scene(), [STORY_CMD]);
  assert.match(out, /⚠ SKILL GATE \(story\): a story was written through the shell this turn without superpowers:brainstorming\. Invoke it now if it was skipped, or say when it ran\./u);
});
test('turn end: a heredoc plan with writing-plans never run → the plan warning, worded for the shell', async () => {
  assert.match(await endTurn(scene(), [PLAN_CMD]), /⚠ SKILL GATE \(plan\): a plan was written through the shell this turn without superpowers:writing-plans\./u);
});
test('turn end: the skill used in this turn or in an earlier turn → silent', async () => {
  assert.doesNotMatch(await endTurn(scene(), [STORY_CMD], [BRAIN]), /SKILL GATE/u);
  const s = scene();
  await used(s, [PLANS]);
  assert.doesNotMatch(await endTurn(s, [PLAN_CMD]), /SKILL GATE/u);
});
test('turn end: a redirect to a non-work file, a source or the state file raises no skill gate', async () => {
  for (const command of ['echo x > notes.txt', `echo x > ${D}/foo/sources/old-story.md`, 'echo x >> .burhan/local/PROGRESS.md', `echo x > ${D}/foo/foo-notes.md`]) {
    assert.doesNotMatch(await endTurn(scene(), [command]), /SKILL GATE/u, command);
  }
});
test('turn end: a review written through tee, by an agent that does not report its writes, is checked as before', async () => {
  assert.match(await endTurn(scene(), [REVIEW_CMD]), /SKILL GATE: a review file was written this turn without superpowers:requesting-code-review/u);
});
test('turn end: a story created with the edit tool keeps its old wording', async () => {
  const s = scene();
  const file = join(s.project, D, 'foo/foo-story.md'); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, '# s\n');
  const out = (await run(['core', 'turn-audit'], JSON.stringify({ event: 'turn_end', session: 'S', project_dir: s.project, turn: { skills_used: [], assistant_text: 'x', files_created: [file], files_edited: [], shell_commands: [], steps: [] } }), s.env)).stdout;
  assert.match(out, /a story was CREATED this turn without superpowers:brainstorming/u);
});
