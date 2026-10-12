import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/main.js';
import { capture } from './helpers.js';

function project(): string {
  const p = mkdtempSync(join(tmpdir(), 'burhan-st-'));
  mkdirSync(join(p, '.workflow'), { recursive: true });
  writeFileSync(join(p, '.workflow/workflow.config'), 'WF_DOCS_DIR="work"\n');
  mkdirSync(join(p, 'work/foo'), { recursive: true });
  writeFileSync(join(p, 'work/foo/foo-story.md'), '- **Status:** Approved\n');
  return p;
}

test('status prints the index without writing', async () => {
  const p = project(); const { o, io } = capture(p);
  assert.equal(await runCli(['status'], io), 0);
  assert.match(o.out, /\| \[foo\]\(foo\/\) \| — \| — \| — \| Spec ready \|/);
  assert.ok(!existsSync(join(p, 'work/README.md')));
});

test('--write creates and refreshes a generated index', async () => {
  const p = project();
  assert.equal(await runCli(['status', p, '--write'], capture().io), 0);
  assert.match(readFileSync(join(p, 'work/README.md'), 'utf8'), /Spec ready/);
  writeFileSync(join(p, 'work/foo/foo-implementation-plan.md'), '- **Overall status:** In progress\n');
  assert.equal(await runCli(['status', p, '--write'], capture().io), 0);
  assert.match(readFileSync(join(p, 'work/README.md'), 'utf8'), /In progress/);
});

test('a hand-written index is never overwritten without --force (and --force keeps a backup)', async () => {
  const p = project(); writeFileSync(join(p, 'work/README.md'), 'MY OWN INDEX\n');
  const a = capture();
  assert.equal(await runCli(['status', p, '--write'], a.io), 2);
  assert.match(a.o.err, /hand-written/);
  assert.equal(readFileSync(join(p, 'work/README.md'), 'utf8'), 'MY OWN INDEX\n');
  assert.equal(await runCli(['status', p, '--write', '--force'], capture().io), 0);
  assert.equal(readFileSync(join(p, 'work/README.md.burhan-backup'), 'utf8'), 'MY OWN INDEX\n');
});

test('no docs directory -> says so, exit 0', async () => {
  const p = mkdtempSync(join(tmpdir(), 'burhan-st-')); const { o, io } = capture(p);
  assert.equal(await runCli(['status', '--write'], io), 0);
  assert.match(o.out, /no work items/);
});
