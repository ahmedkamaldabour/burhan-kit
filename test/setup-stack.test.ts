import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseConfig } from '../src/lib/config.js';
import { BurhanError } from '../src/lib/errors.js';
import { applySetup, planSetup } from '../src/lib/setup/engine.js';
import { neverRunRegex, sensitiveRegex } from '../src/lib/setup/config-write.js';
import { parseSetArgs, setStack, stackInstructions } from '../src/lib/setup/stack.js';
import { capture } from './helpers.js';
import { install } from '../src/lib/install.js';
import { writeFileSync } from 'node:fs';

const home = mkdtempSync(join(tmpdir(), 'burhan-stack-home-'));
function installed(): string {
  const d = mkdtempSync(join(tmpdir(), 'burhan-stack-'));
  spawnSync('git', ['init', '-q'], { cwd: d });
  applySetup(planSetup(d, { agents: ['claude'], mode: 'step', docs: { kind: 'private' }, lang: 'en' }, home));
  return d;
}
const cfgText = (t: string): string => readFileSync(join(t, '.workflow/workflow.config'), 'utf8');
const cfgOf = (t: string) => parseConfig(cfgText(t)).values;
const v = (o: Partial<{ check: string; neverRun: string[]; sensitive: string[] }> = {}) => ({ check: 'true', neverRun: [], sensitive: [], ...o });

test('setStack with a passing check saves it, marks done and writes the verify skill', async () => {
  const t = installed();
  assert.equal(cfgOf(t).WF_STACK_SETUP, 'pending');
  const { o, io } = capture(t);
  assert.equal(await setStack(t, v(), { force: false }, io), 0);
  assert.equal(cfgOf(t).WF_CHECK_CMD, 'true');
  assert.equal(cfgOf(t).WF_STACK_SETUP, 'done');
  assert.ok(existsSync(join(t, '.claude/skills/verify/SKILL.md')));
  assert.match(o.out, /true/);
  assert.match(o.out, /exit 0/);
});

test('a failing check saves nothing, exits 1 and says how to retry', async () => {
  const t = installed();
  const before = cfgText(t);
  const { o, io } = capture(t);
  assert.equal(await setStack(t, v({ check: 'false' }), { force: false }, io), 1);
  assert.equal(cfgText(t), before);
  assert.match(o.out + o.err, /exit 1/);
  assert.match(o.out + o.err, /--force/);
});

test('--force saves a failing check', async () => {
  const t = installed();
  const { io } = capture(t);
  assert.equal(await setStack(t, v({ check: 'false' }), { force: true }, io), 0);
  assert.equal(cfgOf(t).WF_CHECK_CMD, 'false');
  assert.equal(cfgOf(t).WF_STACK_SETUP, 'done');
});

test('check=none saves an empty check and done', async () => {
  const t = installed();
  const { io } = capture(t);
  assert.equal(await setStack(t, v({ check: 'none' }), { force: false }, io), 0);
  assert.equal(cfgOf(t).WF_CHECK_CMD, '');
  assert.equal(cfgOf(t).WF_STACK_SETUP, 'done');
});

test('never-run and sensitive lists are written as regexes with a plain-words reason', async () => {
  const t = installed();
  const list = ['php artisan migrate:fresh', 'php artisan db:wipe'];
  const { io } = capture(t);
  assert.equal(await setStack(t, v({ neverRun: list, sensitive: ['app/Policies/'] }), { force: false }, io), 0);
  const c = cfgOf(t);
  assert.equal(c.WF_FORBIDDEN_REGEX, neverRunRegex(list));
  assert.equal(c.WF_SENSITIVE_REGEX, sensitiveRegex(['app/Policies/']));
  assert.ok(c.WF_FORBIDDEN_REASON.includes('php artisan migrate:fresh') && c.WF_FORBIDDEN_REASON.includes('php artisan db:wipe'));
  assert.match(c.WF_FORBIDDEN_REASON, /^the owner chose these at setup: /);
});

test('a check matching the never-run list is refused without running', async () => {
  const t = installed();
  const marker = join(t, 'ran.marker');
  const before = cfgText(t);
  const { o, io } = capture(t);
  const code = await setStack(t, v({ check: `touch ${marker}`, neverRun: ['touch'] }), { force: false }, io);
  assert.notEqual(code, 0);
  assert.ok(!existsSync(marker));
  assert.equal(cfgText(t), before);
  assert.match(o.out + o.err, /never[- ]run|refus/i);
});

test('a check matching the existing never-run list is refused too', async () => {
  const t = installed();
  const { io } = capture(t);
  await setStack(t, v({ neverRun: ['touch'] }), { force: false }, io);
  const marker = join(t, 'ran2.marker');
  assert.notEqual(await setStack(t, v({ check: `touch ${marker}` }), { force: true }, capture(t).io), 0);
  assert.ok(!existsSync(marker));
});

test('a value with a single quote is refused and nothing is written', async () => {
  const t = installed();
  const before = cfgText(t);
  await assert.rejects(setStack(t, v({ check: "echo 'x'" }), { force: false }, capture(t).io), BurhanError);
  await assert.rejects(setStack(t, v({ neverRun: ["a'b"] }), { force: false }, capture(t).io), BurhanError);
  await assert.rejects(setStack(t, v({ sensitive: ["a'b"] }), { force: false }, capture(t).io), BurhanError);
  assert.equal(cfgText(t), before);
});

test('not installed -> a clear error', async () => {
  const d = mkdtempSync(join(tmpdir(), 'burhan-stack-empty-'));
  await assert.rejects(setStack(d, v(), { force: false }, capture(d).io), /not installed.*setup/);
});

test('parseSetArgs', () => {
  assert.deepEqual(parseSetArgs(['check=make lint', 'never-run= a ; b;;', 'sensitive=p;q ']), { check: 'make lint', neverRun: ['a', 'b'], sensitive: ['p', 'q'] });
  assert.deepEqual(parseSetArgs(['check=none']), { check: 'none', neverRun: [], sensitive: [] });
  assert.throws(() => parseSetArgs(['check=x', 'bogus=1']), BurhanError);
  assert.throws(() => parseSetArgs(['never-run=a']), BurhanError);
  assert.throws(() => parseSetArgs(['check=']), BurhanError);
  assert.throws(() => parseSetArgs(['check=x', 'nokeyvalue']), BurhanError);
});

test('stackInstructions: the fixed block, never invent, no setting names', () => {
  for (const lang of ['en', 'ar'] as const) {
    const s = stackInstructions(lang);
    assert.ok(!s.includes('WF_'));
    assert.ok(s.includes('npx burhan-kit setup --set'));
  }
  const s = stackInstructions('en');
  for (const l of ['burhan needs one thing before it can check your work:', 'Recommended for this project (<stack>):', '  Check before commit   <command or "none found, tell me which to use">', '  Never run             <commands, or "nothing">', '  Sensitive             <paths, or "nothing">', '● Use these   ○ Change something']) assert.ok(s.includes(l), l);
  assert.match(s, /never invent/i);
  assert.match(s, /ask/i);
});

test('setStack keeps a --no-bootstrap project without the bootstrap block (review I-1)', async () => {
  const t = mkdtempSync(join(tmpdir(), 'burhan-stack-nob-'));
  spawnSync('git', ['init', '-q', t]);
  install({ mode: 'init', target: t, agents: ['claude'], apply: true, bootstrap: false }, capture(t).io);
  assert.equal(existsSync(join(t, 'CLAUDE.md')), false);
  assert.equal(await setStack(t, v(), { force: false }, capture(t).io), 0);
  assert.equal(existsSync(join(t, 'CLAUDE.md')), false, 'no CLAUDE.md appeared');
  writeFileSync(join(t, 'CLAUDE.md'), '# my own notes\n');
  assert.equal(await setStack(t, v(), { force: false }, capture(t).io), 0);
  assert.equal(readFileSync(join(t, 'CLAUDE.md'), 'utf8'), '# my own notes\n', 'no block added to my own file');
});
test('setStack keeps the block in a project that has one', async () => {
  const t = installed();
  assert.match(readFileSync(join(t, 'CLAUDE.md'), 'utf8'), /<!-- burhan:begin /);
  assert.equal(await setStack(t, v(), { force: false }, capture(t).io), 0);
  assert.match(readFileSync(join(t, 'CLAUDE.md'), 'utf8'), /<!-- burhan:begin /);
});
