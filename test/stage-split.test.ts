import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const norm = (s: string): string => s.replace(/[`*]/g, '').replace(/\s+/g, ' ').trim();
const kitFiles = (): string[] => ['kit/commands', 'kit/phases', 'kit/templates', 'kit'].flatMap((d) => readdirSync(join(root, d), { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => `${d}/${e.name}`));
const STAGE = ['stage-story', 'stage-plan', 'stage-build', 'stage-finish'].map((n) => `kit/phases/${n}.md`);
// The lifecycle diagram's marks are boundaries, not part of any sentence.
const SPLIT = /(?<=[.!?:])\s+|\s*│\s*|\s*⛔ STOP — explicit approval\s*/;
const sentences = (text: string): string[] => norm(text).split(SPLIT).filter((s) => s.split(' ').length >= 9);

// The edits the owner approved (Deviations rows 5 and 7). Nothing else may change a moved sentence.
const POINTERS: Array<[string, string]> = [
  ['(.burhan/phases/lifecycle.md · Modes)', '(.burhan/phases/stage-build.md · Modes)'],
  ['## 2) Branch on state - No item yet', '## Intake and the story step - No item yet'],
  ['(.burhan/phases/lifecycle.md · Decomposition)', '(Decomposition, below)'],
  ['(the plan as in the plan step below)', '(the plan as in phases/stage-plan.md)'],
  ['go to the plan step below.', 'go to phases/stage-plan.md.'],
  ['changed --item $ARGUMENTS)', 'changed --item <slug>)'],
  ['suggest burhan:qc $ARGUMENTS', 'suggest burhan:qc <slug>'],
  ['you take in a request, write a story or a plan, or the approved intent changes.', 'you want the overview of the lifecycle; the detail of each step is in the stage file WORKFLOW §9 names.'],
  ['propose a split (below).', 'propose a split (phases/stage-story.md · Decomposition).'],
  ['and everything in reviews/.', 'and reviews/ by need: the QC and verification reports in full, and of the review file its headings, the sections of sub-units not yet Reviewed and the latest fix round; open a closed section only when a finding of it is named or the plan says so (QC reads everything).'],
  ['use the verification identity from §1', 'use the verification identity from WORKFLOW §1'],
  ['is an intent change (below).', 'is an intent change (phases/stage-build.md · When the intent changes mid-flight).'],
];
// Second copies of sentences that were in two files: [the dropped sentence, the file that keeps its twin].
const DUPLICATES: Array<[string, string]> = [
  ['After each sub-unit run the tests that relate to the part you changed', 'kit/phases/stage-build.md'],
  ["Definition of done = every gate the route requires is ticked in the plan's Gate checklist.", 'kit/WORKFLOW.md'],
];

test('the four stage files exist and the old sentences each live in exactly one of e2e.md, lifecycle.md and the stage files', () => {
  const ledger: string[] = JSON.parse(readFileSync(join(root, 'test/fixtures/stage-sentences.json'), 'utf8'));
  const homes = ['kit/commands/e2e.md', 'kit/phases/lifecycle.md', ...STAGE].map((f) => ({ f, text: norm(readFileSync(join(root, f), 'utf8')) }));
  const lost: string[] = [];
  const twice: string[] = [];
  for (const raw of ledger) {
    const s = POINTERS.reduce((t, [from, to]) => t.split(from).join(to), raw);
    const dup = DUPLICATES.find(([d]) => s.startsWith(d));
    if (dup !== undefined) {
      const twin = norm(readFileSync(join(root, dup[1]), 'utf8'));
      const lowered = dup[0].charAt(0).toLowerCase() + dup[0].slice(1);
      if (!twin.includes(dup[0]) && !twin.includes(lowered)) lost.push(`its twin is not in ${dup[1]}: ${dup[0].slice(0, 60)}`);
      continue;
    }
    const where = homes.filter((h) => h.text.includes(s)).map((h) => h.f);
    if (where.length === 0) lost.push(s.slice(0, 80));
    if (where.length > 1) twice.push(`${s.slice(0, 60)} → ${where.join(', ')}`);
  }
  assert.deepEqual(lost, [], 'a sentence is lost (an allowed edit is listed in POINTERS or DUPLICATES, approved in the plan Deviations)');
  assert.deepEqual(twice, []);
});

test('no sentence of nine or more words appears in two kit files', () => {
  const seen = new Map<string, string>();
  const dup: string[] = [];
  for (const f of kitFiles().filter((f) => !f.startsWith('kit/templates/'))) {
    for (const s of new Set(sentences(readFileSync(join(root, f), 'utf8')))) {
      const prior = seen.get(s);
      if (prior !== undefined && prior !== f) dup.push(`${s.slice(0, 60)} → ${prior}, ${f}`);
      seen.set(s, f);
    }
  }
  assert.deepEqual(dup, []);
});

test('the core map names every stage file, and the core stays within the existing 1,600-word cap', () => {
  const core = readFileSync(join(root, 'kit/WORKFLOW.md'), 'utf8').split('\n## الخلاصة')[0]!;
  for (const f of STAGE) assert.ok(core.includes(f.replace('kit/', '')), `${f} is not in the §9 map`);
  assert.ok(core.split(/\s+/).filter(Boolean).length <= 1600);
});

test('e2e.md is a sequencer: it points at each stage file', () => {
  const e2e = readFileSync(join(root, 'kit/commands/e2e.md'), 'utf8');
  for (const f of STAGE) assert.ok(e2e.includes(f.replace('kit/', '.burhan/')), `e2e.md does not point at ${f}`);
});

test('the item commands are reachable at every stage: the sequencer names each one and points at the table in stage-plan.md', () => {
  const e2e = norm(readFileSync(join(root, 'kit/commands/e2e.md'), 'utf8'));
  const plan = norm(readFileSync(join(root, 'kit/phases/stage-plan.md'), 'utf8'));
  for (const c of ['item new', 'item set', 'gate tick', 'review add', 'approve', 'deviation', 'item finish', 'guide']) {
    assert.ok(plan.includes(c), `the command table in stage-plan.md lost: ${c}`);
    assert.ok(e2e.includes(c), `the sequencer does not name: ${c}`);
  }
  assert.ok(e2e.includes('the table and its rules are in .burhan/phases/stage-plan.md · The commands own the item files'));
});

test('a release is sent to the verification before the review', () => {
  const e2e = norm(readFileSync(join(root, 'kit/commands/e2e.md'), 'utf8'));
  assert.ok(e2e.includes('A release verifies before it is reviewed: read .burhan/phases/stage-finish.md (verification) before the review in .burhan/phases/stage-build.md.'));
});
