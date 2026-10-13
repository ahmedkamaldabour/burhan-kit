import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseConfig } from '../src/lib/config.js';
import { BurhanError } from '../src/lib/errors.js';
import { kitDir } from '../src/lib/kit.js';
import { ereTest } from '../src/hooks/core/ere.mjs';
import { setConfigKeys, neverRunRegex, sensitiveRegex, assertWritable } from '../src/lib/setup/config-write.js';

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
  const v = { WF_CHECK_CMD: 'make lint && make test', WF_FORBIDDEN_REGEX: neverRunRegex(['php artisan db:wipe']), WF_SENSITIVE_REGEX: sensitiveRegex(['app/Policies/']), WF_NEW_KEY: 'n' };
  for (const t of ['# c\nWF_CHECK_CMD=""\n', readFileSync(kitDir() + '/workflow.config.example', 'utf8')]) {
    const r = parseConfig(setConfigKeys(t, v));
    assert.deepEqual(r.problems, []);
    for (const [k, val] of Object.entries(v)) assert.equal(r.values[k], val);
  }
});

test('neverRunRegex through the hooks engine', () => {
  const re = neverRunRegex(['php artisan migrate:fresh', 'php artisan db:wipe']);
  assert.ok(ereTest(re, 'php  artisan   migrate:fresh --seed'));
  assert.ok(ereTest(re, 'sail php artisan db:wipe'));
  assert.ok(!ereTest(re, 'php artisan migrate'));
  assert.ok(!ereTest(re, 'grep -rn "migrate:fresh" README.md'));
  assert.ok(!ereTest(re, 'echo phpXartisan db:wipe'));
  assert.equal(neverRunRegex([]), '');
});

test('neverRunRegex escapes regex metacharacters', () => {
  const re = neverRunRegex(['rm -rf *.log']);
  assert.ok(ereTest(re, 'rm -rf *.log'));
  assert.ok(!ereTest(re, 'rm -rf a.log'));
});

test('sensitiveRegex anchors at the start', () => {
  const re = sensitiveRegex(['./app/Policies/', 'routes/admin.php']);
  assert.ok(ereTest(re, 'app/Policies/UserPolicy.php'));
  assert.ok(ereTest(re, 'routes/admin.php'));
  assert.ok(!ereTest(re, 'tests/app/Policies/x.php'));
  assert.ok(!ereTest(re, 'routes/adminXphp'));
  assert.equal(sensitiveRegex([]), '');
});

test('assertWritable refuses a line break, CR or NUL: a value is one literal line (review I-1)', () => {
  for (const v of ['a\nb', 'a\rb', 'a\0b', 'x\nWF_FORBIDDEN_REGEX=']) {
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
