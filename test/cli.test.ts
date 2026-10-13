import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { runCli } from '../src/main.js';
import { packageRoot, kitDir } from '../src/lib/kit.js';
import { capture } from './helpers.js';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseConfig } from '../src/lib/config.js';
import { runWizard } from '../src/lib/setup/wizard.js';
import { scriptedPrompter } from '../src/lib/setup/prompter.js';

test('--version prints the package.json version', async () => {
  const { o, io } = capture();
  assert.equal(await runCli(['--version'], io), 0);
  assert.equal(o.out, JSON.parse(readFileSync(join(packageRoot(), 'package.json'), 'utf8')).version + '\n');
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
  assert.equal(r.stdout, JSON.parse(readFileSync(join(packageRoot(), 'package.json'), 'utf8')).version + '\n');
});

test('bare command without a terminal prints usage and exits 2; setup without one points to a terminal', async () => {
  const a = capture(); a.io.interactive = false;
  assert.equal(await runCli([], a.io), 2);
  assert.match(a.o.out, /usage: burhan <command>/);
  const b = capture(); b.io.interactive = false;
  assert.equal(await runCli(['setup', tmpdir()], b.io), 2);
  assert.match(b.o.err, /needs a terminal/);
});

test('setup --stack prints the first-use block; setup --set saves the check end to end', async () => {
  const a = capture();
  assert.equal(await runCli(['setup', '--stack'], a.io), 0);
  assert.match(a.o.out, /first-use setup/);
  const t = mkdtempSync(join(tmpdir(), 'burhan-cli-set-'));
  spawnSync('git', ['init', '-q'], { cwd: t });
  await runWizard(t, capture(t).io, scriptedPrompter(['use', 'apply']), 'en', t);
  const b = capture(t);
  assert.equal(await runCli(['setup', t, '--set', 'check=true', 'sensitive=a;b'], b.io), 0);
  assert.equal(parseConfig(readFileSync(join(t, '.workflow/workflow.config'), 'utf8')).values.WF_CHECK_CMD, 'true');
});

test('an error inside an async setup command is a plain "burhan: …" message with exit 2, not a stack trace (review I-1)', async () => {
  const d = mkdtempSync(join(tmpdir(), 'burhan-cli-noinst-'));
  spawnSync('git', ['init', '-q', d]);
  const { o, io } = capture(d);
  assert.equal(await runCli(['setup', d, '--set', 'check=true'], io), 2);
  assert.match(o.err, /^burhan: burhan is not installed/);
});
