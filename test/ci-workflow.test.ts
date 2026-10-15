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

test('the Windows job covers no-bash on Node 22 and 24 and Git Bash on Node 24', () => {
  const w = job('windows');
  assert.match(w, /variant: no-bash, node: 22/);
  assert.match(w, /variant: no-bash, node: 24/);
  assert.match(w, /variant: git-bash, node: 24/);
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
