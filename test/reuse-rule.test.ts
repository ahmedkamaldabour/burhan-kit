import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Tests run from .test-build/test, so the repository root is two levels up.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const kit = (rel: string): string => readFileSync(join(ROOT, 'kit', rel), 'utf8').replace(/[`*]/g, '').replace(/\s+/g, ' ');
const RULE = [
  'One passing run of the full suite',
  'after the last code edit is enough for verification, QC and the commit',
  'run it again only if code or tests changed since',
  'docs, CHANGELOG, ROADMAP and comments do not count',
  'A QC confirmation round runs the tests of the changed areas, unless the fix lands outside the findings',
];

test('the reuse rule is written once, in stage-finish.md, and the other files point at it', () => {
  const finish = kit('phases/stage-finish.md');
  assert.ok(finish.includes('Reusing a full run'));
  for (const p of RULE) assert.ok(finish.includes(p), `stage-finish.md lacks: ${p}`);
  for (const f of ['phases/stage-build.md', 'commands/qc.md', 'templates/plan.md']) {
    const text = kit(f);
    assert.ok(text.includes('Reusing a full run'), `${f} does not point at the rule`);
    assert.ok(text.includes('stage-finish.md'), `${f} does not name the file`);
    for (const p of RULE) assert.ok(!text.includes(p), `${f} repeats the rule: ${p}`);
  }
});

test('the rule names the line that tells whether a full run exists, and what the ledger cannot see', () => {
  const finish = kit('phases/stage-finish.md');
  for (const p of ['full run:', 'burhan guide', 'burhan evidence --item', 'WF_FULL_TEST_REGEX', 'a shell edit (sed -i, a script)']) assert.ok(finish.includes(p), p);
});
