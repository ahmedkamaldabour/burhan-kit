import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cli, project, read, STATE, write } from './item-fixture.js';

/** The rows of the index `burhan status` prints, as `<id> · <route> · <state>`. */
const indexRows = (index: string): string[] => index.split('\n').flatMap((l) => {
  const m = /^\| \[[^\]]*\]\(([^)]*)\/\) \| ([^|]*) \| [^|]* \| [^|]* \| ([^|]*) \| [^|]* \|$/.exec(l);
  return m === null ? [] : [`${decodeURI(m[1]!)} · ${m[2]} · ${m[3]}`];
});

async function threeItems(): Promise<string> {
  const dir = project();
  assert.equal((await cli(dir, ['item', 'new', 'beta', '--type', 'feature', '--scope', 'bounded'])).code, 0);
  assert.equal((await cli(dir, ['item', 'new', 'alpha', '--type', 'refactor', '--scope', 'bounded'])).code, 0);
  write(join(dir, '.burhan', 'work', '003-gamma', '003-gamma-story.md'), '- **Status:** Approved — Sam · 2026-11-16\n- **Route:** change / bounded\n');
  return dir;
}

test('item list prints one line per item (the full id, the route, the state), the same rows and order as status', async () => {
  const dir = await threeItems();
  const list = await cli(dir, ['item', 'list']);
  assert.equal(list.code, 0, list.err);
  assert.equal(list.out, '003-gamma · change / bounded · Spec ready\nalpha · refactor / bounded · Draft\nbeta · feature / bounded · Draft\n');
  assert.deepEqual(list.out.split('\n').slice(0, -1), indexRows((await cli(dir, ['status'])).out));
});

test('item list writes nothing', async () => {
  const dir = await threeItems();
  const files = readdirSync(join(dir, '.burhan'), { recursive: true }).map(String).sort();
  const state = read(join(dir, STATE));
  assert.equal((await cli(dir, ['item', 'list'])).code, 0);
  assert.deepEqual(readdirSync(join(dir, '.burhan'), { recursive: true }).map(String).sort(), files);
  assert.equal(existsSync(join(dir, '.burhan', 'work', 'README.md')), false, 'the index is not regenerated');
  assert.equal(read(join(dir, STATE)), state);
});

test('item list with no item says so and exits 0', async () => {
  const dir = project();
  const none = await cli(dir, ['item', 'list']);
  assert.equal(none.code, 0, none.err);
  assert.equal(none.out, 'no work items under .burhan/work/\n');
  mkdirSync(join(dir, '.burhan', 'work'), { recursive: true });
  assert.equal((await cli(dir, ['item', 'list'])).out, 'no work items under .burhan/work/\n');
});

test('item list takes [dir] and --docs, and refuses a second argument', async () => {
  const dir = await threeItems();
  assert.equal((await cli(dir, ['item', 'list', dir])).out, (await cli(dir, ['item', 'list'])).out);
  write(join(dir, 'other', 'x', 'x-story.md'), '- **Status:** Draft\n- **Route:** bug / bounded\n');
  assert.equal((await cli(dir, ['item', 'list', '--docs', 'other'])).out, 'x · bug / bounded · Draft\n');
  const two = await cli(dir, ['item', 'list', dir, 'extra']);
  assert.equal(two.code, 2);
  assert.match(two.err, /unexpected argument: extra/);
});
