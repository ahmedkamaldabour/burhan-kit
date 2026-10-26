import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rolloutExits } from '../../src/hooks/adapters/codex/rollout.mjs';
import { tmpDir } from '../helpers.js';

// Contract with Codex's session record (item evidence-honesty, AC-04): a finished command is a CommandExecution item whose `id` is the hook's
// tool_use_id and whose `exit_code` is the result. The item below has the keys seen in real recordings (2168 of 2168 items carried an exit code).
const item = (id: string, exit: number | null, status: string): string => JSON.stringify({ timestamp: 't', ordinal: 1, type: 'event_msg', payload: { type: 'item_completed', turn_id: 'U', item: {
  type: 'CommandExecution', id, process_id: '1', command: ['/usr/bin/zsh', '-lc', 'npm test'], cwd: 'file:///proj', parsed_cmd: [], source: 'unified_exec_startup', status, stdout: '', stderr: '', aggregated_output: '', exit_code: exit, duration: { secs: 0, nanos: 1 }, formatted_output: '' } } });

test('a recorded command item gives its exit code and status, matched by id', () => {
  const dir = tmpDir('burhan-codex-results-');
  const file = join(dir, 'rollout.jsonl');
  writeFileSync(file, [item('exec-ok', 0, 'completed'), item('exec-bad', 3, 'failed'), item('exec-none', null, 'completed')].join('\n') + '\n');
  const exits = rolloutExits(file);
  assert.deepEqual(exits.get('exec-ok'), { exit: 0, status: 'completed' });
  assert.deepEqual(exits.get('exec-bad'), { exit: 3, status: 'failed' });
  assert.deepEqual(exits.get('exec-none'), { exit: null, status: 'completed' });
  assert.equal(exits.get('exec-missing'), undefined);
});
