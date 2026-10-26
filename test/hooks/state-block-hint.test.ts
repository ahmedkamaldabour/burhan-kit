import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { run } from '../../src/hooks/main.mjs';
import { tmpDir } from '../helpers.js';

// When work files are written under <docs>/<slug>/ and the state file has no block for <slug>, the STATE-TRANSITION warning says so
// (item skills-link-and-shell-writes, sub-unit 4): without a block burhan cannot link the session, and its skills and evidence go under no item.
const D = 'AI_SPEC/docs';
const OLD = '⚠ STATE-TRANSITION GATE: a work-item file changed this turn but `.burhan/local/PROGRESS.md` was not updated. Write every transition before the turn ends (WORKFLOW §5): edit the existing line in place — no new paragraph, no copied detail (link the file).';
const BLOCK = (slug: string): string => `### ${slug}\n- **Route:** change / bounded\n`;

/** `state`: the state file text, or null for no state file. Every file in `files` is created this turn. */
async function audit(state: string | null, files: string[], over: { stateWritten?: boolean } = {}): Promise<string> {
  const project = tmpDir('burhan-block-hint-project-');
  const store = tmpDir('burhan-block-hint-store-');
  mkdirSync(join(project, '.burhan/local'), { recursive: true });
  writeFileSync(join(project, '.burhan/workflow.config'), [`WF_DOCS_DIR=${D}`, 'WF_DISCOVERY_DIR=AI_SPEC/discovery', 'WF_STATE_FILE=.burhan/local/PROGRESS.md', `WF_EVIDENCE_DIR='${store}'`].join('\n') + '\n');
  if (state !== null) writeFileSync(join(project, '.burhan/local/PROGRESS.md'), state);
  const made = files.map((f) => join(project, f));
  for (const f of made) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, 'plain text\n'); }
  const edited = over.stateWritten ? [join(project, '.burhan/local/PROGRESS.md')] : [];
  const turn = { files_created: made, files_edited: edited, shell_commands: [], skills_used: [], assistant_text: 'saved', steps: [] };
  return (await run(['core', 'turn-audit'], JSON.stringify({ event: 'turn_end', session: 'S', project_dir: project, turn }), { ...process.env, WF_EVIDENCE_DIR: store })).stdout;
}
const EMPTY = '# s\n## Now\n## Waiting on you\n';
const message = (out: string): string => (out === '' ? '' : (JSON.parse(out) as { message: string }).message);

test('state file with no block, a story written → the warning names the slug and what to add', async () => {
  const m = message(await audit(EMPTY, [`${D}/foo/foo-story.md`]));
  assert.ok(m.startsWith(OLD), m);
  assert.match(m, / `foo` has no block under "Now" in `\.burhan\/local\/PROGRESS\.md`: burhan cannot link this session to it, so its skills and evidence are recorded under no item\. Add a `### foo` block \(route, mode\)\./u);
});
test('another item has a block but not this one → still named', async () => {
  assert.match(message(await audit(EMPTY.replace('## Now\n', `## Now\n${BLOCK('other')}`), [`${D}/foo/foo-story.md`])), / `foo` has no block/u);
});
test('two slugs without blocks → both named', async () => {
  const m = message(await audit(EMPTY, [`${D}/foo/foo-story.md`, `${D}/bar/bar-story.md`]));
  assert.match(m, / `bar`, `foo` have no block/u);
  assert.match(m, /Add a `### bar` and a `### foo` block \(route, mode\)\./u);
});
test('a block for the slug exists → the old text, exactly', async () => {
  assert.equal(message(await audit(EMPTY.replace('## Now\n', `## Now\n${BLOCK('foo')}`), [`${D}/foo/foo-story.md`])), OLD);
});
test('no state file at all → the old text, exactly', async () => {
  assert.equal(message(await audit(null, [`${D}/foo/foo-story.md`])), OLD);
});
test('the state file written in the same turn → the state-transition warning stays silent', async () => {
  assert.equal(await audit(EMPTY, [`${D}/foo/foo-story.md`], { stateWritten: true }), '');
});
test('a saved source only → nothing at all', async () => {
  assert.equal(await audit(EMPTY, [`${D}/foo/sources/report.md`]), '');
});
test('a block for one slug and a file of another → only the slug without a block is named', async () => {
  const m = message(await audit(EMPTY.replace('## Now\n', `## Now\n${BLOCK('foo')}`), [`${D}/foo/foo-story.md`, `${D}/bar/bar-story.md`]));
  assert.match(m, / `bar` has no block/u);
  assert.doesNotMatch(m, /`foo` has no block|`foo`, /u);
});
