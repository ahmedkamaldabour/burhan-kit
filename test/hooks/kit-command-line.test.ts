import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/hooks/main.mjs';
import { bootstrapBody } from '../../src/lib/bootstrap.js';
import { posixOnly, tmpDir } from '../helpers.js';

// AC-03, AC-04. Tests run from .test-build/test/hooks: the repository root is three levels up.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const NEVER_THERE = 'KIT COMMAND NOT FOUND';

async function messageOf(project: string, env: NodeJS.ProcessEnv): Promise<string> {
  const r = await run(['core', 'session-gates'], JSON.stringify({ event: 'session_start', project_dir: project, session: 'S1' }), { ...env, WF_EVIDENCE_DIR: tmpDir('burhan-kitline-ev-') });
  assert.equal(r.debug, '');
  return r.stdout === '' ? '' : (JSON.parse(r.stdout) as { message: string }).message;
}
const noKit = (): NodeJS.ProcessEnv => ({ ...process.env, PATH: tmpDir('burhan-kitline-path-') });
const withBurhan = (dir: string): string => { mkdirSync(dir, { recursive: true }); const f = join(dir, 'burhan'); writeFileSync(f, '#!/bin/sh\n'); chmodSync(f, 0o755); return dir; };

test('the session-start hook adds the kit line only when the kit is not found', { skip: posixOnly }, async () => {
  const p = tmpDir('burhan-kitline-');
  mkdirSync(join(p, '.burhan'), { recursive: true });
  writeFileSync(join(p, '.burhan/VERSION'), '1.2.3\n');
  writeFileSync(join(p, 'package.json'), '{}\n');
  const missing = await messageOf(p, noKit());
  assert.ok(missing.includes(NEVER_THERE), missing);
  assert.ok(missing.includes('npm i -D burhan-kit@1.2.3'), 'the install command carries the kit version');
  assert.ok(missing.includes("without the person's yes"), 'it says not to install it unasked');
  assert.ok(missing.includes('`npx burhan-kit` runs the copy installed in the project'), 'the same wording as the block');
  assert.ok(missing.includes('WORKFLOW GATES'), 'the gates are still there');
  withBurhan(join(p, 'node_modules/.bin'));
  assert.ok(!(await messageOf(p, noKit())).includes(NEVER_THERE), 'found in the project: no line');
  const q = tmpDir('burhan-kitline-q-');
  const onPath = withBurhan(join(tmpDir('burhan-kitline-bin-'), 'bin'));
  assert.ok(!(await messageOf(q, { ...process.env, PATH: onPath })).includes(NEVER_THERE), 'found on the PATH: no line');
  const none = await messageOf(q, noKit());
  assert.ok(none.includes('npm i -g burhan-kit') && none.includes('run `burhan`'), 'no package.json: the global command');
});

test('the hook line fails open: a junk version stamp is not echoed, a missing project still emits the gates', { skip: posixOnly }, async () => {
  const p = tmpDir('burhan-kitline-junk-');
  mkdirSync(join(p, '.burhan'), { recursive: true });
  writeFileSync(join(p, '.burhan/VERSION'), 'x; rm -rf /\n');
  writeFileSync(join(p, 'package.json'), '{}\n');
  const m = await messageOf(p, noKit());
  assert.ok(m.includes('npm i -D burhan-kit') && !m.includes('rm -rf') && !m.includes('burhan-kit@'), m);
  const gone = await messageOf(join(p, 'does-not-exist'), noKit());
  assert.ok(gone.includes('WORKFLOW GATES'), gone);
});

test('the block, the bindings template and the hook name the kit command the same way', () => {
  for (const agent of ['claude', 'codex'] as const) {
    const body = bootstrapBody(agent);
    assert.ok(body.includes('`burhan` stands for the kit command that `.burhan/bindings.md` names'), agent);
    assert.ok(body.includes('`npx burhan-kit` runs the copy installed in the project'), agent);
    assert.ok(body.includes('a plain `burhan` works only where it is on the PATH'), agent);
    assert.ok(!body.includes('the kit command is `burhan`, or'), 'the old two-name sentence is gone');
  }
  const tpl = readFileSync(join(ROOT, 'kit/templates/bindings.md'), 'utf8');
  assert.ok(tpl.includes('`npx burhan-kit` runs the copy installed in the project'));
  assert.ok(tpl.includes('`burhan` works only where it is on the PATH'));
});
