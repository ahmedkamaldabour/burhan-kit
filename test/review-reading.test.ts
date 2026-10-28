import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli, itemDir, projectWithItem, read, write } from './item-fixture.js';

const kit = (file: string): string => readFileSync(fileURLToPath(new URL(`../../kit/${file}`, import.meta.url)), 'utf8').replace(/[`*]/g, '').replace(/\s+/g, ' ');

test('the Assess step reads the review file by need; the QC step still reads everything', () => {
  const e2e = kit('commands/e2e.md');
  assert.ok(e2e.includes('and reviews/ by need: the QC and verification reports in full, and of the review file its headings, the sections of sub-units not yet Reviewed and the latest fix round'));
  assert.ok(e2e.includes('open a closed section only when a finding of it is named or the plan says so (QC reads everything)'));
  assert.ok(!e2e.includes('everything in reviews/'), 'the Assess step no longer reads everything');
  assert.ok(kit('commands/qc.md').includes('everything in reviews/'), 'QC keeps reading everything');
});

test('a finding row is the claim, the location and the result; long output goes to reviews/evidence/ (the rule lives in phases/review.md only)', () => {
  const review = kit('phases/review.md');
  assert.ok(review.includes('A finding row is the claim, the location and the result in one line.'));
  assert.ok(review.includes('reviews/evidence/<slug>-su<N>.md'));
  assert.ok(review.includes('is carried forward (phases/discoveries.md)'));
  assert.ok(!kit('templates/review.md').includes('A finding row is the claim'), 'one place per rule');
  assert.ok(kit('templates/review.md').includes('reviews/evidence/'));
  assert.ok(kit('phases/files.md').includes('reviews/evidence/<slug>-su<N>.md'));
});

test('a file under reviews/evidence/ changes nothing for item check or guide', async () => {
  const dir = await projectWithItem();
  const asked = async (): Promise<string[]> => (await Promise.all([cli(dir, ['item', 'check', 'foo']), cli(dir, ['guide', 'foo'])])).map((r) => `${r.code}|${r.out}|${r.err}`);
  const before = await asked();
  write(join(itemDir(dir), 'reviews', 'evidence', 'foo-su1.md'), '# evidence\nlong output\n');
  assert.deepEqual(await asked(), before);
});

test('review add and the Reviewed gate still work when an evidence file exists', async () => {
  const dir = await projectWithItem();
  write(join(itemDir(dir), 'reviews', 'evidence', 'foo-su1.md'), '# evidence\n');
  const r = await cli(dir, ['review', 'add', 'foo', '--kind', 'review', '--unit', '1', '--by', 'claude · claude-sonnet-5-5 · fresh subagent', '--text', 'PASS: nothing found']);
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(read(join(itemDir(dir), 'reviews', 'foo-review.md')), /Sub-unit 1/);
});
