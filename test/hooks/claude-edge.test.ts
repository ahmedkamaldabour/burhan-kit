import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { notOnWindows, tmpDir } from '../helpers.js';
import { nodeDriver } from './drivers.js';
import { runCorpus } from './corpora/claude-edge.js';

test('Claude adapter: edge cases equal the bash adapter byte for byte', () => runCorpus(nodeDriver));

test('Claude adapter: a FIFO as transcript_path is skipped like `[ -f ]` does, not opened (opening would block)', { skip: notOnWindows('mkfifo: Windows has no FIFOs') }, async () => {
  const dir = tmpDir('burhan-claude-fifo-');
  const fifo = join(dir, 'pipe.jsonl');
  execFileSync('mkfifo', [fifo]);
  const started = Date.now();
  const out = await nodeDriver(['claude', 'normalize'], JSON.stringify({ hook_event_name: 'Stop', session_id: 's', transcript_path: fifo }), { CLAUDE_PROJECT_DIR: '/proj' });
  assert.ok(Date.now() - started < 2000, 'did not block');
  assert.equal(JSON.parse(out).turn.files_edited.length, 0);
});
