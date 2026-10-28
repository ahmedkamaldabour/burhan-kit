import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cli, project, STATE, write } from './item-fixture.js';
import { symlinkSkip, tmpDir } from './helpers.js';
import { itemSlugs, nowSection } from '../src/hooks/core/lib.mjs';

const DOCS = '.burhan/work'; // the fixture project's docs location (item-fixture.ts: itemDir)
const plan = (route: string, status: string): string => `# p\n- **Route:** ${route}\n- **Overall status:** ${status}\n- **Contract:** 1\n`;
const LONG = 'closed through the long way: ' + 'details '.repeat(60) + 'committed 5ae9a09 (not pushed)';
const FILE = (extra = ''): string => ['# State', '', '## Now', `- alpha: ${LONG}`, '- delta: still being built, see its folder', '', '### beta', '- **Route:** change / bounded · **Mode:** auto', `- beta: ${LONG}`, '', '## Commit instructions', `- gamma: ${LONG}`, '- short note about alpha', '', '## Waiting on you', '- nothing', extra, ''].join('\n');

function setup(): string {
  const dir = project();
  write(join(dir, DOCS, 'alpha', 'alpha-implementation-plan.md'), plan('refactor / bounded', 'Completed'));
  write(join(dir, DOCS, 'gamma', 'gamma-implementation-plan.md'), plan('refactor / bounded', 'Completed'));
  write(join(dir, DOCS, 'delta', 'delta-implementation-plan.md'), plan('refactor / bounded', 'In progress'));
  write(join(dir, DOCS, 'beta', 'beta-implementation-plan.md'), plan('refactor / bounded', 'Completed'));
  writeFileSync(join(dir, STATE), FILE());
  return dir;
}
const state = (dir: string): string => readFileSync(join(dir, STATE), 'utf8');

test('dry run is the default: it prints old and new and the words saved, and writes nothing', async () => {
  const dir = setup();
  const before = state(dir);
  const r = await cli(dir, ['state', 'compact']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /dry run/i);
  assert.match(r.out, /alpha · refactor \/ bounded · Done \(no QC\) · 5ae9a09 · \.burhan\/work\/alpha/);
  assert.match(r.out, /words/);
  assert.equal(state(dir), before, 'the state file is unchanged');
  assert.equal(existsSync(join(dir, STATE + '.bak')), false);
  assert.equal(existsSync(join(dir, DOCS, 'alpha', 'alpha-state-notes.md')), false);
});

test('--apply writes the short line, the notes file with the whole old line, and a backup', async () => {
  const dir = setup();
  const before = state(dir);
  const r = await cli(dir, ['state', 'compact', '--apply']);
  assert.equal(r.code, 0, r.err);
  const after = state(dir);
  assert.match(after, /^- alpha · refactor \/ bounded · Done \(no QC\) · 5ae9a09 · \.burhan\/work\/alpha$/m);
  assert.equal(readFileSync(join(dir, STATE + '.bak'), 'utf8'), before);
  assert.ok(readFileSync(join(dir, DOCS, 'alpha', 'alpha-state-notes.md'), 'utf8').includes(LONG));
  assert.ok(after.length < before.length);
});

test('a line with no commit id becomes "uncommitted"', async () => {
  const dir = setup();
  writeFileSync(join(dir, STATE), FILE().replace(`- alpha: ${LONG}`, '- alpha: closed, nothing committed yet'));
  await cli(dir, ['state', 'compact', '--apply']);
  assert.match(state(dir), /^- alpha · refactor \/ bounded · Done \(no QC\) · uncommitted · /m);
});

test('a ### block is never touched, closed or not (another session owns it)', async () => {
  const dir = setup();
  await cli(dir, ['state', 'compact', '--apply']);
  const now = nowSection(state(dir));
  assert.deepEqual(itemSlugs(now), ['beta']);
  assert.ok(state(dir).includes(`### beta\n- **Route:** change / bounded · **Mode:** auto\n- beta: ${LONG}`));
});

test('an item still in flight keeps its line', async () => {
  const dir = setup();
  await cli(dir, ['state', 'compact', '--apply']);
  assert.ok(state(dir).includes('- delta: still being built, see its folder'));
});

test('an old line under Commit instructions that names a closed item is shortened, with a pointer to the notes', async () => {
  const dir = setup();
  await cli(dir, ['state', 'compact', '--apply']);
  const line = state(dir).split('\n').find((l) => l.startsWith('- gamma'))!;
  assert.ok(line.length < LONG.length);
  assert.match(line, /full text: \.burhan\/work\/gamma\/gamma-state-notes\.md/);
  assert.ok(readFileSync(join(dir, DOCS, 'gamma', 'gamma-state-notes.md'), 'utf8').includes(LONG));
  assert.ok(state(dir).includes('- short note about alpha'), 'a short line stays');
});

test('text already in the item folder is not copied again', async () => {
  const dir = setup();
  write(join(dir, DOCS, 'alpha', 'reviews', 'x.md'), `kept here: alpha: ${LONG}\n`); // the exact old text (the line without its "- ")
  await cli(dir, ['state', 'compact', '--apply']);
  assert.equal(existsSync(join(dir, DOCS, 'alpha', 'alpha-state-notes.md')), false);
});

test('a second --apply finds nothing to do and changes nothing', async () => {
  const dir = setup();
  await cli(dir, ['state', 'compact', '--apply']);
  const once = state(dir);
  const r = await cli(dir, ['state', 'compact', '--apply']);
  assert.match(r.out, /nothing to compact/i);
  assert.equal(state(dir), once);
});

test('CRLF line endings are kept', async () => {
  const dir = setup();
  writeFileSync(join(dir, STATE), FILE().replace(/\n/g, '\r\n'));
  await cli(dir, ['state', 'compact', '--apply']);
  const after = state(dir);
  assert.ok(after.includes('\r\n') && !/[^\r]\n/.test(after));
});

test('state needs a known subcommand', async () => {
  const dir = setup();
  assert.equal((await cli(dir, ['state'])).code, 2);
  assert.equal((await cli(dir, ['state', 'tidy'])).code, 2);
});

test('a 200,000-character line is handled in bounded time', async () => {
  const dir = setup();
  writeFileSync(join(dir, STATE), FILE(`- alpha: ${'x '.repeat(100000)}`));
  const started = Date.now();
  const r = await cli(dir, ['state', 'compact']);
  assert.equal(r.code, 0, r.err);
  assert.ok(Date.now() - started < 5000);
});

test('with no docs folder for an item, its line is left as it is and the command says so', async () => {
  const dir = setup();
  writeFileSync(join(dir, STATE), FILE().replace('- alpha:', '- ghost:'));
  const r = await cli(dir, ['state', 'compact']);
  assert.match(r.out, /ghost.*(no folder|left as it is)/);
});

// Denied paths (plan section 6): nothing is written outside the project, whatever the state file, the notes file or the backup leads to.
const OUTSIDE = 'outside: must stay as it is\n';
function outsideFile(): string { const d = tmpDir('burhan-compact-outside-'); const f = join(d, 'outside.md'); writeFileSync(f, OUTSIDE); return f; }

test('a notes file that is a link leading outside is refused and nothing is written', { skip: symlinkSkip }, async () => {
  const dir = setup();
  const out = outsideFile();
  const before = state(dir);
  symlinkSync(out, join(dir, DOCS, 'alpha', 'alpha-state-notes.md'));
  const r = await cli(dir, ['state', 'compact', '--apply']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.equal(readFileSync(out, 'utf8'), OUTSIDE);
  assert.equal(state(dir), before);
  assert.equal(existsSync(join(dir, STATE + '.bak')), false);
});

test('a backup path that is a link leading outside is refused: the outside file and the state file are unchanged', { skip: symlinkSkip }, async () => {
  const dir = setup();
  const out = outsideFile();
  const before = state(dir);
  symlinkSync(out, join(dir, STATE + '.bak'));
  const r = await cli(dir, ['state', 'compact', '--apply']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.equal(readFileSync(out, 'utf8'), OUTSIDE);
  assert.equal(state(dir), before);
});

test('a state file that is a link leading outside is refused', { skip: symlinkSkip }, async () => {
  const dir = setup();
  const out = outsideFile();
  rmSync(join(dir, STATE));
  symlinkSync(out, join(dir, STATE));
  const r = await cli(dir, ['state', 'compact', '--apply']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.equal(readFileSync(out, 'utf8'), OUTSIDE);
});

test('a WF_STATE_FILE that points outside the project is refused', async () => {
  const dir = setup();
  const out = outsideFile();
  writeFileSync(join(dir, '.burhan', 'workflow.config'), `WF_STATE_FILE=${relative(dir, out).split('\\').join('/')}\n`);
  const r = await cli(dir, ['state', 'compact', '--apply']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.equal(readFileSync(out, 'utf8'), OUTSIDE);
});

test('a project reached through a link gets pointers relative to the project, not a chain of ../', { skip: symlinkSkip }, async () => {
  const dir = setup();
  const link = `${dir}-link`;
  symlinkSync(dir, link, 'dir');
  const r = await cli(link, ['state', 'compact']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /alpha · refactor \/ bounded · Done \(no QC\) · 5ae9a09 · \.burhan\/work\/alpha/);
  assert.doesNotMatch(r.out, /\.\.\//);
  unlinkSync(link);
});
