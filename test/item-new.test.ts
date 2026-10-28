import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { kitDir } from '../src/lib/kit.js';
import { runCli } from '../src/main.js';
import { capture, posixOnly, symlinkSkip, tmpDir } from './helpers.js';

const STATE = join('.burhan', 'local', 'PROGRESS.md');
const WORK = join('.burhan', 'work');

/** A project with the templates the install puts in .burhan/templates and a state file with an empty Now. */
function project(o: { state?: string | null; config?: string } = {}): string {
  const dir = tmpDir('burhan-item-new-');
  cpSync(join(kitDir(), 'templates'), join(dir, '.burhan', 'templates'), { recursive: true });
  if (o.state !== null) {
    mkdirSync(join(dir, '.burhan', 'local'), { recursive: true });
    writeFileSync(join(dir, STATE), o.state ?? '# State\n\n## Now\n\n## Waiting on you\n- nothing\n');
  }
  if (o.config) writeFileSync(join(dir, '.burhan', 'workflow.config'), o.config);
  return dir;
}
const run = async (dir: string, args: string[]) => { const c = capture(dir); const code = await runCli(['item', 'new', ...args], c.io); return { code, ...c.o }; };
const files = (dir: string, slug = 'foo'): string[] => {
  const d = join(dir, WORK, slug);
  if (!existsSync(d)) return [];
  return readdirSync(d).sort();
};

const ROUTES: Array<[string, string, string[]]> = [
  ['feature', 'architectural', ['foo-build-spec.md', 'foo-implementation-plan.md', 'foo-story.md']],
  ['feature', 'bounded', ['foo-build-spec.md', 'foo-implementation-plan.md', 'foo-story.md']],
  ['bug', 'bounded', ['foo-build-spec.md', 'foo-implementation-plan.md', 'foo-story.md']],
  ['bug', 'spike', ['foo-findings.md']],
  ['investigation', 'bounded', ['foo-findings.md']],
  ['change', 'bounded', ['foo-build-spec.md', 'foo-implementation-plan.md', 'foo-story.md']],
  ['refactor', 'bounded', ['foo-build-spec.md', 'foo-implementation-plan.md']],
  ['release', 'architectural', ['foo-build-spec.md', 'foo-implementation-plan.md']],
];

for (const [type, scope, expected] of ROUTES) {
  test(`item new ${type} / ${scope} creates ${expected.map((f) => f.replace('foo-', '')).join(' and ')}, and they follow the contract`, async () => {
    const dir = project();
    const r = await run(dir, ['foo', '--type', type, '--scope', scope]);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(files(dir).filter((f) => f.endsWith('.md')), expected);
    const check = capture(dir);
    assert.equal(await runCli(['item', 'check', 'foo'], check.io), 0, check.o.out);
    for (const f of expected) {
      const text = readFileSync(join(dir, WORK, 'foo', f), 'utf8');
      assert.match(text, /\*\*Contract:\*\* 1/);
      if (!f.endsWith('-build-spec.md')) assert.match(text, new RegExp(`\\*\\*Route:\\*\\* ${type} / ${scope}`));
    }
  });
}

test('item new adds the item to Now, before the next section, with its route, mode and date', async () => {
  const dir = project();
  await run(dir, ['foo', '--type', 'feature', '--scope', 'bounded']);
  const text = readFileSync(join(dir, STATE), 'utf8');
  assert.match(text, /## Now\n[\s\S]*### foo\n- \*\*Route:\*\* feature \/ bounded · \*\*Mode:\*\* step · intake \d{4}-\d{2}-\d{2}[\s\S]*## Waiting on you/);
});

test('the mode comes from the route key, then WF_MODE_DEFAULT, then step', async () => {
  const dir = project({ config: 'WF_MODE_DEFAULT="auto"\nWF_MODE_BUG_BOUNDED="step"\n' });
  await run(dir, ['a', '--type', 'feature', '--scope', 'bounded']);
  await run(dir, ['b', '--type', 'bug', '--scope', 'bounded']);
  assert.match(readFileSync(join(dir, WORK, 'a', 'a-story.md'), 'utf8'), /\*\*Mode:\*\* auto/);
  assert.match(readFileSync(join(dir, WORK, 'b', 'b-story.md'), 'utf8'), /\*\*Mode:\*\* step/);
});

test('item new refuses what the routing matrix does not allow, says why, and writes nothing', async () => {
  const cases: Array<[string[], RegExp]> = [
    [['../x', '--type', 'bug', '--scope', 'bounded'], /slug/],
    [['foo'], /--type/],
    [['foo', '--type', 'bug'], /--scope/],
    [['foo', '--type', 'feature', '--scope', 'spike'], /investigation/],
    [['foo', '--type', 'change', '--scope', 'patch'], /patch/],
    [['foo', '--type', 'nonsense', '--scope', 'bounded'], /type/],
    [['foo', '--type', 'bug', '--scope', 'huge'], /scope/],
  ];
  for (const [args, why] of cases) {
    const dir = project();
    const before = readFileSync(join(dir, STATE), 'utf8');
    const r = await run(dir, args);
    assert.equal(r.code, 2, `${args.join(' ')}: ${r.out}${r.err}`);
    assert.match(r.err, why, args.join(' '));
    assert.equal(existsSync(join(dir, WORK)), false, args.join(' ')); // no folder at all, not even an empty one
    assert.equal(readFileSync(join(dir, STATE), 'utf8'), before, args.join(' '));
  }
});

test('item new refuses an item that already has a folder or a block in Now, and changes nothing', async () => {
  const dir = project();
  await run(dir, ['foo', '--type', 'bug', '--scope', 'bounded']);
  const before = readFileSync(join(dir, STATE), 'utf8');
  const again = await run(dir, ['foo', '--type', 'bug', '--scope', 'bounded']);
  assert.equal(again.code, 2);
  assert.match(again.err, /already/);
  assert.equal(readFileSync(join(dir, STATE), 'utf8'), before);

  const blocked = project({ state: '## Now\n\n### foo\n- x\n\n## Waiting on you\n' });
  const r = await run(blocked, ['foo', '--type', 'bug', '--scope', 'bounded']);
  assert.equal(r.code, 2);
  assert.deepEqual(files(blocked), []);
});

test('item new without a state file still makes the files and says the block is yours to add', async () => {
  const dir = project({ state: null });
  const r = await run(dir, ['foo', '--type', 'bug', '--scope', 'bounded']);
  assert.equal(r.code, 0, r.err);
  assert.equal(files(dir).length, 3);
  assert.match(r.out, /no state file/i);
});

test('item new refuses a docs folder outside the project', async () => {
  const dir = project();
  const r = await run(dir, ['foo', '--type', 'bug', '--scope', 'bounded', '--docs', '..']);
  assert.equal(r.code, 2);
  assert.match(r.err, /inside the project/);
});

test('item new refuses a state file that is a link leading outside the project, and creates no file', { skip: symlinkSkip }, async () => {
  const dir = project({ state: null });
  const outside = tmpDir('burhan-item-outside-');
  writeFileSync(join(outside, 'state.md'), '## Now\n\n## Next\n');
  mkdirSync(join(dir, '.burhan', 'local'), { recursive: true });
  symlinkSync(join(outside, 'state.md'), join(dir, STATE), 'file');
  const r = await run(dir, ['foo', '--type', 'bug', '--scope', 'bounded']);
  assert.equal(r.code, 2);
  assert.match(r.err, /outside the project/);
  assert.deepEqual(files(dir), []);
  assert.equal(readFileSync(join(outside, 'state.md'), 'utf8'), '## Now\n\n## Next\n');
});

// ---- review round 1 (SU2): the faults the independent review found ----
const root = process.platform !== 'win32' && process.getuid?.() === 0;

test('a failed write leaves nothing behind, and the error says so (a read-only state file)', { skip: posixOnly || (root ? 'root ignores file modes' : false) }, async () => {
  const dir = project();
  chmodSync(join(dir, STATE), 0o444);
  const r = await run(dir, ['foo', '--type', 'bug', '--scope', 'bounded']);
  chmodSync(join(dir, STATE), 0o644);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /nothing was left behind/);
  assert.equal(existsSync(join(dir, WORK, 'foo')), false);
  assert.equal((await run(dir, ['foo', '--type', 'bug', '--scope', 'bounded'])).code, 0); // and a retry works
});

test('an over-long slug is refused cleanly, not with a raw file-system error', async () => {
  const dir = project();
  const r = await run(dir, ['a'.repeat(300), '--type', 'bug', '--scope', 'bounded']);
  assert.equal(r.code, 2);
  assert.match(r.err, /slug/);
  assert.equal(existsSync(join(dir, WORK)), false);
});

test('slugs Windows cannot keep are refused: reserved names and a trailing dot', async () => {
  for (const slug of ['CON', 'nul.txt', 'foo.', 'com1', '...']) {
    const dir = project();
    const r = await run(dir, [slug, '--type', 'bug', '--scope', 'bounded']);
    assert.equal(r.code, 2, slug);
    assert.match(r.err, /slug/, slug);
    assert.equal(existsSync(join(dir, WORK)), false, slug);
  }
});

test('a state file with no "## Now" section says that, not that the file is missing', async () => {
  const dir = project({ state: '# State\n\n## Next\n- x\n' });
  const r = await run(dir, ['foo', '--type', 'bug', '--scope', 'bounded']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /no "## Now" section/);
  assert.doesNotMatch(r.out, /no state file/i);
});

test('an existing block with a title after the slug counts as that item', async () => {
  const dir = project({ state: '## Now\n\n### foo — Big title\n- x\n\n## Waiting on you\n' });
  const r = await run(dir, ['foo', '--type', 'bug', '--scope', 'bounded']);
  assert.equal(r.code, 2);
  assert.match(r.err, /already/);
  const other = project({ state: '## Now\n\n### foo-bar\n- x\n\n## Waiting on you\n' });
  assert.equal((await run(other, ['foo', '--type', 'bug', '--scope', 'bounded'])).code, 0); // a different slug that starts the same
});

test('a template with Windows line endings gives files with one kind of line ending', async () => {
  const dir = project();
  for (const name of ['story.md', 'plan.md']) {
    const p = join(dir, '.burhan', 'templates', name);
    writeFileSync(p, readFileSync(p, 'utf8').replace(/\n/g, '\r\n'));
  }
  await run(dir, ['foo', '--type', 'feature', '--scope', 'bounded']);
  const text = readFileSync(join(dir, WORK, 'foo', 'foo-story.md'), 'utf8');
  assert.equal(/(^|[^\r])\n/.test(text), false, 'a bare \\n in a CRLF file');
});

test('a project template that is missing falls back to the kit one, file by file', async () => {
  const dir = project();
  rmSync(join(dir, '.burhan', 'templates', 'findings.md'));
  const r = await run(dir, ['foo', '--type', 'investigation', '--scope', 'bounded']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(files(dir), ['foo-findings.md']);
});

// ---- plan shape (sub-unit 10) ----
test('the build spec made with a plan names the plan, carries the marker, and the plan names the spec', async () => {
  const dir = project();
  assert.equal((await run(dir, ['foo', '--type', 'feature', '--scope', 'bounded'])).code, 0);
  const spec = readFileSync(join(dir, WORK, 'foo', 'foo-build-spec.md'), 'utf8');
  assert.match(spec, /^- \*\*Plan:\*\* \.\/foo-implementation-plan\.md$/m);
  assert.match(spec, /^- \*\*Contract:\*\* 1$/m);
  assert.match(readFileSync(join(dir, WORK, 'foo', 'foo-implementation-plan.md'), 'utf8'), /^- \*\*Build spec:\*\* \.\/foo-build-spec\.md/m);
});

test('a project template for the build spec is used, and the kit one is the fallback', async () => {
  const dir = project();
  rmSync(join(dir, '.burhan', 'templates', 'build-spec.md'));
  assert.equal((await run(dir, ['foo', '--type', 'bug', '--scope', 'bounded'])).code, 0);
  assert.deepEqual(files(dir), ['foo-build-spec.md', 'foo-implementation-plan.md', 'foo-story.md']);
});
