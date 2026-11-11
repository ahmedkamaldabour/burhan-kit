import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseConfig } from '../src/lib/config.js';
import { runChecks, type Probe } from '../src/lib/doctor.js';
import { fullRunLine, fullRunOf } from '../src/lib/full-run.js';
import { install } from '../src/lib/install.js';
import { setConfigKeys } from '../src/lib/setup/config-write.js';
import { applySetup, planSetup } from '../src/lib/setup/engine.js';
import { parseSetArgs, setStack, stackInstructions } from '../src/lib/setup/stack.js';
import { capture, tmpDir } from './helpers.js';

// AC-05 to AC-07: the full= key, the whole-suite question of --stack, the doctor warning and the hint of `full run: cannot tell`.
const home = tmpDir('burhan-full-home-');
const good: Probe = { nodeVersion: () => '24.13.0', claudeVersion: () => '2.1.296', home: () => home };
function installed(): string {
  const d = tmpDir('burhan-full-');
  spawnSync('git', ['init', '-q'], { cwd: d });
  applySetup(planSetup(d, { agents: ['claude'], mode: 'step', docs: { kind: 'private' }, lang: 'en' }, home));
  return d;
}
const cfgPath = (t: string): string => join(t, '.burhan/workflow.config');
const cfgText = (t: string): string => readFileSync(cfgPath(t), 'utf8');
const cfgOf = (t: string): Record<string, string> => parseConfig(cfgText(t)).values;
const setKeys = (t: string, values: Record<string, string>): void => writeFileSync(cfgPath(t), setConfigKeys(cfgText(t), values));

test('parseSetArgs reads full next to the other keys, and check= may be left out', () => {
  assert.deepEqual(parseSetArgs(['full=^npm test$']), { sensitive: [], full: '^npm test$' });
  assert.deepEqual(parseSetArgs(['check=make lint', 'full= ^make test$ ']), { check: 'make lint', sensitive: [], full: '^make test$' });
  assert.throws(() => parseSetArgs(['check=', 'full=^x$']), /check=<command\|none> is required/);
  assert.throws(() => parseSetArgs([]), /check=<command\|none> is required/);
  assert.throws(() => parseSetArgs(['check=x', 'colour=red']), /code, test, evidence, full/);
});

test('full= alone is saved once a check is saved; the check and first use are left alone', async () => {
  const t = installed();
  assert.equal(await setStack(t, { check: 'exit 0', sensitive: [] }, { force: false }, capture(t).io), 0);
  const r = capture(t);
  assert.equal(await setStack(t, parseSetArgs(['full=^npm test$']), { force: false }, r.io), 0, r.o.err);
  assert.equal(cfgOf(t).WF_FULL_TEST_REGEX, '^npm test$');
  assert.equal(cfgOf(t).WF_CHECK_CMD, 'exit 0');
  assert.equal(cfgOf(t).WF_STACK_SETUP, 'done');
  assert.doesNotMatch(r.o.out, /Running the check once/);
  assert.match(r.o.out, /Saved the settings/);
});

test('full= alone before a check is saved is refused and writes nothing', async () => {
  const t = installed();
  const before = cfgText(t);
  assert.equal(cfgOf(t).WF_STACK_SETUP, 'pending');
  await assert.rejects(setStack(t, parseSetArgs(['full=^npm test$']), { force: false }, capture(t).io), /check=<command\|none> is required/);
  assert.equal(cfgText(t), before);
});

test('the full pattern is refused like the evidence pattern, and nothing is written', async () => {
  const t = installed();
  const before = cfgText(t);
  await assert.rejects(setStack(t, { check: 'exit 0', sensitive: [], full: '(src)/\\1$' }, { force: false }, capture(t).io), /the full pattern: the hooks refuse it/);
  await assert.rejects(setStack(t, { check: 'exit 0', sensitive: [], full: "it's" }, { force: false }, capture(t).io), /single quote/);
  assert.equal(cfgText(t), before);
});

test('the first-use instructions ask for the whole-suite command and the full= key in both languages', () => {
  for (const lang of ['en', 'ar'] as const) {
    const s = stackInstructions(lang);
    assert.ok(s.includes("full='^<command>$'"), lang);
    assert.ok(!s.includes('WF_'), lang);
    assert.match(s, /setup --set check=.* code=.* test=.* evidence=.* full=/, lang);
  }
  assert.match(stackInstructions('en'), /the one command that runs the whole test suite, not one file/);
  assert.match(stackInstructions('ar'), /مجموعة الاختبارات كلها/);
});

test('doctor warns when a test or evidence pattern is set and the full pattern is empty', () => {
  const p = tmpDir('burhan-full-doctor-');
  install({ mode: 'init', target: p, agents: ['claude'], apply: true, bootstrap: false }, capture(p).io);
  const full = (): { status: string; text: string }[] => runChecks(p, good).filter((c) => c.text.includes('WF_FULL_TEST_REGEX'));
  assert.deepEqual(full(), [], 'no test or evidence pattern: nothing to say');
  setKeys(p, { WF_TEST_REGEX: '\\.test\\.ts$' });
  assert.equal(full().length, 1);
  assert.equal(full()[0]!.status, 'warn', 'a warning, never a failure');
  assert.ok(full()[0]!.text.includes("setup --set full='^<command>$'"), full()[0]!.text);
  setKeys(p, { WF_TEST_REGEX: '', WF_EVIDENCE_REGEX: '^npm test' });
  assert.equal(full().length, 1, 'the evidence pattern alone also asks for it');
  setKeys(p, { WF_FULL_TEST_REGEX: '^npm test$' });
  assert.deepEqual(full(), [], 'the key is set: no warning');
});

test('the cannot tell line names setup --set full= only when the key is empty or not usable', () => {
  for (const full of [undefined, '', '(']) {
    const line = fullRunLine(fullRunOf([], { full }));
    assert.match(line, /^full run: cannot tell — WF_FULL_TEST_REGEX is empty or not usable, so the ledger cannot tell a full run from a run of one file; .*setup --set full=/, String(full));
  }
  assert.ok(!fullRunLine(fullRunOf([], { full: '^npm test$' })).includes('setup --set full='), 'a usable key with no ledger says only that the ledger is empty');
});

test('a save that would write nothing is refused: empty values with a saved check write nothing and say so', async () => {
  const t = installed();
  assert.equal(await setStack(t, { check: 'exit 0', sensitive: [] }, { force: false }, capture(t).io), 0);
  const before = cfgText(t);
  for (const args of [['full='], ['sensitive='], ['code=', 'evidence=']]) {
    const r = capture(t);
    await assert.rejects(setStack(t, parseSetArgs(args), { force: false }, r.io), /nothing to save/, args.join(' '));
    assert.doesNotMatch(r.o.out, /Saved the settings/, args.join(' '));
  }
  assert.equal(cfgText(t), before);
});
