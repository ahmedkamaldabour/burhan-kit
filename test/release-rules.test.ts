import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Tests run from .test-build/test, so the repository root is two levels up.
type Rules = {
  distTagFor: (version: unknown) => 'latest' | 'next' | null;
  changelogSection: (text: string, version: string) => string | null;
  releaseNotes: (text: string, name: string, version: string) => { notes?: string; problem?: string };
};
const rules = (await import(new URL('../../scripts/release-rules.mjs', import.meta.url).href)) as Rules;

test('a prerelease version gets the dist-tag next', () => {
  for (const version of ['1.0.0-rc.1', '1.0.0-beta', '0.8.0-0', '1.0.0-alpha.beta.1', '2.0.0-x-y.7']) {
    assert.equal(rules.distTagFor(version), 'next', version);
  }
});

test('a plain X.Y.Z version gets the dist-tag latest, 0.x included', () => {
  for (const version of ['1.0.0', '0.8.0', '0.7.1', '10.20.30']) assert.equal(rules.distTagFor(version), 'latest', version);
});

test('any other version is refused: build metadata, a leading v, too few or too many numbers, leading zeros', () => {
  const refused = ['1.0.0+abc', '1.0.0-rc.1+abc', 'v1.0.0', '1.0', '1', '1.0.0.0', '01.0.0', '1.00.0', '1.0.01', '1.0.0-01',
    '1.0.0-', '1.0.0-rc..1', '', ' 1.0.0', '1.0.0 ', 'latest', undefined, null, 100];
  for (const version of refused) assert.equal(rules.distTagFor(version), null, String(version));
});

const changelog = [
  '# Changelog',
  '',
  '## 0.7.10 — 2026-11-01',
  '',
  'ten',
  '',
  '## 0.7.1-rc.1 — 2026-10-30',
  '',
  'rc',
  '',
  '## 0.7.1 — 2026-10-29',
  '',
  '### Fixed',
  '',
  '- one',
  '',
  '',
  '## 0.7.0',
  '',
  'old',
  '',
  '## 0.6.0 — 2026-10-01',
  '',
  '## 0.5.0 — soon',
  '',
  'not a date',
  '',
  '## 0.4.0 — 2026-09-01',
  '',
  'four',
  '',
].join('\n');

test('a section runs from its heading to the next ## heading, trimmed, with its ### subsections', () => {
  assert.equal(rules.changelogSection(changelog, '0.7.1'), '### Fixed\n\n- one');
  assert.equal(rules.changelogSection(changelog, '0.4.0'), 'four');
});

test('a heading matches its version exactly: 0.7.1 is neither 0.7.10 nor 0.7.1-rc.1', () => {
  assert.equal(rules.changelogSection(changelog, '0.7.10'), 'ten');
  assert.equal(rules.changelogSection(changelog, '0.7.1-rc.1'), 'rc');
  assert.equal(rules.changelogSection(changelog, '0.7'), null);
});

test('a heading without a date counts; a heading whose suffix is not " — YYYY-MM-DD" does not', () => {
  assert.equal(rules.changelogSection(changelog, '0.7.0'), 'old');
  assert.equal(rules.changelogSection(changelog, '0.5.0'), null);
});

test('a heading whose date is not a real calendar date does not count; a real date does, a leap day included', () => {
  for (const date of ['2026-13-99', '2026-13-01', '2026-00-10', '2026-11-00', '2026-04-31', '2026-02-29', '2026-02-30', '1900-02-29']) {
    assert.equal(rules.changelogSection(`## 1.0.0 — ${date}\n\nnotes\n`, '1.0.0'), null, date);
  }
  for (const date of ['2028-02-29', '2000-02-29', '2026-12-31', '2026-01-01']) {
    assert.equal(rules.changelogSection(`## 1.0.0 — ${date}\n\nnotes\n`, '1.0.0'), 'notes', date);
  }
});

test('every heading of this repository\'s CHANGELOG.md is read as its version\'s section, and none is empty', () => {
  const text = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
  const versions = text.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3).split(' ')[0]!);
  assert.ok(versions.length >= 11, String(versions.length));
  for (const version of versions) assert.ok(rules.changelogSection(text, version), version);
});

test('an empty section is the empty string, a missing one is null', () => {
  assert.equal(rules.changelogSection(changelog, '0.6.0'), '');
  assert.equal(rules.changelogSection(changelog, '0.3.0'), null);
});

test('CRLF line endings read the same as LF', () => {
  assert.equal(rules.changelogSection(changelog.replace(/\n/g, '\r\n'), '0.7.1'), '### Fixed\n\n- one');
});

test('the notes of a plain version are the section, a blank line and the install line', () => {
  assert.deepEqual(rules.releaseNotes(changelog, 'demo-pkg', '0.7.1'), {
    notes: '### Fixed\n\n- one\n\nInstall or upgrade: `npx demo-pkg@0.7.1 upgrade --apply` in a project that already has burhan, or `npx demo-pkg` for a new one.\n',
  });
});

test('the install line of a prerelease names the exact version for a new project too, and says latest is unchanged', () => {
  const { notes } = rules.releaseNotes(changelog, 'demo-pkg', '0.7.1-rc.1');
  assert.equal(notes, 'rc\n\nInstall or upgrade: `npx demo-pkg@0.7.1-rc.1 upgrade --apply` in a project that already has burhan, or `npx demo-pkg@0.7.1-rc.1` for a new one. This is a prerelease on the npm dist-tag `next`: `npx demo-pkg` still installs the latest stable version.\n');
  assert.doesNotMatch(notes!, /@latest/);
});

test('a missing or empty section gives a problem that names the version, and no notes', () => {
  assert.deepEqual(rules.releaseNotes(changelog, 'demo-pkg', '0.3.0'), { problem: 'CHANGELOG.md has no section for 0.3.0' });
  assert.deepEqual(rules.releaseNotes(changelog, 'demo-pkg', '0.6.0'), { problem: 'the CHANGELOG.md section for 0.6.0 is empty' });
});
