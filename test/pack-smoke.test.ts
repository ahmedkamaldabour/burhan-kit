import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { notOnWindows, tmpDir } from './helpers.js';

// Tests run from .test-build/test, so the repository root is two levels up.
const smoke = fileURLToPath(new URL('../../scripts/pack-smoke.mjs', import.meta.url));
const skip = notOnWindows('npm is spawned through a .cmd shim there; the release runs this on Linux');

/** A tiny package whose bin prints `printed`; `ship` false declares a bin file that does not exist; `prepack` is a lifecycle script. */
function fixture(printed: string, ship = true, prepack?: string): string {
  const dir = tmpDir('burhan-smoke-');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'smoke-fixture', version: '9.9.9', bin: { demo: ship ? 'cli.js' : 'missing.js' }, ...(prepack ? { scripts: { prepack } } : {}) }));
  writeFileSync(join(dir, 'cli.js'), `#!/usr/bin/env node\nconsole.log(${JSON.stringify(printed)});\n`);
  writeFileSync(join(dir, 'README.md'), 'x');
  return dir;
}

function run(cwd: string, out: string, tmp?: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [smoke, '--out', out], { cwd, encoding: 'utf8', env: tmp ? { ...process.env, TMPDIR: tmp } : process.env });
  return { status: r.status, out: r.stdout + r.stderr };
}

test('a tarball whose bin prints the package version passes, and is left as package.tgz', { skip }, () => {
  const out = join(tmpDir('burhan-smoke-out-'), 'pack');
  const r = run(fixture('9.9.9'), out);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /pack-smoke: ok smoke-fixture@9\.9\.9 .*package\.tgz shasum [0-9a-f]{40}/);
  assert.equal(existsSync(join(out, 'package.tgz')), true);
});

test('a bin that prints another version is refused', { skip }, () => {
  const r = run(fixture('0.0.1'), join(tmpDir('burhan-smoke-out-'), 'pack'));
  assert.equal(r.status, 1);
  assert.match(r.out, /pack-smoke: failed: .*printed "0\.0\.1", expected "9\.9\.9"/);
});

test('a package whose declared bin file is not there is refused', { skip }, () => {
  const r = run(fixture('9.9.9', false), join(tmpDir('burhan-smoke-out-'), 'pack'));
  assert.equal(r.status, 1);
  assert.match(r.out, /pack-smoke: failed: /);
});

test('a prepack that prints to stdout does not break reading the pack result', { skip }, () => {
  const r = run(fixture('9.9.9', true, 'echo PREPACK-NOISE'), join(tmpDir('burhan-smoke-out-'), 'pack'));
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /pack-smoke: ok smoke-fixture@9\.9\.9/);
});

test('a failure after the install leaves no temp folder behind', { skip }, () => {
  const tmp = tmpDir('burhan-smoke-tmp-');
  const r = run(fixture('0.0.1'), join(tmpDir('burhan-smoke-out-'), 'pack'), tmp);
  assert.equal(r.status, 1);
  assert.deepEqual(readdirSync(tmp).filter((name) => name.startsWith('burhan-pack-smoke-')), []);
});

test('no --out is a usage error', { skip }, () => {
  const r = spawnSync(process.execPath, [smoke], { cwd: fixture('9.9.9'), encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage: pack-smoke --out <dir>/);
});
