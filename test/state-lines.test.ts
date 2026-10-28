import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatClosedLine, parseClosedLine, OUTCOMES } from '../src/hooks/core/state-lines.mjs';

const ok = { slug: 'workflow-engine', route: 'feature / architectural', outcome: 'QC PASS', commit: '5ae9a09', folder: '.internal/work/workflow-engine' };

test('a closed line has one shape: slug · type / scope · outcome · commit · folder', () => {
  assert.equal(formatClosedLine(ok), '- workflow-engine · feature / architectural · QC PASS · 5ae9a09 · .internal/work/workflow-engine');
});

test('format and parse round-trip for every outcome and for "uncommitted"', () => {
  for (const outcome of OUTCOMES) {
    for (const commit of ['5ae9a09', 'uncommitted']) {
      const line = formatClosedLine({ ...ok, outcome, commit });
      assert.deepEqual(parseClosedLine(line), { ...ok, outcome, commit });
    }
  }
});

test('anything that is not exactly the shape parses to null', () => {
  for (const bad of [
    '- workflow-engine · feature / architectural · QC PASS · 5ae9a09',                                  // 4 parts
    '- workflow-engine · feature / architectural · QC PASS · 5ae9a09 · a · b',                          // 6 parts
    '- workflow-engine · feature / huge · QC PASS · 5ae9a09 · f',                                       // route
    '- workflow-engine · feature / architectural · Finished · 5ae9a09 · f',                             // outcome
    '- workflow-engine · feature / architectural · QC PASS · XYZ · f',                                   // commit
    '- Workflow Engine · feature / architectural · QC PASS · 5ae9a09 · f',                              // slug
    'workflow-engine · feature / architectural · QC PASS · 5ae9a09 · f',                                // no bullet
    '- 0.2 line: v022-patch · install-ux · v021-polish',                                                // a folded line
  ]) assert.equal(parseClosedLine(bad), null, bad);
});

test('a 200,000-character line is read in linear time', () => {
  const started = Date.now();
  assert.equal(parseClosedLine('- ' + 'a · '.repeat(50000)), null);
  assert.equal(parseClosedLine('- ' + 'x'.repeat(200000)), null);
  assert.ok(Date.now() - started < 2000);
});
