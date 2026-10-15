import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Tests run from .test-build/test, so the repository root is two levels up.
const root = fileURLToPath(new URL('../../', import.meta.url));

/** The `eol` attribute git resolves for a path (via .gitattributes). */
function eolOf(path: string): string {
  const r = spawnSync('git', ['-C', root, 'check-attr', 'eol', '--', path], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split(': ').pop() ?? '';
}

// A Windows checkout converts to CRLF unless the repository says otherwise; the byte-exact goldens and
// the hook sources would then differ for a reason that has nothing to do with the code.
for (const path of [
  'test/hooks/fixtures/claude-subagents/async-last/transcript.jsonl',
  'test/hooks/fixtures/codex-golden.json',
  'src/hooks/main.mts',
  'kit/hooks/core/gates.txt',
  'package.json',
]) {
  test(`.gitattributes pins LF for ${path}`, () => {
    assert.equal(eolOf(path), 'lf');
  });
}
