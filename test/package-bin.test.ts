import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Tests run from .test-build/test, so the repository root is two levels up.
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'));

// `npx burhan-kit` looks for a bin named like the package; on Windows npm 10 then fails with
// "could not determine executable to run" when the only bin is `burhan`. Both names must exist.
test('the package exposes the CLI as both burhan and burhan-kit', () => {
  assert.equal(manifest.bin?.burhan, 'dist/cli.js');
  assert.equal(manifest.bin?.['burhan-kit'], 'dist/cli.js');
});
