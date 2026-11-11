import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayId, linkTarget, matchItem, nextNumber, parseId, readsAsNumber, sharedNumbers } from '../../src/hooks/core/item-id.mjs';

test('parseId reads a number and a dash before the slug, and nothing else', () => {
  assert.deepEqual(parseId('012-state-file'), { number: '012', slug: 'state-file' });
  assert.deepEqual(parseId('old-item'), { number: null, slug: 'old-item' });
  assert.deepEqual(parseId('12-x'), { number: null, slug: '12-x' }); // two digits are not a number
  assert.deepEqual(parseId('0123-x'), { number: null, slug: '0123-x' }); // four digits are not either
  assert.deepEqual(parseId('007-007-x'), { number: '007', slug: '007-x' });
});

test('displayId shows #012 · slug for a numbered item and the name itself for an older one', () => {
  assert.equal(displayId('012-state-file'), '#012 · state-file');
  assert.equal(displayId('old-item'), 'old-item');
});

test('a slug that reads as a number is told apart from one that does not', () => {
  for (const s of ['12', '012', '2026', '012-x', '999-fix']) assert.equal(readsAsNumber(s), true, s);
  for (const s of ['fix-12', '12-x', 'a1', '1a', '0123-x', 'state-file']) assert.equal(readsAsNumber(s), false, s);
});

test('matchItem takes the full id exactly, a number as 12 or 012, and the plain slug', () => {
  const names = ['001-alpha', '002-beta', 'old-one'];
  assert.deepEqual(matchItem('002-beta', names), { kind: 'one', id: '002-beta' });
  assert.deepEqual(matchItem('2', names), { kind: 'one', id: '002-beta' });
  assert.deepEqual(matchItem('002', names), { kind: 'one', id: '002-beta' });
  assert.deepEqual(matchItem('beta', names), { kind: 'one', id: '002-beta' });
  assert.deepEqual(matchItem('old-one', names), { kind: 'one', id: 'old-one' });
  assert.deepEqual(matchItem('003', names), { kind: 'none' });
  assert.deepEqual(matchItem('003-beta', names), { kind: 'none' }); // a full id is never read as a slug
  assert.deepEqual(matchItem('missing', names), { kind: 'none' });
  assert.deepEqual(matchItem('lpha', names), { kind: 'none' }); // never a part of a name
});

test('matchItem never guesses: a number or a slug that names two items gives both candidates', () => {
  const names = ['013-a', '013-b', '014-a'];
  assert.deepEqual(matchItem('13', names), { kind: 'many', ids: ['013-a', '013-b'], by: 'number' });
  assert.deepEqual(matchItem('a', names), { kind: 'many', ids: ['013-a', '014-a'], by: 'slug' });
  assert.deepEqual(matchItem('013-a', names), { kind: 'one', id: '013-a' });
  assert.deepEqual(matchItem('14', names), { kind: 'one', id: '014-a' });
  assert.deepEqual(matchItem('a', ['a', '001-a']), { kind: 'one', id: 'a' }); // an older folder named exactly `a` wins over the numbered `001-a` (review finding 1)
});

test('matchItem lets an older folder that is only digits be named by its exact name', () => {
  assert.deepEqual(matchItem('12', ['12']), { kind: 'one', id: '12' });
});

test('linkTarget turns what `burhan use` was given into the block heading that is in Now', () => {
  const live = ['001-alpha', '002-beta', 'old'];
  assert.equal(linkTarget('001-alpha', live), '001-alpha');
  assert.equal(linkTarget('2', live), '002-beta');
  assert.equal(linkTarget('beta', live), '002-beta');
  assert.equal(linkTarget('old', live), 'old');
  assert.equal(linkTarget('9', live), null);
  assert.equal(linkTarget('x', ['013-x', '014-x']), null); // two blocks: no guess
  assert.equal(linkTarget('foo', ['foo', '001-foo']), 'foo'); // an exact heading wins over the plain slug of a numbered one
});

test('nextNumber is the highest number + 1 in 3 digits, 001 when none, never a reused one, null at 999', () => {
  assert.equal(nextNumber([]), '001');
  assert.equal(nextNumber(['old-one', 'other']), '001');
  assert.equal(nextNumber(['001-a', '002-b']), '003');
  assert.equal(nextNumber(['001-a', '005-b', 'old']), '006'); // a gap is not filled
  assert.equal(nextNumber(['009-a']), '010');
  assert.equal(nextNumber(['998-a']), '999');
  assert.equal(nextNumber(['999-a']), null);
});

test('sharedNumbers lists a number used by more than one item', () => {
  assert.deepEqual(sharedNumbers(['013-a', '013-b', '014-a', 'old']), [{ number: '013', ids: ['013-a', '013-b'] }]);
  assert.deepEqual(sharedNumbers(['001-a', '002-b', 'old']), []);
});

// Review finding 1 of numbered-item-ids (sub-unit 2): an exact unnumbered name wins over the plain slug of a numbered item.
test('an exact unnumbered name wins over the plain slug of a numbered item: x is the old item, 12 and the full id are the numbered one', () => {
  const names = ['x', '012-x'];
  assert.deepEqual(matchItem('x', names), { kind: 'one', id: 'x' });
  assert.deepEqual(matchItem('12', names), { kind: 'one', id: '012-x' });
  assert.deepEqual(matchItem('012-x', names), { kind: 'one', id: '012-x' });
  assert.deepEqual(matchItem('x', ['x', '013-x', '014-x']), { kind: 'one', id: 'x' });
  assert.deepEqual(matchItem('x', ['013-x', '014-x']), { kind: 'many', ids: ['013-x', '014-x'], by: 'slug' }); // no exact name: still refused
});
