import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { run } from '../../src/hooks/main.mjs';
import { tmpDir } from '../helpers.js';

// STALE-STATUS judges only files that carry a status: markdown in the item folder or its reviews/, and the discoveries
// (item stale-status-item-files-only). Raw output and notes saved elsewhere in an item folder are never judged.
const D = '.burhan/work';
const STALE = '**Status:** Draft\n✅ Reviewed\n';

/** Runs the built turn-audit hook in a scratch project whose turn created every file in `files`; returns its message. */
async function audit(files: Record<string, string>): Promise<string> {
  const project = tmpDir('burhan-stale-files-project-');
  const store = tmpDir('burhan-stale-files-store-');
  mkdirSync(join(project, '.burhan/local'), { recursive: true });
  writeFileSync(join(project, '.burhan/workflow.config'), ['WF_DOCS_DIR=.burhan/work', 'WF_DISCOVERY_DIR=.burhan/disc', 'WF_STATE_FILE=.burhan/local/PROGRESS.md', `WF_EVIDENCE_DIR='${store}'`].join('\n') + '\n');
  writeFileSync(join(project, '.burhan/local/PROGRESS.md'), '# s\n## Now\n### foo\n- **Route:** change / bounded\n## Waiting on you\n');
  for (const [file, body] of Object.entries(files)) { const path = join(project, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); }
  const turn = { files_created: Object.keys(files).map((f) => join(project, f)), files_edited: [], shell_commands: [], skills_used: [], assistant_text: 'saved', steps: [] };
  return (await run(['core', 'turn-audit'], JSON.stringify({ event: 'turn_end', session: 'S', project_dir: project, turn }), { ...process.env, WF_EVIDENCE_DIR: store })).stdout;
}
const stale = (out: string): boolean => /STALE-STATUS GATE/u.test(out);

// ---- AC-01: raw output of any non-markdown kind is never judged ----
for (const file of [`${D}/foo/repro/red.txt`, `${D}/foo/data.json`, `${D}/foo/reviews/raw.txt`, `${D}/foo/repro/run.sh`]) {
  test(`${file.slice(D.length + 1)} with Draft and Reviewed raises no stale-status warning`, async () => {
    const out = await audit({ [file]: STALE });
    assert.equal(stale(out), false, out);
  });
}

// ---- AC-02: markdown in a subfolder other than reviews/ is not judged ----
for (const file of [`${D}/foo/repro/notes.md`, `${D}/foo/reviews/sub/deep.md`, `${D}/foo/other/x.md`]) {
  test(`${file.slice(D.length + 1)} with Draft and Reviewed raises no stale-status warning`, async () => {
    const out = await audit({ [file]: STALE });
    assert.equal(stale(out), false, out);
  });
}

// ---- AC-03: files that carry a status are judged as before ----
for (const file of [`${D}/foo/foo-story.md`, `${D}/foo/foo-plan.md`, `${D}/foo/foo-implementation-plan.md`, `${D}/foo/foo-findings.md`, `${D}/foo/notes.md`,
  `${D}/foo/reviews/foo-review.md`, `${D}/foo/reviews/foo-qc.md`, '.burhan/disc/2026-10-24-x.md']) {
  test(`control: ${file.replace(D + '/', '').replace('.burhan/', '')} with Draft and Reviewed still raises the stale-status warning`, async () => {
    const out = await audit({ [file]: STALE });
    assert.equal(stale(out), true, out);
    assert.ok(out.includes(`\`${file}\``), out);
  });
}
test('control: an item whose slug is "sources" is still judged', async () => {
  assert.equal(stale(await audit({ [`${D}/sources/sources-story.md`]: STALE })), true);
});

// ---- AC-04: the rest of gate E is unchanged ----
test('README.md and a .log at the item root are still skipped', async () => {
  assert.equal(stale(await audit({ [`${D}/foo/README.md`]: STALE, [`${D}/foo/run.log`]: STALE })), false);
});
test('a Draft and Reviewed pair inside a fenced block is still ignored', async () => {
  assert.equal(stale(await audit({ [`${D}/foo/foo-story.md`]: '```\n**Status:** Draft\n✅ Reviewed\n```\n' })), false);
});

// ---- AC-05: the state-transition warning is not changed by this item ----
test('a raw output in repro/ still gets the state-transition warning (that gate is not part of this item)', async () => {
  assert.match(await audit({ [`${D}/foo/repro/red.txt`]: STALE }), /STATE-TRANSITION GATE/u);
});
test('a stale story reports only the story, not a raw output saved next to it', async () => {
  const out = await audit({ [`${D}/foo/foo-story.md`]: STALE, [`${D}/foo/repro/red.txt`]: STALE });
  assert.match(out, /STALE-STATUS GATE: `\.burhan\/work\/foo\/foo-story\.md` says/u);
  assert.doesNotMatch(out, /repro\/red\.txt` says/u);
});
