import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Tests run from .test-build/test, so the repository root is two levels up.
const file = fileURLToPath(new URL('../../.github/dependabot.yml', import.meta.url));

test('Dependabot watches only the GitHub Actions of the repository: monthly, one grouped PR, 7 days after a release', () => {
  assert.ok(existsSync(file), '.github/dependabot.yml is missing');
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'));
  assert.deepEqual(lines, [
    'version: 2',
    'updates:',
    '  - package-ecosystem: github-actions',
    '    directory: /',
    '    schedule:',
    '      interval: monthly',
    '    cooldown:',
    '      default-days: 7',
    '    groups:',
    '      actions:',
    '        patterns:',
    "          - '*'",
  ]);
});
