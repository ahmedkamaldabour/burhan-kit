import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { capture, tmpDir } from '../helpers.js';
import { run } from '../../src/hooks/main.mjs';
import { linkItem, projectKey } from '../../src/hooks/core/store.mjs';
import { readLedger, summarizeLedger } from '../../src/lib/evidence.js';
import { runCli } from '../../src/main.js';

// Item 010-single-block-fallback: the ledger lines and the skill memory of a turn that wrote only the files of an item with no block are
// filed under no item when the state file has exactly one block and the session is not linked. No config file: the defaults apply
// (docs folder `.burhan/work`, state file `.burhan/local/PROGRESS.md`).
const D = '.burhan/work';
const ONE = '### other\n- **Route:** change / bounded\n';
const TWO = `${ONE}### beta\n- **Route:** change / bounded\n`;
const FOO = `${D}/foo/foo-story.md`;
const OTHER = `${D}/other/other-story.md`;

interface Scene { project: string; root: string; env: NodeJS.ProcessEnv }
function scene(blocks: string): Scene {
  const project = tmpDir('burhan-single-block-project-');
  const root = tmpDir('burhan-single-block-store-');
  mkdirSync(join(project, '.burhan/local'), { recursive: true });
  writeFileSync(join(project, '.burhan/WORKFLOW.md'), '# burhan\n');
  writeFileSync(join(project, '.burhan/local/PROGRESS.md'), `## Now\n${blocks}`);
  return { project, root, env: { ...process.env, WF_EVIDENCE_DIR: root, WF_EVIDENCE_LEDGER: 'on' } };
}

let n = 0;
/** One Stop. `files` (project-relative) are written this turn, as edit steps; `created` says they are new files; `cmds` run as cmd steps. Returns stdout. */
async function stop(s: Scene, session: string, o: { files?: string[]; cmds?: string[]; skills?: string[]; created?: boolean } = {}): Promise<string> {
  const files = (o.files ?? []).map((file) => join(s.project, file));
  for (const file of files) { mkdirSync(dirname(file), { recursive: true }); if (!existsSync(file)) writeFileSync(file, '# x\n'); }
  const cmds = o.cmds ?? [];
  const steps = [
    ...files.map((file, i) => ({ seq: i + 1, kind: 'edit', file })),
    ...cmds.map((cmd, i) => ({ seq: files.length + i + 1, kind: 'cmd', cmd, exit: 0, status: 'ok' })),
  ];
  const turn = { files_created: o.created ? files : [], files_edited: o.created ? [] : files, shell_commands: cmds, skills_used: o.skills ?? [], assistant_text: '', steps };
  const event = { event: 'turn_end', agent: 'claude', project_dir: s.project, session, turn_id: `T${++n}`, turn_scope: 'whole', turn, reentrant: false };
  return (await run(['core', 'turn-audit'], JSON.stringify(event), s.env)).stdout;
}
const rows = (s: Scene) => readLedger(s.project, { WF_EVIDENCE_DIR: s.root });
const itemsOf = (s: Scene) => rows(s).map((row) => row.item ?? null);
const sessionDir = (s: Scene, session: string): string => join(s.root, projectKey(s.project), session);
const staleLink = (s: Scene, session: string): void => { mkdirSync(sessionDir(s, session), { recursive: true }); writeFileSync(join(sessionDir(s, session), 'item'), 'closed\n'); };

test('AC-01: one block, no link, a turn that writes only the files of an item with no block -> every ledger line has no item', async () => {
  const s = scene(ONE);
  await stop(s, 'S1', { files: [FOO], cmds: ['ls foo'], skills: ['burhan-story'], created: true });
  assert.deepEqual(rows(s).map((row) => row.kind), ['edit', 'cmd', 'skill']);
  assert.deepEqual(itemsOf(s), [null, null, null]);
});

test('AC-02: the same state, a turn that writes the block\'s own files -> the lines have the block\'s item', async () => {
  const s = scene(ONE);
  await stop(s, 'S1', { files: [OTHER], cmds: ['ls other'], skills: ['burhan-story'], created: true });
  assert.deepEqual(itemsOf(s), ['other', 'other', 'other']);
});

test('AC-03: a code file outside the docs folder, commands only, or the docs index -> today\'s fallback to the block', async () => {
  const code = scene(ONE);
  await stop(code, 'S1', { files: ['src/a.ts'], cmds: ['ls'] });
  assert.deepEqual(itemsOf(code), ['other', 'other']);
  const cmds = scene(ONE);
  await stop(cmds, 'S1', { cmds: ['ls', 'npm test'] });
  assert.deepEqual(itemsOf(cmds), ['other', 'other']);
  const index = scene(ONE);
  await stop(index, 'S1', { files: [`${D}/README.md`] });
  assert.deepEqual(itemsOf(index), ['other']);
  const mixed = scene(ONE);
  await stop(mixed, 'S1', { files: [FOO, 'src/a.ts'] });
  assert.deepEqual(itemsOf(mixed), ['other', 'other'], 'only the files of another item decide');
});

test('Q-3: a turn that writes the files of the block and of another item -> the block', async () => {
  const s = scene(ONE);
  await stop(s, 'S1', { files: [FOO, OTHER] });
  assert.deepEqual(itemsOf(s), ['other', 'other']);
});

test('AC-04: a live link wins over this rule', async () => {
  const s = scene(ONE);
  linkItem(s.project, 'S1', 'other', ['other'], { WF_EVIDENCE_DIR: s.root });
  await stop(s, 'S1', { files: [FOO], cmds: ['ls foo'] });
  assert.deepEqual(itemsOf(s), ['other', 'other']);
});

test('AC-05: several blocks and no link, several blocks and a stale link, no block -> no item; one block and a stale link follows the rule', async () => {
  const several = scene(TWO);
  await stop(several, 'S1', { files: [FOO], cmds: ['ls'] });
  assert.deepEqual(itemsOf(several), [null, null]);
  const severalCode = scene(TWO);
  await stop(severalCode, 'S1', { files: ['src/a.ts'] });
  assert.deepEqual(itemsOf(severalCode), [null]);
  const stale = scene(TWO);
  staleLink(stale, 'S1');
  await stop(stale, 'S1', { files: [FOO] });
  assert.deepEqual(itemsOf(stale), [null]);
  const none = scene('');
  await stop(none, 'S1', { files: [FOO] });
  assert.deepEqual(itemsOf(none), [null]);
  const oneStaleFoo = scene(ONE);
  staleLink(oneStaleFoo, 'S1');
  await stop(oneStaleFoo, 'S1', { files: [FOO] });
  assert.deepEqual(itemsOf(oneStaleFoo), [null]);
  const oneStaleCode = scene(ONE);
  staleLink(oneStaleCode, 'S1');
  await stop(oneStaleCode, 'S1', { files: ['src/a.ts'] });
  assert.deepEqual(itemsOf(oneStaleCode), ['other']);
});

test('AC-06: `evidence --item other` has none of the foo turn; the foo turn has no item and its skill is counted under "(no item)"', async () => {
  const s = scene(ONE);
  await stop(s, 'S1', { files: [FOO], cmds: ['ls foo'], skills: ['burhan-story'], created: true });
  await stop(s, 'S1', { files: ['src/a.ts'], cmds: ['ls other'], skills: ['burhan-plan'] });
  const was = process.env.WF_EVIDENCE_DIR;
  process.env.WF_EVIDENCE_DIR = s.root;
  try {
    const mine = capture();
    assert.equal(await runCli(['evidence', s.project, '--item', 'other'], mine.io), 0);
    assert.match(mine.o.out, /ls other/);
    assert.doesNotMatch(mine.o.out, /ls foo|foo-story/);
    const all = capture();
    assert.equal(await runCli(['evidence', s.project, '--json'], all.io), 0);
    const parsed = JSON.parse(all.o.out) as Array<{ item?: string | null; cmd?: string }>;
    assert.equal(parsed.find((row) => row.cmd === 'ls foo')?.item ?? null, null);
    assert.equal(parsed.find((row) => row.cmd === 'ls other')?.item, 'other');
  } finally { if (was === undefined) delete process.env.WF_EVIDENCE_DIR; else process.env.WF_EVIDENCE_DIR = was; }
  assert.deepEqual(summarizeLedger(rows(s), '').skillsUsed, { '(no item)': ['burhan-story'], other: ['burhan-plan'] });
});

test('AC-08: the STATE-TRANSITION warning for foo (no block) is unchanged', async () => {
  const s = scene(ONE);
  const out = await stop(s, 'S1', { files: [FOO], created: true });
  const message = (JSON.parse(out) as { message: string }).message;
  assert.match(message, /^⚠ STATE-TRANSITION GATE: a work-item file changed this turn but `\.burhan\/local\/PROGRESS\.md` was not updated\./u);
  assert.match(message, / `foo` has no block under "Now" in `\.burhan\/local\/PROGRESS\.md`: burhan cannot link this session to it, so its skills and evidence are recorded under no item\. Add a `### foo` block \(route, mode\)\./u);
});

test('skill memory (write): the skills of a turn that wrote only the files of an item with no block are not filed under the block', async () => {
  const s = scene(ONE);
  await stop(s, 'S1', { files: [FOO], skills: ['burhan-story', 'burhan-build'], created: true });
  assert.equal(readFileSync(join(sessionDir(s, 'S1'), 'phaseskills'), 'utf8'), '*\tburhan-story\n*\tburhan-build\n', 'kept for the session, under no item');
  assert.equal(existsSync(join(sessionDir(s, 'S1'), 'skills')), false, 'no code-skill line without an item');
});

test('skill memory (write), control: the same skills in a turn of the block\'s own files are filed under the block', async () => {
  const s = scene(ONE);
  await stop(s, 'S1', { files: ['src/a.ts'], skills: ['burhan-story', 'burhan-build'] });
  assert.equal(readFileSync(join(sessionDir(s, 'S1'), 'phaseskills'), 'utf8'), 'other\tburhan-story\nother\tburhan-build\n');
  assert.equal(readFileSync(join(sessionDir(s, 'S1'), 'skills'), 'utf8'), 'other\tburhan-build\n');
});

test('skill memory (read): a story of an item with no block does not count the skill an earlier turn used for the block', async () => {
  const s = scene(ONE);
  await stop(s, 'S1', { files: ['src/a.ts'], skills: ['burhan-story'] }); // no link is made: the skill is remembered under the block by the fallback
  const foo = await stop(s, 'S1', { files: [FOO], created: true });
  assert.match(foo, /SKILL GATE \(story\)/, 'the skill was used for other, not for foo');
  const own = await stop(s, 'S1', { files: [`${D}/other/extra-story.md`], created: true });
  assert.doesNotMatch(own, /SKILL GATE \(story\)/, 'control: another story of the block still counts its earlier skill');
});

test('wiring: the two hooks that record a turn use the helper; the gates keep `sessionSlug`', () => {
  const text = (name: string): string => readFileSync(new URL(`../../../src/hooks/core/${name}.mts`, import.meta.url), 'utf8');
  assert.match(text('ledger'), /itemForTurn\(now, /);
  assert.doesNotMatch(text('ledger'), /itemResolved/);
  const audit = text('turn-audit');
  assert.equal((audit.match(/skillSlug\(auditCtx\)/g) ?? []).length, 4, 'two writes and two reads of the skill memory');
  assert.match(audit, /const resolvedSlug = \(audit: Audit\): string => sessionSlug\(audit\.ctx\);/);
});
