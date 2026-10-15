import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { nodeDriver } from './drivers.js';
import { fixtureDir, payload, runCorpus } from './corpora/claude-adapter.js';

test('Claude adapter corpus matches every reference golden', () => runCorpus(nodeDriver));

test('Claude hook runs the core checks in the Claude output shape and fails open', async () => {
  const project = mkdtempSync(join(tmpdir(), 'burhan-claude-adapter-'));
  mkdirSync(join(project, '.burhan'));
  writeFileSync(join(project, '.burhan', 'workflow.config'), "WF_CODE_REGEX='\\.src$'\nWF_EVIDENCE_REGEX='^verify-it'\n");
  const invoke = (event: string, transcript: string, check: string) => nodeDriver(
    ['claude', 'hook', check],
    JSON.stringify({ ...payload(event), cwd: project, transcript_path: join(fixtureDir, transcript) }),
    { CLAUDE_PROJECT_DIR: project },
  );

  assert.doesNotMatch(await invoke('p-stop.json', 'prior-turn-edit.jsonl', 'turn-audit'), /GATE/u);
  assert.doesNotMatch(await invoke('p-stop.json', 'tool-results.jsonl', 'turn-audit'), /VERIFICATION GATE/u);
  assert.doesNotMatch(await invoke('p-stop.json', 'single-turn.jsonl', 'turn-audit'), /VERIFICATION GATE/u);
  assert.match(await invoke('p-stop.json', 'nul-bytes.jsonl', 'turn-audit'), /VERIFICATION GATE/u);
  assert.doesNotMatch(await invoke('p-stop.json', 'garbage-lines.jsonl', 'turn-audit'), /GATE/u);
  assert.match(await invoke('p-session.json', 'single-turn.jsonl', 'session-gates'), /"hookEventName":"SessionStart"/u);
  assert.equal(await nodeDriver(['claude', 'hook', 'no-such-check'], JSON.stringify(payload('p-session.json')), { CLAUDE_PROJECT_DIR: project }), '');
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
    assert.equal(await nodeDriver(argv, stdin, {}), '', `node: ${argv.join(' ')} <<< ${stdin}`);
  }
});
