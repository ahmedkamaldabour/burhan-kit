import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Tests run from .test-build/test, so the sources are two levels up, in test/.
const root = fileURLToPath(new URL('../../test', import.meta.url));
const sources = readdirSync(root, { recursive: true, encoding: 'utf8' })
  .filter((name) => name.endsWith('.ts') && !name.endsWith('windows-portable.test.ts'))
  .map((name) => ({ name, text: readFileSync(join(root, name), 'utf8') }));

// cmd.exe has no `true`: a test project whose check command is `true` fails its pre-commit gate on Windows. Use `node -v`.
test('no test sets a check command that only a POSIX shell has', () => {
  assert.ok(sources.length > 20, `expected the test sources under ${root}, found ${sources.length}`);
  const offenders = sources.filter(({ text }) => /WF_CHECK_CMD=['"]?true\b/u.test(text)).map(({ name }) => name);
  assert.deepEqual(offenders, [], 'use WF_CHECK_CMD=\'node -v\' (works in cmd.exe and in sh)');
});
