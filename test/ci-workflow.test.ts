import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Tests run from .test-build/test, so the repository root is two levels up.
const workflow = readFileSync(fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url)), 'utf8');

/** The text of one top-level job (from `  <name>:` to the next job or the end). */
function job(name: string): string {
  const lines = workflow.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.notEqual(start, -1, `ci.yml has no "${name}" job`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^  [A-Za-z0-9_-]+:/.test(l));
  return rest.slice(0, end === -1 ? undefined : end).join('\n');
}

test('a Windows job runs the Node suite on windows-latest', () => {
  const w = job('windows');
  assert.match(w, /runs-on: windows-latest/);
  assert.match(w, /npm run test:node/);
});

test('the Windows job runs no-bash on Node 24 only (Node 22 and Git Bash are not run by CI)', () => {
  const w = job('windows');
  assert.match(w, /variant: no-bash, node: 24/);
  assert.doesNotMatch(w, /node: 22/);
  assert.doesNotMatch(w, /variant: git-bash,/, 'the git-bash variant is out of the matrix; its tripwire env line stays');
});

test('the no-bash variant removes bash and jq from PATH and arms the tripwire', () => {
  const w = job('windows');
  assert.match(w, /BURHAN_EXPECT_NO_BASH: \$\{\{ matrix\.variant == 'no-bash' && '1' \|\| '' \}\}/);
  assert.match(w, /if: matrix\.variant == 'no-bash'\n\s+shell: pwsh/);
  assert.match(w, /Test-Path -LiteralPath \(Join-Path \$d 'bash\.exe'\)/);
  assert.match(w, /Test-Path -LiteralPath \(Join-Path \$d 'jq\.exe'\)/);
  assert.match(w, /Out-File -FilePath \$env:GITHUB_ENV/);
});

test('the git-bash variant arms the mirrored tripwire', () => {
  assert.match(job('windows'), /BURHAN_EXPECT_BASH: \$\{\{ matrix\.variant == 'git-bash' && '1' \|\| '' \}\}/);
});

test('the Windows job never runs a shell script or the bash suites', () => {
  const w = job('windows');
  assert.doesNotMatch(w, /\.sh\b/);
  assert.doesNotMatch(w, /npm test\b|npm run lint|test:bash/);
});

test('the test job has no jq pinning since 0.3.0 (the hooks need no jq): Ubuntu 24.04 and macOS, both on Node 24', () => {
  const t = job('test');
  assert.doesNotMatch(t, /^\s+jq:/m, 'no jq matrix key');
  assert.doesNotMatch(t, /ubuntu-22\.04|matrix\.jq/, 'no jq-1.6 runner and no jq version check');
  assert.match(t, /os: \[ubuntu-24\.04, macos-latest\]\n\s+node: \[24\]/);
  for (const step of ['npm run lint', 'npm test', 'npm pack --dry-run']) assert.ok(t.includes(step), step);
});
