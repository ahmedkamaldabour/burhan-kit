import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { run } from '../../src/hooks/main.mjs';
import { relPath } from '../../src/hooks/core/lib.mjs';
import { tmpDir } from '../helpers.js';

// Files saved under <docs>/<slug>/sources/ are originals, not work: no turn-end gate looks at them (item sources-gates).
const D = '.burhan/work';
interface Opts { files: Record<string, string>; text?: string; skills?: string[]; code?: string; route?: string; extra?: Record<string, string> }

/** Runs the built turn-audit hook in a scratch project whose turn created every file in `files`; returns its message. */
async function audit({ files, text = 'saved', skills = ['superpowers:brainstorming', 'superpowers:writing-plans', 'superpowers:requesting-code-review', 'superpowers:verification-before-completion'], code = '', route = 'change / bounded', extra = {} }: Opts): Promise<string> {
  const project = tmpDir('burhan-sources-gates-project-');
  const store = tmpDir('burhan-sources-gates-store-');
  mkdirSync(join(project, '.burhan/local'), { recursive: true });
  const config = ['WF_DOCS_DIR=.burhan/work', 'WF_DISCOVERY_DIR=.burhan/disc', 'WF_STATE_FILE=.burhan/local/PROGRESS.md', 'WF_SKILLS=superpowers', `WF_EVIDENCE_DIR='${store}'`];
  if (code !== '') config.push(`WF_CODE_REGEX='${code}'`);
  writeFileSync(join(project, '.burhan/workflow.config'), config.join('\n') + '\n');
  writeFileSync(join(project, '.burhan/local/PROGRESS.md'), `# s\n## Now\n### foo\n- **Route:** ${route}\n## Waiting on you\n`);
  for (const [file, body] of Object.entries({ ...files, ...extra })) { const path = join(project, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); }
  const turn = { files_created: Object.keys(files).map((f) => join(project, f)), files_edited: [], shell_commands: [], skills_used: skills, assistant_text: text, steps: [] };
  const r = await run(['core', 'turn-audit'], JSON.stringify({ event: 'turn_end', session: 'S', project_dir: project, turn }), { ...process.env, WF_EVIDENCE_DIR: store });
  return r.stdout;
}
const STALE = '**Status:** Draft\n✅ Reviewed\n';
const none = (out: string): void => assert.equal(out, '', out);

// ---- AC-01 / AC-02: a saved source warns about nothing ----
test('a plain source gives no state warning', async () => none(await audit({ files: { [`${D}/foo/sources/report.md`]: 'notes\n' } })));
test('a script in sources/ gives no state warning', async () => none(await audit({ files: { [`${D}/foo/sources/run.sh`]: 'echo hi\n' } })));
test('a source at any depth gives no state warning', async () => none(await audit({ files: { [`${D}/foo/sources/a/b/c.md`]: 'x\n' } })));
test('a source quoting Draft and Reviewed gives no stale-status warning', async () => none(await audit({ files: { [`${D}/foo/sources/old.md`]: STALE } })));

// ---- AC-03 / AC-04: real item files are judged as before ----
test('a source plus a story with the state file untouched still warns (state transition)', async () => {
  const out = await audit({ files: { [`${D}/foo/sources/report.md`]: 'x\n', [`${D}/foo/foo-story.md`]: '**Status:** Draft\n' } });
  assert.match(out, /STATE-TRANSITION GATE/u);
});
test('a story with a real Draft + Reviewed conflict still warns (stale status)', async () => {
  const out = await audit({ files: { [`${D}/foo/foo-story.md`]: STALE } });
  assert.match(out, /STALE-STATUS GATE[^"]*foo-story\.md/u);
});
test('a source plus a stale story names only the story in the stale-status warning', async () => {
  const out = await audit({ files: { [`${D}/foo/sources/old.md`]: STALE, [`${D}/foo/foo-story.md`]: STALE } });
  assert.match(out, /STALE-STATUS GATE: `\.burhan\/work\/foo\/foo-story\.md` says/u);
  assert.doesNotMatch(out, /sources\/old\.md/u);
});

// ---- AC-05: the exact shape only ----
test('an item whose slug is "sources" is still audited', async () => {
  const out = await audit({ files: { [`${D}/sources/sources-story.md`]: STALE } });
  assert.match(out, /STATE-TRANSITION GATE/u);
  assert.match(out, /STALE-STATUS GATE/u);
});
test('a file named sources.md in an item is still audited', async () => {
  assert.match(await audit({ files: { [`${D}/foo/sources.md`]: 'x\n' } }), /STATE-TRANSITION GATE/u);
});
test('a folder named like sources but longer is still audited', async () => {
  assert.match(await audit({ files: { [`${D}/foo/sources-old/x.md`]: 'x\n' } }), /STATE-TRANSITION GATE/u);
});

// ---- AC-06: a source named like an item file raises no skill, baseline or QC check ----
test('a source named *-story.md raises no story skill gate', async () => none(await audit({ files: { [`${D}/foo/sources/old-story.md`]: 'pasted\n' }, skills: [] })));
test('a source named *-implementation-plan.md raises no plan skill gate', async () => none(await audit({ files: { [`${D}/foo/sources/x-implementation-plan.md`]: 'p\n' }, skills: [] })));
test('a source under sources/reviews/ raises no review skill gate', async () => none(await audit({ files: { [`${D}/foo/sources/reviews/z.md`]: 'r\n' }, skills: [] })));
test('a source plus a completion claim raises no verify skill gate', async () => none(await audit({ files: { [`${D}/foo/sources/report.md`]: 'x\n' }, text: 'done, all tests pass', skills: [] })));
test('control: a real story without brainstorming still raises the story skill gate', async () => {
  assert.match(await audit({ files: { [`${D}/foo/foo-story.md`]: '**Status:** Draft\n' }, skills: [] }), /SKILL GATE \(story\)/u);
});
test('control: a real plan, review and a claim after real work still raise their skill gates', async () => {
  const out = await audit({ files: { [`${D}/foo/foo-implementation-plan.md`]: 'p\n', [`${D}/foo/reviews/foo-review.md`]: 'r\n' }, text: 'done', skills: [] });
  assert.match(out, /SKILL GATE \(plan\)/u);
  assert.match(out, /SKILL GATE: a review file/u);
  assert.match(out, /SKILL GATE \(verify\)/u);
});
test('a source under sources/reviews/ named like a QC report raises no QC check', async () => none(await audit({ files: { [`${D}/foo/sources/reviews/y-qc.md`]: 'q\n' } })));

// ---- baseline gate: a brownfield project with no baseline ----
test('a source named *-story.md raises no baseline gate; a real story does', async () => {
  const brown = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`src/m${i}.ts`, 'export {};\n'])); // BROWNFIELD_MIN_SOURCE_FILES = 10
  const source = await audit({ files: { [`${D}/foo/sources/old-story.md`]: 'pasted\n' }, code: '\\.ts$', extra: brown });
  assert.doesNotMatch(source, /BASELINE GATE/u, source);
  const real = await audit({ files: { [`${D}/foo/foo-story.md`]: '**Status:** Draft\n' }, code: '\\.ts$', extra: brown });
  assert.match(real, /BASELINE GATE/u, real);
});

// ---- AC-11: code-pattern checks ignore a script saved as a source ----
test('a .sh source that matches the code pattern raises no code, verification or read-only check', async () => {
  const out = await audit({ files: { [`${D}/foo/sources/run.sh`]: 'echo hi\n' }, code: '\\.sh$', text: 'done and passing', skills: [], route: 'investigation / bounded' });
  none(out);
});
test('control: the same .sh script outside sources/ still raises them', async () => {
  const out = await audit({ files: { [`${D}/foo/repro/run.sh`]: 'echo hi\n' }, code: '\\.sh$', text: 'done and passing', skills: [], route: 'investigation / bounded' });
  assert.match(out, /VERIFICATION GATE/u);
  assert.match(out, /SKILL GATE \(code\)/u);
  assert.match(out, /READ-ONLY GATE/u);
});

// ---- AC-07: the form the gates see on Windows ----
test('a Windows path reaches the gates project-relative and slash-separated, so the same shape matches', () => {
  const rel = relPath('C:\\proj\\.burhan\\work\\foo\\sources\\a.md', 'C:\\proj', true);
  assert.equal(rel, '.burhan/work/foo/sources/a.md');
  assert.match(rel, /^\.burhan\/work\/[^/]+\/sources\//u);
});
