import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers.js';
import { run } from '../../src/hooks/main.mjs';

// Edge cases of the Claude adapter: payloads and transcripts at the odd corners of jq's `//`, `-r` and `$(…)`
// semantics. `expected` is the exact stdout of the real bash adapter (kit/hooks/adapters/claude), generated once.
interface EdgeCase { name: string; sub: 'normalize' | 'emit'; arg: string | null; stdin: string; transcript: string[] | null; expected: string }
const golden = JSON.parse(readFileSync(new URL('../../../test/hooks/fixtures/claude-edge-golden.json', import.meta.url), 'utf8')) as { cases: EdgeCase[] };

test('Claude adapter: edge cases equal the bash adapter byte for byte', async () => {
  const failures: string[] = [];
  for (const c of golden.cases) {
    const dir = tmpDir('burhan-claude-edge-');
    let stdin = c.stdin.replaceAll('@DIR', dir);
    if (c.transcript !== null) {
      const path = join(dir, 't.jsonl');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, c.transcript.join('\n') + '\n');
      if (c.sub === 'normalize' && !stdin.includes('"transcript_path"')) stdin = JSON.stringify({ ...JSON.parse(stdin), transcript_path: path });
    }
    const env = c.arg === 'noenv' ? {} : { CLAUDE_PROJECT_DIR: '/proj' };
    const argv = c.sub === 'normalize' ? ['claude', 'normalize'] : ['claude', 'emit', c.arg ?? ''];
    const actual = (await run(argv, stdin, env)).stdout.replaceAll(dir, '@DIR');
    if (actual !== c.expected) failures.push(`${c.name}\n   bash: ${JSON.stringify(c.expected).slice(0, 240)}\n   node: ${JSON.stringify(actual).slice(0, 240)}`);
  }
  assert.deepEqual(failures, [], `${failures.length} of ${golden.cases.length} edge cases differ:\n${failures.join('\n')}`);
});

test('Claude adapter: a FIFO as transcript_path is skipped like `[ -f ]` does, not opened (opening would block)', { skip: process.platform === 'win32' }, async () => {
  const dir = tmpDir('burhan-claude-fifo-');
  const fifo = join(dir, 'pipe.jsonl');
  execFileSync('mkfifo', [fifo]);
  const started = Date.now();
  const out = (await run(['claude', 'normalize'], JSON.stringify({ hook_event_name: 'Stop', session_id: 's', transcript_path: fifo }), { CLAUDE_PROJECT_DIR: '/proj' })).stdout;
  assert.ok(Date.now() - started < 2000, 'did not block');
  assert.equal(JSON.parse(out).turn.files_edited.length, 0);
});
