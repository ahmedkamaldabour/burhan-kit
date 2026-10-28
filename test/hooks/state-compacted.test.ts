import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers.js';
import { run } from '../../src/hooks/main.mjs';
import { itemBlock, itemField, itemRoute, itemSlugs, nowSection } from '../../src/hooks/core/lib.mjs';

// AC-04: a state file whose closed items are one-line bullets works in every reader that opens it.
const CLOSED = [
  '- alpha · feature / architectural · QC PASS · 5ae9a09 · .internal/work/alpha',
  '- beta · refactor / bounded · Done (no QC) · uncommitted · .internal/work/beta',
];
const LIVE = '### gamma\n- **Route:** change / bounded · **Mode:** auto\n- building sub-unit 2\n';
const FILE = ['# PROGRESS', '', '## Now', ...CLOSED, '', LIVE, '## Waiting on you', '- nothing', ''].join('\n');

test('the Now readers see the same item in flight with closed lines present', () => {
  const now = nowSection(FILE);
  assert.deepEqual(itemSlugs(now), ['gamma'], 'a closed bullet is not an item in flight');
  const block = itemBlock(now, 'gamma');
  assert.equal(itemRoute(block), 'change / bounded');
  assert.equal(itemField(block, 'Mode'), 'auto');
  assert.ok(!block.includes('alpha'), 'the closed lines are not part of the item block');
});

test('session start shows the closed lines and the linked block, and does not fail', async () => {
  const project = tmpDir('burhan-compacted-project-');
  const store = tmpDir('burhan-compacted-store-');
  mkdirSync(join(project, '.burhan/local'), { recursive: true });
  writeFileSync(join(project, '.burhan/workflow.config'), ['WF_DOCS_DIR=.internal/work', 'WF_STATE_FILE=.burhan/local/PROGRESS.md', `WF_EVIDENCE_DIR='${store}'`].join('\n') + '\n');
  writeFileSync(join(project, '.burhan/local/PROGRESS.md'), FILE);
  const out = await run(['core', 'session-gates'], JSON.stringify({ event: 'session_start', project_dir: project, session: 'S1' }), { ...process.env, WF_EVIDENCE_DIR: store });
  assert.equal(out.debug, '');
  assert.match(out.stdout, /alpha · feature \/ architectural · QC PASS · 5ae9a09/);
  assert.match(out.stdout, /### gamma/);
});

test('the state-size gate counts a compacted file by its lines, and the transition gate is quiet when the file was written', async () => {
  const project = tmpDir('burhan-compacted-gates-');
  const store = tmpDir('burhan-compacted-gates-store-');
  mkdirSync(join(project, '.burhan/local'), { recursive: true });
  mkdirSync(join(project, '.internal/work/gamma'), { recursive: true });
  writeFileSync(join(project, '.burhan/workflow.config'), ['WF_DOCS_DIR=.internal/work', 'WF_STATE_FILE=.burhan/local/PROGRESS.md', 'WF_STATE_BUDGET=80', `WF_EVIDENCE_DIR='${store}'`].join('\n') + '\n');
  const state = join(project, '.burhan/local/PROGRESS.md');
  writeFileSync(state, FILE);
  const doc = join(project, '.internal/work/gamma/gamma-story.md');
  writeFileSync(doc, 'text\n');
  const turn = { files_created: [], files_edited: [doc, state], shell_commands: [], skills_used: [], assistant_text: 'saved', steps: [] };
  const out = await run(['core', 'turn-audit'], JSON.stringify({ event: 'turn_end', session: 'S1', project_dir: project, turn }), { ...process.env, WF_EVIDENCE_DIR: store });
  assert.doesNotMatch(out.stdout, /STATE-SIZE GATE|STATE-TRANSITION GATE/);
});
