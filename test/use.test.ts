import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli } from '../src/main.js';
import { capture, tmpDir } from './helpers.js';

function project(): string {
  const p = tmpDir('burhan-use-');
  mkdirSync(join(p, '.burhan/local'), { recursive: true });
  writeFileSync(join(p, '.burhan/workflow.config'), '');
  writeFileSync(join(p, '.burhan/local/PROGRESS.md'), '## Now\n### alpha\n### beta\n');
  return p;
}

test('use accepts an item currently in Now and only queues the turn-end link', async () => {
  const p = project(); const { o, io } = capture(p);
  assert.equal(await runCli(['use', 'beta'], io), 0);
  assert.equal(o.out, 'linked at the end of this turn\n');
  assert.equal(o.err, '');
});

test('use rejects an absent item with the available slugs', async () => {
  const p = project(); const { o, io } = capture(p);
  assert.equal(await runCli(['use', 'missing'], io), 2);
  assert.equal(o.out, '');
  assert.match(o.err, /available: alpha, beta/);
});

test('use rejects invalid argument shapes without stdout', async () => {
  for (const args of [[], ['alpha', 'extra'], ['../alpha'], ['alpha/beta'], ['alpha;echo']]) {
    const p = project(); const { o, io } = capture(p);
    assert.equal(await runCli(['use', ...args], io), 2, args.join(' ') || '(missing)');
    assert.equal(o.out, '', args.join(' ') || '(missing)');
  }
});
