import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
  assert.match(r.err, /outside the project/);
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
  assert.match(r.err, /outside the project/);
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
  assert.match(r.err, /outside the project/);
  assert.equal(readFileSync(out, 'utf8'), OUTSIDE);
});

test('a WF_STATE_FILE that points outside the project is refused', async () => {
  const dir = setup();
  const out = outsideFile();
  writeFileSync(join(dir, '.burhan', 'workflow.config'), `WF_STATE_FILE=${relative(dir, out).split('\\').join('/')}\n`);
  const r = await cli(dir, ['state', 'compact', '--apply']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /outside the project/);
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

// Which lines are cut, and what the output says about the lines it leaves.
test('an item named like a common word is read in a long line only in backticks or after a "/": an ordinary word is not taken for it', async () => {
  const dir = setup();
  write(join(dir, DOCS, 'release', 'release-implementation-plan.md'), plan('refactor / bounded', 'Completed'));
  const plain = `- we release on Friday once the notes are read; ${'more words '.repeat(25)}`;
  const quoted = `- the \`release\` item is closed; ${'more words '.repeat(25)}`;
  writeFileSync(join(dir, STATE), FILE([plain, quoted].join('\n')));
  const r = await cli(dir, ['state', 'compact', '--apply']);
  assert.equal(r.code, 0, r.err);
  const after = state(dir);
  assert.ok(after.includes(plain), 'the word "release" alone does not make the line an old line of the item');
  assert.match(after, /^- the `release` item is closed;.*… \(full text: \.burhan\/work\/release\/release-state-notes\.md\)$/m);
});

test('a long line that names more than one item is left as it is, and the output names the items', async () => {
  const dir = setup();
  const both = `- gamma and \`delta\`: ${LONG}`;
  writeFileSync(join(dir, STATE), FILE(both));
  const r = await cli(dir, ['state', 'compact', '--apply']);
  assert.equal(r.code, 0, r.err);
  assert.ok(state(dir).includes(both));
  assert.match(r.out, /left as it is: \[Waiting on you\] a line naming delta, gamma: it is about more than one item/);
  assert.match(state(dir), /^- gamma: closed through.*… \(full text: /m, 'the line that names only gamma is still shortened');
});

test('in a git repository the commit id is a token git knows as a commit, not the last token that looks like one', async () => {
  const dir = setup();
  const git = (...a: string[]) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'x');
  const id = git('rev-parse', '--short=7', 'HEAD').stdout.trim();
  assert.match(id, /^[0-9a-f]{7,40}$/, 'git made a commit');
  writeFileSync(join(dir, STATE), FILE().replace(`- alpha: ${LONG}`, `- alpha: closed in ${id}; CI ran later on 5ae9a09`));
  const r = await cli(dir, ['state', 'compact']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, new RegExp(`\\+ - alpha · refactor / bounded · Done \\(no QC\\) · ${id} · `));
});

test('a closed line for which no commit id was read is flagged in the output, so "uncommitted" is checked before --apply', async () => {
  const dir = setup();
  writeFileSync(join(dir, STATE), FILE().replace(`- alpha: ${LONG}`, '- alpha: closed, committed locally, not pushed'));
  const r = await cli(dir, ['state', 'compact']);
  assert.match(r.out, /\+ - alpha · refactor \/ bounded · Done \(no QC\) · uncommitted · /);
  assert.match(r.out, /no commit id was read from the old line: check "uncommitted" before --apply/);
});

test('a Now line left as it is says why (an item in flight, an item whose route cannot be read); a field line or plain text is not reported', async () => {
  const dir = setup();
  write(join(dir, DOCS, 'epsilon', 'epsilon-implementation-plan.md'), '# p\n- **Overall status:** Completed\n- **Contract:** 1\n');
  writeFileSync(join(dir, STATE), FILE().replace('- delta: still being built, see its folder', ['- delta: still being built, see its folder', '- epsilon: done', '- **Branch:** main · origin/main', '- Closed items, one line each:'].join('\n')));
  const r = await cli(dir, ['state', 'compact']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /left as it is: delta: not closed \(In progress\)/);
  assert.match(r.out, /left as it is: epsilon: its route cannot be read/);
  assert.doesNotMatch(r.out, /left as it is: (Branch|Closed)/);
});

test('when the fixed shape is longer than the old lines the total says "adds", never "saves -N"', async () => {
  const dir = setup();
  writeFileSync(join(dir, STATE), ['# State', '', '## Now', '- alpha: done 5ae9a09', '', '## Waiting on you', '- nothing', ''].join('\n'));
  const r = await cli(dir, ['state', 'compact']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /1 line\(s\), 4 → 14 words \(adds 10: the fixed shape is longer than these lines\)/);
  assert.doesNotMatch(r.out, /saves -/);
});

// How --apply writes: line endings, bytes, refusals before the first write, the backup.
test('mixed line endings are kept line by line, and the backup is the old file byte for byte', async () => {
  const dir = setup();
  const lines = FILE().split('\n');
  const mixed = lines.map((l, i) => l + (i === lines.length - 1 ? '' : i % 2 === 0 ? '\r\n' : '\n')).join('');
  writeFileSync(join(dir, STATE), mixed);
  const r = await cli(dir, ['state', 'compact', '--apply']);
  assert.equal(r.code, 0, r.err);
  const after = state(dir);
  const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;
  assert.equal(count(after, /\r\n/g), count(mixed, /\r\n/g), 'as many CRLF endings as before');
  assert.equal(count(after, /(?<!\r)\n/g), count(mixed, /(?<!\r)\n/g), 'as many LF endings as before');
  assert.ok(readFileSync(join(dir, STATE + '.bak')).equals(Buffer.from(mixed, 'utf8')), 'the backup is the old file');
});

test('a state file that is not valid UTF-8 is not rewritten: --apply refuses and names it, and nothing is written', async () => {
  const dir = setup();
  const bytes = Buffer.concat([Buffer.from(FILE(), 'utf8'), Buffer.from([0xff, 0x0a])]);
  writeFileSync(join(dir, STATE), bytes);
  const r = await cli(dir, ['state', 'compact', '--apply']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /PROGRESS\.md is not valid UTF-8: nothing was written/);
  assert.ok(readFileSync(join(dir, STATE)).equals(bytes));
  assert.equal(existsSync(join(dir, STATE + '.bak')), false);
  assert.equal(existsSync(join(dir, DOCS, 'alpha', 'alpha-state-notes.md')), false);
});

test('a notes path that is a folder is refused with a message before anything is written: no notes, no backup, the state file unchanged', async () => {
  const dir = setup();
  mkdirSync(join(dir, DOCS, 'gamma', 'gamma-state-notes.md'));
  const before = state(dir);
  const r = await cli(dir, ['state', 'compact', '--apply']);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /\.burhan\/work\/gamma\/gamma-state-notes\.md is not a file/);
  assert.equal(existsSync(join(dir, DOCS, 'alpha', 'alpha-state-notes.md')), false, 'the check runs before the first write');
  assert.equal(state(dir), before);
  assert.equal(existsSync(join(dir, STATE + '.bak')), false);
});

test('an item folder that cannot be written gives a one-line message, not a stack trace, and the state file is unchanged',
  { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'needs POSIX permissions and a user that is not root' : false }, async () => {
    const dir = setup();
    const folder = join(dir, DOCS, 'alpha');
    const before = state(dir);
    chmodSync(folder, 0o555);
    try {
      const r = await cli(dir, ['state', 'compact', '--apply']);
      assert.equal(r.code, 2, r.out + r.err);
      assert.match(r.err, /cannot write \.burhan\/work\/alpha\/alpha-state-notes\.md: EACCES; the state file is unchanged/);
      assert.equal(state(dir), before);
    } finally { chmodSync(folder, 0o755); }
  });

test('--apply says when it replaces an earlier backup, and warns when git does not ignore the backup', async () => {
  const dir = setup();
  spawnSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(join(dir, '.gitignore'), '!*.bak\n'); // a global ignore of *.bak on this machine does not hide the case
  writeFileSync(join(dir, STATE + '.bak'), 'an older backup\n');
  const r = await cli(dir, ['state', 'compact', '--apply']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /backup: \.burhan\/local\/PROGRESS\.md\.bak, replacing the earlier backup/);
  assert.match(r.out, /note: \.burhan\/local\/PROGRESS\.md\.bak is not ignored by git: do not commit it/);
});

test('no git warning when git ignores the backup, and none outside a git repository', async () => {
  const ignored = setup();
  spawnSync('git', ['init', '-q'], { cwd: ignored });
  writeFileSync(join(ignored, '.gitignore'), '.burhan/local/\n');
  const a = await cli(ignored, ['state', 'compact', '--apply']);
  assert.equal(a.code, 0, a.err);
  assert.doesNotMatch(a.out, /not ignored by git/);
  const plain = setup();
  const b = await cli(plain, ['state', 'compact', '--apply']);
  assert.equal(b.code, 0, b.err);
  assert.doesNotMatch(b.out, /not ignored by git|replacing the earlier backup/);
});

test('120 closed items and 20 long lines of 50,000 characters are compacted with --apply in bounded time', async () => {
  const dir = project();
  const N = 120;
  const now: string[] = [];
  for (let i = 0; i < N; i++) {
    write(join(dir, DOCS, `item-${i}`, `item-${i}-implementation-plan.md`), plan('refactor / bounded', 'Completed'));
    now.push(`- item-${i}: closed, committed 5ae9a09`);
  }
  const long = Array.from({ length: 20 }, (_, i) => `- note ${i}: ${'word '.repeat(10000)}item-${i}`);
  writeFileSync(join(dir, STATE), ['# State', '', '## Now', ...now, '', '## Commit instructions', ...long, '', '## Waiting on you', '- nothing', ''].join('\n'));
  const started = Date.now();
  const r = await cli(dir, ['state', 'compact', '--apply']);
  assert.equal(r.code, 0, r.err);
  assert.ok(Date.now() - started < 20000, `${Date.now() - started} ms`);
  const after = state(dir);
  for (let i = 0; i < N; i++) assert.ok(after.includes(`- item-${i} · refactor / bounded · Done (no QC) · 5ae9a09 · .burhan/work/item-${i}\n`), `item-${i}`);
  assert.equal(after.split('\n').filter((l) => l.includes('… (full text: .burhan/work/item-')).length, 20);
});

// Known issue 33 (owner's decision at plan approval): a closed item's ### block is named in the output and left to the session that owns it.
test('a ### block of a closed item is named in the output and left as it is; a block of an item in flight is not named', async () => {
  const dir = setup();
  writeFileSync(join(dir, STATE), FILE().replace('## Commit instructions', '### delta\n- **Route:** refactor / bounded · **Mode:** step\n\n## Commit instructions'));
  const before = state(dir);
  const r = await cli(dir, ['state', 'compact']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /left as it is: ### beta: the item is closed \(Done \(no QC\)\) but its block is still in Now; state compact never touches a ### block: the session that owns it shrinks it to one line at close-out \(phases\/close-out\.md\)/);
  assert.doesNotMatch(r.out, /### delta/);
  assert.equal(state(dir), before, 'a dry run writes nothing');
  await cli(dir, ['state', 'compact', '--apply']);
  assert.ok(state(dir).includes(`### beta\n- **Route:** change / bounded · **Mode:** auto\n- beta: ${LONG}`), 'the block is left whole');
});

test('--apply writes the backup and the state file atomically and leaves no temp file or lock', async () => {
  const dir = setup();
  const before = state(dir);
  const r = await cli(dir, ['state', 'compact', '--apply']);
  assert.equal(r.code, 0, r.err);
  assert.equal(readFileSync(join(dir, STATE + '.bak'), 'utf8'), before);
  assert.deepEqual(readdirSync(join(dir, '.burhan', 'local')).sort(), ['PROGRESS.md', 'PROGRESS.md.bak']);
});
