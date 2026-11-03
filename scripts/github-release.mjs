// Writes the GitHub Release of a version tag, run by the release workflow after npm has the version.
//   node scripts/github-release.mjs --tag vX.Y.Z[-<prerelease>]
// Title `<package name> <version>`; body = release-notes (the CHANGELOG section and the install line); published at once;
// marked prerelease for a prerelease version, so it never becomes the Latest Release. Uses gh, which takes GH_TOKEN and
// GH_REPO from the environment. A Release that already exists for the tag is left as it is, and that is a failure.
// Any refusal prints `github-release: refused: <reason>` and exits 1.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { distTagFor, releaseNotes } from './release-rules.mjs';

const argv = process.argv.slice(2);
const at = argv.indexOf('--tag');
const tag = at >= 0 ? argv[at + 1] : undefined;
if (!tag || tag.startsWith('-')) {
  console.error('usage: github-release --tag vX.Y.Z');
  process.exit(1);
}

const refuse = (reason) => {
  console.error(`github-release: refused: ${reason}`);
  process.exit(1);
};
const firstLine = (r) => (r.stderr || r.error?.message || 'no answer').trim().split('\n')[0];
const gh = (args) => spawnSync('gh', args, { encoding: 'utf8' });

const version = tag.startsWith('v') ? tag.slice(1) : '';
const distTag = distTagFor(version);
if (!distTag) refuse(`the tag ${tag} is not v + X.Y.Z or X.Y.Z-<prerelease>`);

const { name } = JSON.parse(readFileSync('package.json', 'utf8'));
const { notes, problem } = releaseNotes(readFileSync('CHANGELOG.md', 'utf8'), name, version);
if (problem) refuse(problem);

const seen = gh(['release', 'view', tag, '--json', 'tagName']);
if (seen.status === 0) refuse(`a GitHub Release for ${tag} already exists; it was left as it is`);
if (!/release not found/.test(seen.stderr ?? '')) refuse(`cannot tell whether a GitHub Release for ${tag} exists (gh release view: ${firstLine(seen)})`);

const work = mkdtempSync(join(tmpdir(), 'burhan-release-notes-'));
let made;
try {
  const file = join(work, 'notes.md');
  writeFileSync(file, notes);
  const args = ['release', 'create', tag, '--verify-tag', '--title', `${name} ${version}`, '--notes-file', file];
  if (distTag === 'next') args.push('--prerelease');
  made = gh(args);
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (made.status !== 0) refuse(`gh release create exited ${made.status}: ${firstLine(made)}`);
console.log(`github-release: ok ${name} ${version}${distTag === 'next' ? ' (prerelease)' : ''}`);
