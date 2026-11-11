import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFacts } from '../src/lib/facts.js';
import { tmpDir } from './helpers.js';

// Review finding 2 of numbered-item-ids (sub-unit 2): the words of a story field that name another item resolve like the CLI does (full id, number or plain slug).
test('review finding 2: an Escapes word naming a numbered item by its plain slug or its number is recognised; an unknown or ambiguous name is not, and nothing is refused', () => {
  const d = tmpDir('burhan-facts-numbered-');
  mkdirSync(join(d, 'fix-x'), { recursive: true });
  mkdirSync(join(d, '012-x'));
  mkdirSync(join(d, '013-y'));
  mkdirSync(join(d, '014-y'));
  const esc = (v: string, slug = 'fix-x'): string[] => {
    writeFileSync(join(d, slug, `${slug}-story.md`), `- **Escapes:** ${v}\n`);
    return readFacts(join(d, slug), slug).escapes;
  };
  assert.deepEqual(esc('x'), ['012-x'], 'the plain slug of a numbered item only');
  assert.deepEqual(esc('12'), ['012-x'], 'the number');
  assert.deepEqual(esc('012-x'), ['012-x'], 'the full id, as before');
  assert.deepEqual(esc('`x` — found in prod'), ['012-x'], 'explanation words stay out');
  assert.deepEqual(esc('ghost'), [], 'an unknown name is no escape, as before');
  assert.deepEqual(esc('99'), [], 'a number with no item is no escape');
  assert.deepEqual(esc('y'), [], 'a plain slug naming two numbered items: no guess, no refusal');
  assert.deepEqual(esc('13'), ['013-y'], 'one number names one item');
  assert.deepEqual(esc('x', '012-x'), [], 'an item is not its own escape, by number or slug either');
  assert.deepEqual(esc('12', '012-x'), [], 'the item itself by number is not its own escape');
});
