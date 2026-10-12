import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { runCli } from '../src/main.js';
import { packageRoot, kitDir } from '../src/lib/kit.js';
import { capture } from './helpers.js';

test('--version prints the package.json version', async () => {
  const { o, io } = capture();
  assert.equal(await runCli(['--version'], io), 0);
  assert.match(o.out, /^0\.1\.0\n$/);
});

test('--help prints usage and exits 0; no command exits 2', async () => {
  const a = capture();
  assert.equal(await runCli(['--help'], a.io), 0);
  assert.match(a.o.out, /usage: burhan <command>/);
  const b = capture();
  assert.equal(await runCli([], b.io), 2);
  assert.match(b.o.out, /usage: burhan <command>/);
});

test('unknown command exits 2 and names it', async () => {
  const { o, io } = capture();
  assert.equal(await runCli(['frobnicate'], io), 2);
  assert.match(o.err, /unknown command: frobnicate/);
});

test('the kit is found from the compiled module', () => {
  assert.match(kitDir(), /kit$/);
  assert.ok(packageRoot().length > 0);
});

test('the compiled entry point runs as a program', () => {
  const r = spawnSync(process.execPath, [join(packageRoot(), '.test-build/src/cli.js'), '--version'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '0.1.0\n');
});
