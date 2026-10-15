import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evidenceRuns, lastCodeEdit, lastRunPerCommand, parseSteps } from '../../src/hooks/core/steps.mjs';

/* Planned steps.mts API (direct port of turn-audit.sh's jq/awk stream):
 * parseSteps(raw: unknown[]): Step[]                 -> seq, kind, status (default "unknown"), exit, file, cmd, by;
 *                                                        tab/newline/CR values flatten to one space.
 * lastCodeEdit(steps, codeRe)                        -> the final matching edit, or null.
 * evidenceRuns(steps, evidenceRe)                    -> matching command runs; a SUBAGENT blocked/background/unknown run drops.
 * lastRunPerCommand(runs, afterSeq)                  -> final result per command after the edit, preserving first-command order.
 */

test('parseSteps flattens jq TSV fields and supplies the status default', () => {
  assert.deepEqual(parseSteps([{ seq: 2, kind: 'cmd', cmd: 'verify\tit\nnow', exit: '3\r', by: 'builder\n1' },
    { seq: 3, kind: 'edit', file: 'src\ta.ts' }]), [
    { seq: 2, kind: 'cmd', status: 'unknown', exit: '3 ', file: '', cmd: 'verify it now', by: 'builder 1' },
    { seq: 3, kind: 'edit', status: 'unknown', exit: '', file: 'src a.ts', cmd: '', by: '' },
  ]);
});

test('lastCodeEdit uses ordered edits, including a subagent edit', () => {
  const steps = parseSteps([{ seq: 1, kind: 'edit', file: 'src/old.ts' }, { seq: 3, kind: 'edit', file: 'notes.md' },
    { seq: 8, kind: 'edit', file: 'src/new.ts', by: 'builder' }]);
  assert.deepEqual(lastCodeEdit(steps, /\.ts$/), { seq: 8, kind: 'edit', status: 'unknown', exit: '', file: 'src/new.ts', cmd: '', by: 'builder' });
});

test('evidenceRuns keeps failures but drops result-less subagent runs', () => {
  const steps = parseSteps([{ seq: 1, kind: 'cmd', cmd: 'verify a', status: 'blocked', by: 'builder' },
    { seq: 2, kind: 'cmd', cmd: 'verify a', status: 'background', by: 'builder' },
    { seq: 3, kind: 'cmd', cmd: 'verify a', status: 'unknown', by: 'builder' },
    { seq: 4, kind: 'cmd', cmd: 'verify a', status: 'failed', exit: 2, by: 'builder' },
    { seq: 5, kind: 'cmd', cmd: 'verify b', status: 'blocked' }]);
  assert.deepEqual(evidenceRuns(steps, /^verify/).map((step) => [step.seq, step.status]), [[4, 'failed'], [5, 'blocked']]);
});

test('lastRunPerCommand lets only a later result of the same command supersede it', () => {
  const runs = parseSteps([{ seq: 2, kind: 'cmd', cmd: 'verify a', status: 'failed', exit: 1 },
    { seq: 3, kind: 'cmd', cmd: 'verify b', status: 'ok', exit: 0 }, { seq: 4, kind: 'cmd', cmd: 'verify a', status: 'ok', exit: 0 },
    { seq: 5, kind: 'cmd', cmd: 'verify c', status: 'background' }]);
  assert.deepEqual(lastRunPerCommand(runs, 1).map((step) => [step.cmd, step.status, step.exit]), [
    ['verify a', 'ok', '0'], ['verify b', 'ok', '0'], ['verify c', 'background', ''],
  ]);
});
