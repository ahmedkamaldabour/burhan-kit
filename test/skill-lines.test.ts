import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectKey } from '../src/lib/evidence.js';
import { cli, project, projectWithItem } from './item-fixture.js';
import { tmpDir } from './helpers.js';

const config = (dir: string, text: string): void => writeFileSync(join(dir, '.burhan', 'workflow.config'), text);
const skillOf = (out: string): string | null => /^skill: (superpowers:[a-z-]+) — run it /m.exec(out)?.[1] ?? null;
const BY = ['--by', 'dev-dabour'];

test('guide prints the skill line for the item\'s stage', async () => {
  const dir = await projectWithItem();
  config(dir, 'WF_SKILLS=superpowers\n');
  const g = async (): Promise<string | null> => { const r = await cli(dir, ['guide', 'foo']); assert.equal(r.code, 0, r.err); return skillOf(r.out); };
  assert.equal(await g(), 'superpowers:brainstorming'); // story draft
  await cli(dir, ['approve', 'story', 'foo', ...BY]);
  assert.equal(await g(), 'superpowers:writing-plans'); // approved story, plan draft
  await cli(dir, ['approve', 'plan', 'foo', ...BY]);
  assert.equal(await g(), 'superpowers:test-driven-development'); // sub-unit 1 to start
  await cli(dir, ['item', 'set', 'foo', 'unit', '1', 'in-progress']);
  assert.equal(await g(), 'superpowers:test-driven-development');
  await cli(dir, ['item', 'set', 'foo', 'unit', '1', 'implemented']);
  assert.equal(await g(), 'superpowers:requesting-code-review');
});

test('guide --json has a skill field: the skill, or null', async () => {
  const dir = await projectWithItem();
  config(dir, 'WF_SKILLS=superpowers\n');
  const on = JSON.parse((await cli(dir, ['guide', 'foo', '--json'])).out) as { skill: string | null };
  assert.equal(on.skill, 'superpowers:brainstorming');
  config(dir, 'WF_SKILLS=none\n');
  const off = JSON.parse((await cli(dir, ['guide', 'foo', '--json'])).out) as { skill: string | null };
  assert.equal(off.skill, null);
});

test('no skill line and a null skill when WF_SKILLS is none, empty or absent: nothing else changes', async () => {
  for (const text of ['WF_SKILLS=none\n', 'WF_SKILLS=\n', null]) {
    const dir = await projectWithItem();
    if (text !== null) config(dir, text);
    const g = await cli(dir, ['guide', 'foo']);
    assert.equal(g.code, 0, g.err);
    assert.equal(skillOf(g.out), null, String(text));
    assert.doesNotMatch(g.out, /^skill:/m);
    assert.equal(JSON.parse((await cli(dir, ['guide', 'foo', '--json'])).out).skill, null);
    const approved = await cli(dir, ['approve', 'story', 'foo', ...BY]);
    assert.doesNotMatch(approved.out, /^skill:/m, String(text));
  }
  const fresh = project();
  config(fresh, 'WF_SKILLS=none\n');
  const made = await cli(fresh, ['item', 'new', 'bar', '--type', 'feature', '--scope', 'architectural']);
  assert.equal(made.code, 0, made.err);
  assert.doesNotMatch(made.out, /^skill:/m);
});

test('the commands that open a stage print the same line, after their own output', async () => {
  const dir = project();
  config(dir, 'WF_SKILLS=superpowers\n');
  const made = await cli(dir, ['item', 'new', 'foo', '--type', 'feature', '--scope', 'architectural']);
  assert.equal(made.code, 0, made.err);
  assert.equal(skillOf(made.out), 'superpowers:brainstorming');
  assert.ok(made.out.indexOf('next: fill the files') < made.out.indexOf('skill: '), 'the skill line comes after the command\'s own lines');
  const ready = await projectWithItem();
  config(ready, 'WF_SKILLS=superpowers\n');
  assert.equal(skillOf((await cli(ready, ['approve', 'story', 'foo', ...BY])).out), 'superpowers:writing-plans');
  assert.equal(skillOf((await cli(ready, ['approve', 'plan', 'foo', ...BY])).out), 'superpowers:test-driven-development');
  assert.equal(skillOf((await cli(ready, ['item', 'set', 'foo', 'unit', '1', 'in-progress'])).out), 'superpowers:test-driven-development');
  assert.equal(skillOf((await cli(ready, ['item', 'set', 'foo', 'unit', '1', 'implemented'])).out), 'superpowers:requesting-code-review');
  await cli(ready, ['deviation', 'add', 'foo', '--unit', '1', '--what', 'RED passed', '--where', 'src/a.ts:10', '--output', 'pass 1']);
  // the deviation is open: no skill, the owner decides; resolving it gives the stage's skill back
  assert.equal(skillOf((await cli(ready, ['guide', 'foo'])).out), null);
  const resolved = await cli(ready, ['deviation', 'resolve', 'foo', '1', '--approved', ...BY]);
  assert.equal(resolved.code, 0, resolved.err);
  assert.equal(skillOf(resolved.out), 'superpowers:requesting-code-review');
});

test('a command that fails prints no skill line, and nothing about skills can make a command fail', async () => {
  const dir = await projectWithItem();
  config(dir, 'WF_SKILLS=superpowers\n');
  const early = await cli(dir, ['approve', 'plan', 'foo', ...BY]); // the story is not approved: refused
  assert.equal(early.code, 2);
  assert.doesNotMatch(early.out + early.err, /^skill:/m);
  const unknown = await cli(dir, ['item', 'set', 'nope', 'unit', '1', 'in-progress']);
  assert.notEqual(unknown.code, 0);
  assert.doesNotMatch(unknown.out + unknown.err, /^skill:/m);
});

const savedState = process.env.XDG_STATE_HOME;
const savedDir = process.env.WF_EVIDENCE_DIR;
afterEach(() => {
  if (savedState === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = savedState;
  if (savedDir === undefined) delete process.env.WF_EVIDENCE_DIR; else process.env.WF_EVIDENCE_DIR = savedDir;
});

/** A ledger for this project in a folder of this test: one file per session, the records as given (each may name its own session). */
function ledger(dir: string, recs: Array<Record<string, unknown>>): void {
  const state = tmpDir('burhan-ledger-');
  process.env.XDG_STATE_HOME = state;
  process.env.WF_EVIDENCE_DIR = ''; // the ledger is the one of this test, whatever the developer's shell exports
  const bySession = new Map<string, Array<Record<string, unknown>>>();
  for (const r of recs) { const s = String(r.session ?? 'S1'); bySession.set(s, [...(bySession.get(s) ?? []), r]); }
  for (const [session, list] of bySession) {
    const folder = join(state, 'burhan', 'evidence', projectKey(dir), session);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'T1.jsonl'), list.map((r, i) => JSON.stringify({ agent: 'claude', session, turn: 'T1', seq: i + 1, project: dir, ...r })).join('\n') + '\n');
  }
}
const skillRec = (o: Record<string, unknown>) => ({ kind: 'skill', skill: 'superpowers:brainstorming', item: 'foo', ts: '2026-10-28T10:00:00Z', ...o });
const lineOf = async (dir: string): Promise<string> => { const r = await cli(dir, ['guide', 'foo']); assert.equal(r.code, 0, r.err); return /^skill: .*$/m.exec(r.out)?.[0] ?? ''; };

test('the line says the skill was recorded for this item, with its time and session', async () => {
  const dir = await projectWithItem();
  config(dir, 'WF_SKILLS=superpowers\n');
  ledger(dir, [skillRec({ session: 'S1' })]);
  assert.match(await lineOf(dir), /\(recorded at 2026-10-28T10:00:00Z, session S1; the ledger is written at the end of a turn\)$/);
  const asked = await cli(dir, ['approve', 'story', 'foo', ...BY]); // the line is the same function: after approve the stage wants writing-plans
  assert.match(asked.out, /^skill: superpowers:writing-plans — run it before the plan and the build spec \(not recorded for this item in the latest session\)$/m);
});

test('a skill run before the item was linked (recorded under no item) counts; another item\'s does not', async () => {
  const dir = await projectWithItem();
  config(dir, 'WF_SKILLS=superpowers\n');
  ledger(dir, [skillRec({ item: null })]);
  assert.match(await lineOf(dir), /\(recorded at /);
  ledger(dir, [skillRec({ item: 'bar' })]);
  assert.match(await lineOf(dir), /\(not recorded for this item in the latest session\)$/);
});

test('only the latest session of the project counts: an earlier session\'s record does not', async () => {
  const dir = await projectWithItem();
  config(dir, 'WF_SKILLS=superpowers\n');
  ledger(dir, [skillRec({ session: 'S0', ts: '2026-10-28T09:00:00Z' }), { kind: 'cmd', session: 'S1', ts: '2026-10-28T10:00:00Z', cmd: 'ls', exit: 0, status: 'ok', item: 'foo' }]);
  assert.match(await lineOf(dir), /\(not recorded for this item in the latest session\)$/);
});

test('with no ledger the line says it cannot tell', async () => {
  const dir = await projectWithItem();
  config(dir, 'WF_SKILLS=superpowers\n');
  process.env.XDG_STATE_HOME = tmpDir('burhan-empty-ledger-');
  process.env.WF_EVIDENCE_DIR = '';
  assert.match(await lineOf(dir), /\(cannot tell: the evidence ledger has no record for this project yet\)$/);
});

test('a skill that is another stage\'s does not count as recorded', async () => {
  const dir = await projectWithItem();
  config(dir, 'WF_SKILLS=superpowers\n');
  ledger(dir, [skillRec({ skill: 'superpowers:writing-plans' })]);
  assert.match(await lineOf(dir), /^skill: superpowers:brainstorming — .*\(not recorded for this item in the latest session\)$/);
});

test('WF_SKILLS is read the way the hooks read it: the shell environment when no config file sets it, the file over the environment', async () => {
  const saved = process.env.WF_SKILLS;
  try {
    const dir = await projectWithItem();
    process.env.WF_SKILLS = 'superpowers'; // the shell only: no config file names the key
    assert.equal(skillOf((await cli(dir, ['guide', 'foo'])).out), 'superpowers:brainstorming');
    assert.equal(JSON.parse((await cli(dir, ['guide', 'foo', '--json'])).out).skill, 'superpowers:brainstorming');
    config(dir, 'WF_SKILLS=none\n'); // a file value wins over the environment, as in the hooks
    assert.equal(skillOf((await cli(dir, ['guide', 'foo'])).out), null);
    delete process.env.WF_SKILLS;
    config(dir, 'WF_SKILLS=superpowers\n');
    assert.equal(skillOf((await cli(dir, ['guide', 'foo'])).out), 'superpowers:brainstorming');
  } finally {
    if (saved === undefined) delete process.env.WF_SKILLS; else process.env.WF_SKILLS = saved;
  }
});
