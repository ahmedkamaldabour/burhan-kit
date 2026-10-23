import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectKey } from '../src/hooks/core/store.mjs';
import { readLedger, summarizeLedger, skillsFromTold, type LedgerRecord } from '../src/lib/evidence.js';
import { computeStats, renderStats } from '../src/lib/stats.js';
import { project, record } from './hooks/corpora/ledger.js';
import { tmpDir } from './helpers.js';

const rec = (over: Partial<LedgerRecord>): LedgerRecord => ({ ts: '2026-10-23T10:00:00Z', agent: 'claude', session: 's', turn: 't', seq: 1, kind: 'cmd', item: 'foo', project: '/p', ...over });

test('the ledger records the skills a turn used, once each, with the item and the phase', () => {
  const dir = project('## Now\n### foo\n- **Sub-unit:** build\n');
  const root = tmpDir('burhan-skill-ledger-');
  record(dir, root, { event: 'turn_end', agent: 'claude', session: 'S1', turn_id: 'T1', turn: { steps: [{ seq: 1, kind: 'cmd', cmd: 'ls', exit: 0, status: 'ok' }], skills_used: ['superpowers:brainstorming', 'superpowers:brainstorming', 'superpowers:writing-plans'] } });
  const skills = readLedger(dir, { WF_EVIDENCE_DIR: root }).filter((r) => r.kind === 'skill');
  assert.deepEqual(skills.map((r) => r.skill), ['superpowers:brainstorming', 'superpowers:writing-plans']);
  assert.ok(skills.every((r) => r.item === 'foo'));
});

test('a turn with no steps records nothing, skills included (the ledger writes only turns with steps)', () => {
  const dir = project('## Now\n### foo\n');
  const root = tmpDir('burhan-skill-ledger-');
  record(dir, root, { event: 'turn_end', agent: 'claude', session: 'S1', turn_id: 'T1', turn: { steps: [], skills_used: ['superpowers:brainstorming'] } });
  assert.deepEqual(readLedger(dir, { WF_EVIDENCE_DIR: root }), []);
});

test('the summary lists the skills used per item and does not count a skill as a command', () => {
  const s = summarizeLedger([rec({ kind: 'skill', skill: 'superpowers:writing-plans', seq: 2 }), rec({ kind: 'skill', skill: 'superpowers:brainstorming', seq: 3 }), rec({ kind: 'skill', skill: 'superpowers:brainstorming', seq: 4, turn: 't2' }), rec({ item: null, kind: 'skill', skill: 'superpowers:systematic-debugging', seq: 5 }), rec({})], '');
  assert.equal(s.commands, 1);
  assert.deepEqual(s.skillsUsed, { foo: ['superpowers:brainstorming', 'superpowers:writing-plans'], '(no item)': ['superpowers:systematic-debugging'] });
});

test('the told file (pre-write reminders) is read per item', () => {
  const dir = project('## Now\n');
  const root = tmpDir('burhan-skill-told-');
  const session = join(root, projectKey(dir), 'S1');
  mkdirSync(session, { recursive: true });
  writeFileSync(join(session, 'skilltold'), 'foo\tsuperpowers:brainstorming\n-\tsuperpowers:test-driven-development\nfoo\tsuperpowers:writing-plans\n');
  assert.deepEqual(skillsFromTold(dir, { WF_EVIDENCE_DIR: root }), { foo: ['superpowers:brainstorming', 'superpowers:writing-plans'], '(no item)': ['superpowers:test-driven-development'] });
});

test('stats prints skills used and reminders per item, and says none when there is no data', () => {
  const none = renderStats({ ...computeStats([]), evidence: null }, 'docs');
  assert.match(none, /Skills: none recorded yet/u);
  const text = renderStats({ ...computeStats([]), evidence: { commands: 1, failed: 0, evidenceRuns: 0, evidencePassed: 0, itemsWithPassingEvidence: [], skillsUsed: { foo: ['superpowers:brainstorming'] }, remindersShown: { foo: ['superpowers:brainstorming', 'superpowers:writing-plans'] } } }, 'docs');
  assert.match(text, /foo — used: superpowers:brainstorming · reminded: superpowers:brainstorming, superpowers:writing-plans/u);
});
