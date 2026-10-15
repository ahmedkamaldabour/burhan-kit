import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tmpDir } from '../helpers.js';
import { readRecords, turnFromRecords, type Step } from '../../src/hooks/adapters/claude/transcript.mjs';

type GoldenCase = { name: string; transcript?: string; expected: string };
type Golden = { cases: GoldenCase[] };
type TurnFields = Pick<ReturnType<typeof turnFromRecords>, 'files_created' | 'files_edited' | 'shell_commands' | 'skills_used' | 'assistant_text' | 'steps'>;

const fixtures = new URL('../../../tests/adapters/claude/fixtures/', import.meta.url);
const golden = JSON.parse(readFileSync(new URL('../../../test/hooks/fixtures/claude-normalize-golden.json', import.meta.url), 'utf8')) as Golden;

function writeJsonl(name: string, rows: unknown[]): string {
  const path = join(tmpDir('burhan-claude-transcript-'), name);
  writeFileSync(path, rows.map((row) => typeof row === 'string' ? row : JSON.stringify(row)).join('\n') + '\n');
  return path;
}

function withoutAgents(steps: Step[]): Step[] {
  return steps.filter((step) => step.kind !== 'agent').map(({ _ts: _ignored, ...step }, index) => ({ ...step, seq: index + 1 }));
}

test('readRecords keeps only JSON object lines in the final 20,000-line window', () => {
  const path = writeJsonl('mixed.jsonl', [
    { n: 0 }, 'not json', '42', '[]', '"text"', '{"nul":"a\\u0000b"}',
    ...Array.from({ length: 20_005 }, (_, n) => ({ n: n + 1 })),
  ]);
  const rows = readRecords(path);
  assert.equal(rows.length, 20_000);
  assert.deepEqual(rows[0], { n: 6 });
  assert.deepEqual(rows.at(-1), { n: 20_005 });

  const nul = readRecords(writeJsonl('nul.jsonl', ['{"text":"a\u0000b"}']));
  assert.deepEqual(nul, [{ text: 'ab' }]);
  assert.deepEqual(readRecords(join(tmpDir('burhan-claude-transcript-missing-'), 'missing.jsonl')), []);
});

test('readRecords reads a 25,000-line roughly 30 MB transcript from its tail', () => {
  const path = join(tmpDir('burhan-claude-transcript-large-'), 'large.jsonl');
  const padding = 'x'.repeat(1_200);
  for (let n = 0; n < 25_000; n++) appendFileSync(path, `${JSON.stringify({ n, padding })}\n`);
  const rows = readRecords(path);
  assert.equal(rows.length, 20_000);
  assert.deepEqual(rows[0], { n: 5_000, padding });
  assert.deepEqual(rows.at(-1), { n: 24_999, padding });
});

test('turnFromRecords matches every non-reentrant Stop golden after the splice fallback', () => {
  for (const c of golden.cases.filter((c) => c.transcript !== undefined && c.name.startsWith('stop + '))) {
    const actual = turnFromRecords(readRecords(new URL(c.transcript!, fixtures).pathname));
    const expected = JSON.parse(c.expected) as { turn: TurnFields; turn_id: string };
    const actualFields: TurnFields = {
      files_created: actual.files_created,
      files_edited: actual.files_edited,
      shell_commands: actual.shell_commands,
      skills_used: actual.skills_used,
      assistant_text: actual.assistant_text,
      steps: withoutAgents(actual.steps),
    };
    assert.deepEqual(actualFields, expected.turn, c.name);
    assert.equal(actual.turn_key, expected.turn_id, c.name);
  }
});

test('turnFromRecords classifies Bash results and excludes failed edits', () => {
  const records = [
    { type: 'user', uuid: 'turn', message: { content: 'go' } },
    { type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'ok', name: 'Bash', input: { command: 'ok' } },
      { type: 'tool_use', id: 'exit', name: 'Bash', input: { command: 'exit' } },
      { type: 'tool_use', id: 'blocked', name: 'Bash', input: { command: 'blocked' } },
      { type: 'tool_use', id: 'pending', name: 'Bash', input: { command: 'pending' } },
      { type: 'tool_use', id: 'background', name: 'Bash', input: { command: 'background', run_in_background: true } },
      { type: 'tool_use', id: 'bad-write', name: 'Write', input: { file_path: '/proj/failed-new.ts' } },
      { type: 'tool_use', id: 'bad-edit', name: 'Edit', input: { file_path: '/proj/failed.ts' } },
      { type: 'tool_use', id: 'update', name: 'Write', input: { file_path: '/proj/existing.ts' } },
    ] } },
    { type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'ok', is_error: false, content: 'done' },
      { type: 'tool_result', tool_use_id: 'exit', is_error: true, content: 'Error: Exit code 7' },
      { type: 'tool_result', tool_use_id: 'blocked', is_error: true, content: 'This command requires approval' },
      { type: 'tool_result', tool_use_id: 'bad-write', is_error: true, content: 'permission denied' },
      { type: 'tool_result', tool_use_id: 'bad-edit', is_error: true, content: 'no match' },
      { type: 'tool_result', tool_use_id: 'update', content: 'ok' },
    ] }, toolUseResult: { type: 'update' } },
  ];
  const turn = turnFromRecords(records);
  assert.deepEqual(turn.files_created, []);
  assert.deepEqual(turn.files_edited, ['/proj/existing.ts']);
  assert.deepEqual(turn.steps.map(({ _ts: _ignored, ...step }) => step), [
    { kind: 'cmd', cmd: 'ok', exit: 0, status: 'ok', seq: 1 },
    { kind: 'cmd', cmd: 'exit', exit: 7, status: 'failed', seq: 2 },
    { kind: 'cmd', cmd: 'blocked', exit: null, status: 'blocked', seq: 3 },
    { kind: 'cmd', cmd: 'pending', exit: null, status: 'unknown', seq: 4 },
    { kind: 'cmd', cmd: 'background', exit: null, status: 'background', seq: 5 },
    { kind: 'edit', file: '/proj/existing.ts', seq: 6 },
  ]);
});
