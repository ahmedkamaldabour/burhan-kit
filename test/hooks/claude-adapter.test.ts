import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { run } from '../../src/hooks/main.mjs';

type NormalizeGolden = { name: string; payload: string; transcript?: string; expected: string };
type EmitGolden = { event: string; input: string; expected: string };
type SubagentGolden = { name: string; dir: string; expected: string };

const fixtureDir = fileURLToPath(new URL('../../../tests/adapters/claude/fixtures/', import.meta.url));
const golden = <T,>(name: string): { cases: T[] } => JSON.parse(readFileSync(new URL(`../../../test/hooks/fixtures/${name}`, import.meta.url), 'utf8')) as { cases: T[] };
const payload = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(fixtureDir, name), 'utf8')) as Record<string, unknown>;

test('Claude normalize matches every reference golden byte for byte', async () => {
  for (const item of golden<NormalizeGolden>('claude-normalize-golden.json').cases) {
    const input = { ...payload(item.payload), transcript_path: item.transcript ? join(fixtureDir, item.transcript) : '/nonexistent' };
    const result = await run(['claude', 'normalize'], JSON.stringify(input), { CLAUDE_PROJECT_DIR: '/proj' });
    assert.equal(result.stdout, item.expected, item.name);
    assert.equal(result.debug, '', item.name);
  }
});

test('Claude normalize splices every reference subagent transcript', async () => {
  const root = fileURLToPath(new URL('../../../test/hooks/fixtures/claude-subagents/', import.meta.url));
  for (const item of golden<SubagentGolden>('claude-subagents/manifest.json').cases) {
    const input = { ...payload('p-stop.json'), transcript_path: join(root, item.dir, 'transcript.jsonl') };
    const result = await run(['claude', 'normalize'], JSON.stringify(input), { CLAUDE_PROJECT_DIR: '/proj' });
    assert.equal(result.stdout, item.expected, item.name);
    assert.equal(result.debug, '', item.name);
  }
});

test('Claude emit matches every reference golden byte for byte', async () => {
  for (const item of golden<EmitGolden>('claude-emit-golden.json').cases) {
    const result = await run(['claude', 'emit', item.event], item.input, {});
    assert.equal(result.stdout, item.expected, `${item.event}: ${item.input}`);
    assert.equal(result.debug, '', `${item.event}: ${item.input}`);
  }
});

test('Claude hook runs the core checks in the Claude output shape and fails open', async () => {
  const project = mkdtempSync(join(tmpdir(), 'burhan-claude-adapter-'));
  mkdirSync(join(project, '.burhan'));
  writeFileSync(join(project, '.burhan', 'workflow.config'), "WF_CODE_REGEX='\\.src$'\nWF_EVIDENCE_REGEX='^verify-it'\n");
  const invoke = (event: string, transcript: string, check: string) => run(
    ['claude', 'hook', check],
    JSON.stringify({ ...payload(event), cwd: project, transcript_path: join(fixtureDir, transcript) }),
    { CLAUDE_PROJECT_DIR: project },
  );

  assert.doesNotMatch((await invoke('p-stop.json', 'prior-turn-edit.jsonl', 'turn-audit')).stdout, /GATE/u);
  assert.doesNotMatch((await invoke('p-stop.json', 'tool-results.jsonl', 'turn-audit')).stdout, /VERIFICATION GATE/u);
  assert.doesNotMatch((await invoke('p-stop.json', 'single-turn.jsonl', 'turn-audit')).stdout, /VERIFICATION GATE/u);
  assert.match((await invoke('p-stop.json', 'nul-bytes.jsonl', 'turn-audit')).stdout, /VERIFICATION GATE/u);
  assert.doesNotMatch((await invoke('p-stop.json', 'garbage-lines.jsonl', 'turn-audit')).stdout, /GATE/u);
  assert.match((await invoke('p-session.json', 'single-turn.jsonl', 'session-gates')).stdout, /"hookEventName":"SessionStart"/u);
  assert.deepEqual(await run(['claude', 'hook', 'no-such-check'], JSON.stringify(payload('p-session.json')), { CLAUDE_PROJECT_DIR: project }), { stdout: '', debug: '' });
});

test('Claude adapter rejects unsupported and malformed inputs silently', async () => {
  const cases: [string[], string][] = [
    [['claude', 'normalize'], ''],
    [['claude', 'normalize'], 'nope'],
    [['claude', 'normalize'], '[]'],
    [['claude', 'normalize'], JSON.stringify({ hook_event_name: 'Nope' })],
    [['claude', 'normalize'], JSON.stringify({ hook_event_name: 'SubagentStop' })],
    [['claude', 'normalize'], JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read' })],
    [['claude', 'normalize'], JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash' })],
    [['claude', 'hook'], '{}'],
    [['claude', 'unknown'], '{}'],
  ];
  for (const [argv, stdin] of cases) {
    const result = await run(argv, stdin, {});
    assert.deepEqual(result, { stdout: '', debug: '' }, `${argv.join(' ')} <<< ${stdin}`);
  }
});
