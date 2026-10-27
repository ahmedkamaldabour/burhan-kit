import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Tests run from .test-build/test, so the repository root is two levels up.
const read = (name: string): string => readFileSync(fileURLToPath(new URL(`../../.github/workflows/${name}`, import.meta.url)), 'utf8');
const release = read('release.yml');
const ci = read('ci.yml');

/** The text of one top-level job of the release workflow (from `  <name>:` to the next job or the end). */
function job(name: string): string {
  const lines = release.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.notEqual(start, -1, `release.yml has no "${name}" job`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^  [A-Za-z0-9_-]+:/.test(l));
  return rest.slice(0, end === -1 ? undefined : end).join('\n');
}

test('the release runs on a pushed v* tag and on nothing else', () => {
  const on = release.slice(release.indexOf('\non:'), release.indexOf('\npermissions:'));
  assert.match(on, /push:\n\s+tags: \['v\*'\]/);
  assert.doesNotMatch(on, /branches|pull_request|workflow_dispatch|schedule/);
});

test('the default token can only read', () => {
  assert.match(release, /\npermissions:\n  contents: read\n/);
});

test('id-token: write is given to the publish job alone', () => {
  assert.equal(release.split('id-token: write').length - 1, 1);
  assert.match(job('publish'), /id-token: write/);
});

test('the jobs run in order: guard, verify, pack, publish', () => {
  assert.doesNotMatch(job('guard'), /needs:/);
  assert.match(job('verify'), /needs: guard\b/);
  assert.match(job('pack'), /needs: verify\b/);
  assert.match(job('publish'), /needs: pack\b/);
});

test('guard checks out full history and hands the tag to release-guard through env', () => {
  const g = job('guard');
  assert.match(g, /fetch-depth: 0/);
  assert.match(g, /TAG: \$\{\{ github\.ref_name \}\}/);
  assert.match(g, /node scripts\/release-guard\.mjs --tag "\$TAG"/);
});

test('github.ref_name is only ever read into an env value, never inside a command', () => {
  for (const line of release.split('\n').filter((l) => l.includes('github.ref_name'))) assert.match(line, /^\s+TAG: \$\{\{ github\.ref_name \}\}$/);
});

test('verify runs lint and the tests on Node 22 and 24', () => {
  const v = job('verify');
  assert.match(v, /node: \[22, 24\]/);
  assert.match(v, /run: npm run lint/);
  assert.match(v, /run: npm test/);
});

test('pack runs pack-smoke and uploads the tarball it leaves', () => {
  const p = job('pack');
  assert.match(p, /node scripts\/pack-smoke\.mjs --out pack/);
  assert.match(p, /upload-artifact@/);
  assert.match(p, /path: pack\/package\.tgz/);
});

test('the job that builds the published file uses no restored cache', () => {
  assert.doesNotMatch(job('pack'), /cache:/);
});

test('publish waits for the npm-release environment and publishes the packed tarball with provenance', () => {
  const p = job('publish');
  assert.match(p, /environment: npm-release/);
  assert.match(p, /download-artifact@/);
  assert.match(p, /registry-url: https:\/\/registry\.npmjs\.org/);
  assert.match(p, /npm publish \.\/pack\/package\.tgz --provenance --access public/);
});

test('no stored secret and no shell script in the release workflow', () => {
  assert.doesNotMatch(release, /NPM_TOKEN|NODE_AUTH_TOKEN|secrets\./);
  assert.doesNotMatch(release, /\.sh\b/);
});

test('every action in both workflows is pinned to a 40-hex commit, with its tag in a comment', () => {
  for (const [name, text] of [['release.yml', release], ['ci.yml', ci]] as const) {
    const uses = text.split('\n').filter((l) => /\buses:/.test(l));
    assert.ok(uses.length > 0, `${name} has no uses: lines`);
    for (const line of uses) assert.match(line, /uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+(\.\d+){0,2}$/, `${name}: ${line.trim()}`);
  }
});
