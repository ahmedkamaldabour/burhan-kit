import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { notOnWindows, tmpDir } from './helpers.js';

// Tests run from .test-build/test, so the repository root is two levels up.
const root = fileURLToPath(new URL('../../', import.meta.url));
const notesScript = fileURLToPath(new URL('../../scripts/release-notes.mjs', import.meta.url));
const releaseScript = fileURLToPath(new URL('../../scripts/github-release.mjs', import.meta.url));
const skip = notOnWindows('the fake gh is a PATH shim without a .cmd twin');

/** A folder with a package.json named demo-pkg and a CHANGELOG.md holding `sections`. */
function project(sections: string): string {
  const dir = tmpDir('burhan-gh-release-');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo-pkg', version: '0.0.0' }));
  writeFileSync(join(dir, 'CHANGELOG.md'), `# Changelog\n\n${sections}`);
  return dir;
}

const sections = '## 1.3.0-rc.1 — 2026-11-02\n\n- the candidate\n\n## 1.2.3 — 2026-11-01\n\n### Fixed\n\n- one thing\n\n## 1.2.2 — 2026-10-01\n\n## 1.2.1 — 2026-09-01\n\n- old\n';

/**
 * A folder holding a `gh` that logs every call (its arguments, and the text of a --notes-file) as one JSON line to
 * `log`, and answers `release view` the way GitHub does: `missing` (release not found), `exists`, or `down`.
 * `release create` exits 0, or 1 when `createFails`.
 */
function fakeGh(view: 'missing' | 'exists' | 'down', createFails = false): { bin: string; log: string } {
  const bin = tmpDir('burhan-fake-gh-');
  const log = join(bin, 'calls.jsonl');
  const file = join(bin, 'gh');
  writeFileSync(file, `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs');
const args = process.argv.slice(2);
const at = args.indexOf('--notes-file');
const notes = at >= 0 ? readFileSync(args[at + 1], 'utf8') : null;
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, notes }) + '\\n');
if (args[0] === 'release' && args[1] === 'view') {
  const view = ${JSON.stringify(view)};
  if (view === 'exists') { console.log('{"tagName":"' + args[2] + '"}'); process.exit(0); }
  if (view === 'missing') { console.error('release not found'); process.exit(1); }
  console.error('HTTP 502: Bad Gateway'); process.exit(1);
}
if (args[0] === 'release' && args[1] === 'create') process.exit(${createFails ? 1 : 0});
process.exit(3);
`);
  chmodSync(file, 0o755);
  // The fake is CommonJS: a package.json without "type" next to it keeps it so.
  writeFileSync(join(bin, 'package.json'), '{}');
  return { bin, log };
}

const calls = (log: string): { args: string[]; notes: string | null }[] =>
  existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { args: string[]; notes: string | null }) : [];

function release(cwd: string, tag: string | null, gh: { bin: string }): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [releaseScript, ...(tag === null ? [] : ['--tag', tag])], {
    cwd, encoding: 'utf8', env: { ...process.env, PATH: gh.bin + delimiter + process.env.PATH },
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

test('release-notes prints the section of this repository\'s 0.7.1 and the install line', () => {
  const r = spawnSync(process.execPath, [notesScript, '--version', '0.7.1'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const lines = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').split('\n');
  const line5 = lines[lines.indexOf('## 0.7.1 — 2026-10-29') + 2];
  assert.equal(r.stdout, `${line5}\n\nInstall or upgrade: \`npx burhan-kit@0.7.1 upgrade --apply\` in a project that already has burhan, or \`npx burhan-kit\` for a new one.\n`);
});

test('release-notes exits 1 with a reason for a missing or an empty section', () => {
  const dir = project(sections);
  const missing = spawnSync(process.execPath, [notesScript, '--version', '9.9.9'], { cwd: dir, encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /release-notes: refused: CHANGELOG\.md has no section for 9\.9\.9/);
  const empty = spawnSync(process.execPath, [notesScript, '--version', '1.2.2'], { cwd: dir, encoding: 'utf8' });
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /release-notes: refused: the CHANGELOG\.md section for 1\.2\.2 is empty/);
});

test('release-notes without --version is a usage error', () => {
  const r = spawnSync(process.execPath, [notesScript], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage: release-notes --version X\.Y\.Z/);
});

test('a plain version: one published Release, titled with the package name and version, body from the CHANGELOG', { skip }, () => {
  const gh = fakeGh('missing');
  const r = release(project(sections), 'v1.2.3', gh);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /github-release: ok demo-pkg 1\.2\.3/);
  const made = calls(gh.log).filter((c) => c.args[1] === 'create');
  assert.equal(made.length, 1);
  const args = made[0]!.args;
  assert.deepEqual(args.slice(0, 7), ['release', 'create', 'v1.2.3', '--verify-tag', '--title', 'demo-pkg 1.2.3', '--notes-file']);
  assert.equal(args.length, 8, 'no --prerelease and no --draft');
  assert.equal(made[0]!.notes, '### Fixed\n\n- one thing\n\nInstall or upgrade: `npx demo-pkg@1.2.3 upgrade --apply` in a project that already has burhan, or `npx demo-pkg` for a new one.\n');
});

test('a prerelease version is marked prerelease, so it is never the Latest Release', { skip }, () => {
  const gh = fakeGh('missing');
  const r = release(project(sections), 'v1.3.0-rc.1', gh);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /github-release: ok demo-pkg 1\.3\.0-rc\.1 \(prerelease\)/);
  const made = calls(gh.log).filter((c) => c.args[1] === 'create');
  assert.equal(made.length, 1);
  assert.equal(made[0]!.args.at(-1), '--prerelease');
  assert.match(made[0]!.notes!, /`npx demo-pkg@1\.3\.0-rc\.1` for a new one/);
});

test('a Release that already exists is left as it is, and the job fails', { skip }, () => {
  const gh = fakeGh('exists');
  const r = release(project(sections), 'v1.2.3', gh);
  assert.equal(r.status, 1);
  assert.match(r.out, /github-release: refused: a GitHub Release for v1\.2\.3 already exists; it was left as it is/);
  assert.deepEqual(calls(gh.log).map((c) => c.args[1]), ['view']);
});

test('a gh that cannot tell whether the Release exists is a refusal, and nothing is created', { skip }, () => {
  const gh = fakeGh('down');
  const r = release(project(sections), 'v1.2.3', gh);
  assert.equal(r.status, 1);
  assert.match(r.out, /github-release: refused: cannot tell whether a GitHub Release for v1\.2\.3 exists \(gh release view: HTTP 502: Bad Gateway\)/);
  assert.deepEqual(calls(gh.log).map((c) => c.args[1]), ['view']);
});

test('a failed gh release create is a failure', { skip }, () => {
  const gh = fakeGh('missing', true);
  const r = release(project(sections), 'v1.2.3', gh);
  assert.equal(r.status, 1);
  assert.match(r.out, /github-release: refused: gh release create exited 1/);
});

test('a missing or empty CHANGELOG section stops it before gh is called', { skip }, () => {
  for (const [tag, reason] of [['v9.9.9', /CHANGELOG\.md has no section for 9\.9\.9/], ['v1.2.2', /the CHANGELOG\.md section for 1\.2\.2 is empty/]] as const) {
    const gh = fakeGh('missing');
    const r = release(project(sections), tag, gh);
    assert.equal(r.status, 1);
    assert.match(r.out, reason);
    assert.deepEqual(calls(gh.log), []);
  }
});

test('a tag that is not v + a valid version is refused before gh is called', { skip }, () => {
  for (const tag of ['1.2.3', 'v1.2', 'v1.2.3+abc']) {
    const gh = fakeGh('missing');
    const r = release(project(sections), tag, gh);
    assert.equal(r.status, 1, tag);
    assert.match(r.out, /github-release: refused: the tag .* is not v \+ X\.Y\.Z or X\.Y\.Z-<prerelease>/);
    assert.deepEqual(calls(gh.log), []);
  }
});

test('no --tag is a usage error', { skip }, () => {
  const gh = fakeGh('missing');
  const r = release(project(sections), null, gh);
  assert.equal(r.status, 1);
  assert.match(r.out, /usage: github-release --tag vX\.Y\.Z/);
  assert.deepEqual(calls(gh.log), []);
});
