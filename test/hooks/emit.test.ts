import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emit } from '../../src/hooks/core/lib.mjs';

// Expected strings are `jq -cn --arg m … '{message:$m}'` output (jq 1.8.1), pasted in: no jq at test time.
test('emit: nothing to say -> empty output', () => {
  assert.equal(emit([]), '');
});
test('emit: findings joined by a blank line, one JSON line', () => {
  assert.equal(emit(['first', 'second']), '{"message":"first\\n\\nsecond"}\n');
});
test('emit: escapes exactly like jq -c', () => {
  assert.equal(emit(['a"b\\c']), '{"message":"a\\"b\\\\c"}\n');
  assert.equal(emit(['l1\nl2\tt\r\b\f']), '{"message":"l1\\nl2\\tt\\r\\b\\f"}\n');
  assert.equal(emit(['c\x01\x1f\x7f']), '{"message":"c\\u0001\\u001f\\u007f"}\n');
  assert.equal(emit(['عربي ✅ 🚀']), '{"message":"عربي ✅ 🚀"}\n');
  assert.equal(emit(['\u2028']), '{"message":"\u2028"}\n');
});
