import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { notOnWindows, tmpDir } from './helpers.js';

// Tests run from .test-build/test, so the repository root is two levels up.
const guard = fileURLToPath(new URL('../../scripts/release-guard.mjs', import.meta.url));
const skip = notOnWindows('the fake npm is a PATH shim without a .cmd twin');

const git = (cwd: string, ...args: string[]): void => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
};

/** A project folder on `main` with a package.json at `version`; `side` leaves HEAD on a branch main does not contain. */
function project(version = '1.2.3', side = false): string {
  const dir = tmpDir('burhan-guard-');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo-pkg', version }));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'one');
  if (side) {
    git(dir, 'checkout', '-q', '-b', 'side');
    writeFileSync(join(dir, 'x.txt'), 'x');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'two');
  }
  return dir;
}

/** A folder holding an `npm` that answers `npm view` the way the registry does: a version, E404, or a network error. */
function fakeNpm(answer: 'published' | 'e404' | 'down'): string {
  const bin = tmpDir('burhan-fake-npm-');
  mkdirSync(bin, { recursive: true });
  const file = join(bin, 'npm');
  const body = {
    published: "console.log('1.2.3');",
    e404: "console.error('npm error code E404'); process.exit(1);",
    down: "console.error('npm error code ENOTFOUND'); process.exit(1);",
  }[answer];
  writeFileSync(file, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(file, 0o755);
  return bin;
}

function run(cwd: string, tag: string, answer: 'published' | 'e404' | 'down'): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [guard, '--tag', tag, '--main-ref', 'main'], {
    cwd, encoding: 'utf8', env: { ...process.env, PATH: fakeNpm(answer) + delimiter + process.env.PATH },
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

test('a matching tag on main, not yet on npm, passes', { skip }, () => {
  const r = run(project(), 'v1.2.3', 'e404');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /release-guard: ok demo-pkg@1\.2\.3/);
});

test('a tag that is not v + the package version is refused', { skip }, () => {
  const r = run(project(), 'v1.2.4', 'e404');
  assert.equal(r.status, 1);
  assert.match(r.out, /release-guard: refused: the tag v1\.2\.4 is not v1\.2\.3/);
});

test('a commit that main does not contain is refused', { skip }, () => {
  const r = run(project('1.2.3', true), 'v1.2.3', 'e404');
  assert.equal(r.status, 1);
  assert.match(r.out, /release-guard: refused: this commit is not on main/);
});

test('a version already on npm is refused', { skip }, () => {
  const r = run(project(), 'v1.2.3', 'published');
  assert.equal(r.status, 1);
  assert.match(r.out, /release-guard: refused: demo-pkg@1\.2\.3 is already published/);
});

test('a registry that cannot be read is refused, not assumed free', { skip }, () => {
  const r = run(project(), 'v1.2.3', 'down');
  assert.equal(r.status, 1);
  assert.match(r.out, /release-guard: refused: cannot tell whether demo-pkg@1\.2\.3 is published/);
});

test('every failure is reported, not only the first', { skip }, () => {
  const r = run(project('1.2.3', true), 'v9.9.9', 'published');
  assert.equal(r.status, 1);
  assert.equal((r.out.match(/release-guard: refused:/g) ?? []).length, 3, r.out);
});

test('a --main-ref that starts with a dash is a usage error, never handed to git', { skip }, () => {
  const r = spawnSync(process.execPath, [guard, '--tag', 'v1.2.3', '--main-ref', '--all'], { cwd: project(), encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage: release-guard --tag vX\.Y\.Z/);
});

test('no --tag is a usage error', { skip }, () => {
  const r = spawnSync(process.execPath, [guard], { cwd: project(), encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage: release-guard --tag vX\.Y\.Z/);
});
