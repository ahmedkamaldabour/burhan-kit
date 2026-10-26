import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commandsOf, evidenceMatches } from '../../src/hooks/core/evidence-cmd.mjs';
import { run } from '../../src/hooks/main.mjs';
import { evidenceRuns, parseSteps } from '../../src/hooks/core/steps.mjs';
import { tmpDir } from '../helpers.js';

const EVIDENCE = /npm test|npm run lint|npx tsc --noEmit|npx jest [^ ]+|pytest [^ ]+|bash tests\//;

const COUNTS = [
  'npm test',
  'cd x && npm test',
  'npm test | tail -5',
  'npm run lint; echo done',
  'FOO=1 npx jest a.test.ts',
  'npx tsc --noEmit',
  'docker exec app npm test',
  'bash -c "npm test"',
  "sh -lc 'cd x && npm test'",
  'sudo npm test',
  'echo start\nnpm test',
  'npx jest "a b"',
  '/usr/bin/npm test',
  'npm test 2>&1 | tee out.log',
  'bash tests/docs.test.sh',
  'npm run \\\n  lint',
  'npm \\\ntest',
  'npm \\\r\ntest',
  'bash tests/a.test.sh -c conf',
];
const MENTIONS = [
  'echo "npm test"',
  'echo npm test',
  'grep -n "npm test" README.md',
  'grep -rn npm test docs',
  'grep -c "npm test" f',
  '# npm test',
  "printf 'npm test'",
  'cat <<EOF\nnpm test\nEOF',
  "cat <<'END-DOC' > notes.md\nnpm run lint\nEND-DOC",
  'git commit -m "ran npm test"',
  'echo done # npm test',
  'bash -c "echo npm test"',
];

for (const cmd of COUNTS) test(`counts as evidence: ${JSON.stringify(cmd)}`, () => assert.equal(evidenceMatches(EVIDENCE, cmd), true));
for (const cmd of MENTIONS) test(`only a mention: ${JSON.stringify(cmd)}`, () => assert.equal(evidenceMatches(EVIDENCE, cmd), false));

test('a heredoc keeps the command that opens it and drops its body', () => {
  assert.equal(evidenceMatches(EVIDENCE, 'npm test <<EOF\nnpm run lint\nEOF'), true);
  assert.deepEqual(commandsOf('cat <<EOF\nnpm test\nEOF\nnpm run lint'), ['npm run lint']);
});

test('quoted text becomes Q so a pattern that wants an argument still matches', () => {
  assert.deepEqual(commandsOf('npx jest "a b"'), ['npx jest Q']);
});

test('an unbalanced quote does not throw and falls back to the whole text', () => {
  assert.equal(evidenceMatches(EVIDENCE, 'npm test "unclosed'), true);
});

test('evidenceRuns no longer counts an echoed command', () => {
  const steps = parseSteps([
    { seq: 1, kind: 'cmd', cmd: 'echo "npm test"', status: 'ok', exit: '0' },
    { seq: 2, kind: 'cmd', cmd: 'npm test', status: 'ok', exit: '0' },
  ]);
  assert.deepEqual(evidenceRuns(steps, EVIDENCE).map((run) => run.cmd), ['npm test']);
});

// Gate A end to end: an echoed command is no verification, a real run is.
const NONE = /no verification command ran this turn/u;
const turnEnd = async (commands: string[], steps: Record<string, unknown>[]): Promise<string> => {
  const project = tmpDir('burhan-evidence-cmd-');
  const env = { ...process.env, CLAUDE_PROJECT_DIR: project, WF_CODE_REGEX: '\\.src$', WF_EVIDENCE_REGEX: 'npm test', WF_EVIDENCE_LEDGER: 'off' };
  return (await run(['core', 'turn-audit'], JSON.stringify({ event: 'turn_end', agent: 'claude', session: 'S', project_dir: project, turn: { skills_used: [], assistant_text: 'All done.', files_created: [], files_edited: ['a.src'], shell_commands: commands, steps } }), env)).stdout;
};
const edit = { seq: 1, kind: 'edit', file: 'a.src' };
test('gate A: a turn whose only "test run" is an echo warns that no verification ran', async () => {
  assert.match(await turnEnd(['echo "npm test"'], [edit, { seq: 2, kind: 'cmd', cmd: 'echo "npm test"', status: 'ok', exit: '0' }]), NONE);
});
test('gate A, no steps: an echo is no verification, a real run is', async () => {
  assert.match(await turnEnd(['echo "npm test"'], []), NONE);
  assert.doesNotMatch(await turnEnd(['npm test'], []), NONE);
});
test('gate A: a real run after the edit passes', async () => {
  assert.doesNotMatch(await turnEnd(['npm test'], [edit, { seq: 2, kind: 'cmd', cmd: 'npm test', status: 'ok', exit: '0' }]), /VERIFICATION GATE/u);
});

// Unknown is not a pass (Q-2 = A): a verification run with no recorded result does not prove the claim.
const cmdStep = (seq: number, cmd: string, status: string): Record<string, unknown> => ({ seq, kind: 'cmd', cmd, status, exit: status === 'ok' ? '0' : '' });
const UNKNOWN = /the result of `npm test` is unknown/u;
test('gate A: the only evidence run has no recorded result → a result-unknown warning', async () => {
  assert.match(await turnEnd(['npm test'], [edit, cmdStep(2, 'npm test', 'unknown')]), UNKNOWN);
});
test('gate A: one evidence command passed, another has no result → no warning (something proved it)', async () => {
  assert.doesNotMatch(await turnEnd(['npm test', 'npm test --silent'], [edit, cmdStep(2, 'npm test', 'unknown'), cmdStep(3, 'npm test --silent', 'ok')]), /VERIFICATION GATE/u);
});
test('gate A: a failed run keeps its own warning, not the unknown one', async () => {
  const out = await turnEnd(['npm test'], [edit, cmdStep(2, 'npm test', 'failed')]);
  assert.match(out, /failed/u);
  assert.doesNotMatch(out, /is unknown/u);
});
