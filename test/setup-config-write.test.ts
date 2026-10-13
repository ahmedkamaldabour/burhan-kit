import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig } from '../src/lib/config.js';
import { BurhanError } from '../src/lib/errors.js';
import { kitDir } from '../src/lib/kit.js';
import { runCli } from '../src/main.js';
import { ereTest } from '../src/hooks/core/ere.mjs';
import { applySetup, planSetup } from '../src/lib/setup/engine.js';
import { setConfigKeys, sensitiveRegex, assertWritable } from '../src/lib/setup/config-write.js';
import { capture, tmpDir } from './helpers.js';

function installed(): string {
  const target = tmpDir('burhan-config-write-');
  applySetup(planSetup(target, { agents: ['claude'], mode: 'step', docs: { kind: 'private' }, lang: 'en' }, tmpDir('burhan-config-write-home-')));
  return target;
}

test('setConfigKeys replaces the first live line and keeps the rest', () => {
  assert.equal(setConfigKeys('# c\nWF_CHECK_CMD=""\n', { WF_CHECK_CMD: 'make lint' }), "# c\nWF_CHECK_CMD='make lint'\n");
});

test('an absent key is appended once; a commented e.g. line is untouched', () => {
  const t = '#   e.g. WF_CHECK_CMD="npx tsc"\nWF_X=1\n';
  const out = setConfigKeys(t, { WF_CHECK_CMD: 'make lint' });
  assert.equal(out, t + "WF_CHECK_CMD='make lint'\n");
  assert.equal(out.split('WF_CHECK_CMD=\'make lint\'').length - 1, 1);
});

test('appending to text without a final newline stays well-formed', () => {
  assert.equal(setConfigKeys('A=1', { B: 'x y' }), "A=1\nB='x y'\n");
  assert.equal(setConfigKeys('', { B: 'x' }), "B='x'\n");
});

test('only the first live line of a key is replaced', () => {
  assert.equal(setConfigKeys('K=1\nK=2\n', { K: 'z' }), "K='z'\nK=2\n");
});

test('round trip, including the real example config', () => {
  const v = { WF_CHECK_CMD: 'make lint && make test', WF_SENSITIVE_REGEX: sensitiveRegex(['app/Policies/']), WF_NEW_KEY: 'n' };
  for (const t of ['# c\nWF_CHECK_CMD=""\n', readFileSync(kitDir() + '/workflow.config.example', 'utf8')]) {
    const r = parseConfig(setConfigKeys(t, v));
    assert.deepEqual(r.problems, []);
    for (const [k, val] of Object.entries(v)) assert.equal(r.values[k], val);
  }
});

for (const setting of ['never-run=touch marker', 'never-run-regex=^touch', 'never-run=', 'never-run-regex=a(']) {
  test(`setup --set rejects removed ${setting} without changing config or running a check`, async () => {
    const target = installed();
    const config = join(target, '.workflow/workflow.config');
    const local = join(target, '.workflow/local/workflow.config');
    mkdirSync(join(target, '.workflow/local'), { recursive: true });
    writeFileSync(config, readFileSync(config, 'utf8') + "WF_FORBIDDEN_REGEX='^touch'\nWF_FORBIDDEN_REASON='legacy'\nWF_SINGLE_TEST_HINT='legacy runner'\n");
    writeFileSync(local, "WF_FORBIDDEN_REGEX='^echo'\nWF_FORBIDDEN_REASON='local legacy'\nWF_SINGLE_TEST_HINT='local runner'\n");
    const before = readFileSync(config, 'utf8');
    const localBefore = readFileSync(local, 'utf8');
    for (const pairs of [[setting], ['check=true', setting], [setting, 'check=true']]) {
      const { o, io } = capture(target);
      assert.equal(await runCli(['setup', target, '--set', ...pairs, '--force'], io), 2);
      assert.match(o.err, /removed/i);
      assert.ok(o.err.includes(setting.split('=')[0]));
      assert.equal(o.out, '');
      assert.equal(readFileSync(config, 'utf8'), before);
      assert.equal(readFileSync(local, 'utf8'), localBefore);
    }
  });
}

test('sensitiveRegex anchors at the start', () => {
  const re = sensitiveRegex(['./app/Policies/', 'routes/admin.php']);
  assert.ok(ereTest(re, 'app/Policies/UserPolicy.php'));
  assert.ok(ereTest(re, 'routes/admin.php'));
  assert.ok(!ereTest(re, 'tests/app/Policies/x.php'));
  assert.ok(!ereTest(re, 'routes/adminXphp'));
  assert.equal(sensitiveRegex([]), '');
});

test('assertWritable refuses a line break, CR or NUL: a value is one literal line (review I-1)', () => {
  for (const v of ['a\nb', 'a\rb', 'a\0b', 'x\nWF_CHECK_CMD=']) {
    assert.throws(() => assertWritable('WF_CHECK_CMD', v), (e: unknown) => e instanceof BurhanError && /one line/.test(e.message), JSON.stringify(v));
  }
});
test('sensitiveRegex matches the path itself or what is under it, not a longer name (review M-6)', () => {
  assert.equal(ereTest(sensitiveRegex(['app/Policies/']), 'app/PoliciesX/a.php'), false);
  assert.equal(ereTest(sensitiveRegex(['app/Policies/']), 'app/Policies'), true);
  assert.equal(ereTest(sensitiveRegex(['app/Policies/']), 'app/Policies/a.php'), true);
});
test('assertWritable refuses a single quote', () => {
  assert.throws(() => assertWritable('WF_CHECK_CMD', "echo 'x'"), (e: unknown) => e instanceof BurhanError && /single quote/.test(e.message));
  assert.doesNotThrow(() => assertWritable('WF_CHECK_CMD', 'make lint'));
});
