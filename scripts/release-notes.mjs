// Prints the GitHub Release body of a version: its CHANGELOG.md section and the install line (release-rules.mjs).
//   node scripts/release-notes.mjs --version X.Y.Z[-<prerelease>]
// Reads package.json and CHANGELOG.md in the current folder. A missing or empty section prints
// `release-notes: refused: <reason>` and exits 1.
import { readFileSync } from 'node:fs';
import { releaseNotes } from './release-rules.mjs';

const argv = process.argv.slice(2);
const at = argv.indexOf('--version');
const version = at >= 0 ? argv[at + 1] : undefined;
if (!version || version.startsWith('-')) {
  console.error('usage: release-notes --version X.Y.Z');
  process.exit(1);
}

const { name } = JSON.parse(readFileSync('package.json', 'utf8'));
const { notes, problem } = releaseNotes(readFileSync('CHANGELOG.md', 'utf8'), name, version);
if (problem) {
  console.error(`release-notes: refused: ${problem}`);
  process.exit(1);
}
process.stdout.write(notes);
