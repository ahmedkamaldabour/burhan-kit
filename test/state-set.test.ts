import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli, project, STATE, write } from './item-fixture.js';

const DOCS = '.burhan/work';
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const FILE = ['# State', '', '## Now', '', '### alpha', '- **Route:** change / bounded · **Mode:** step', '- **Next action:** one', '', '### beta', '- **Route:** change / bounded · **Mode:** step', '- **Next action:** two', '', '## Waiting on you', '- nothing', ''].join('\n');
const setup = (text = FILE): string => { const dir = project(); writeFileSync(join(dir, STATE), text); return dir; };
const state = (dir: string): string => readFileSync(join(dir, STATE), 'utf8');
const planOf = (route: string, status: string): string => `# p\n- **Route:** ${route}\n- **Overall status:** ${status}\n- **Contract:** 1\n`;
const run = (cwd: string, args: string[]): Promise<{ code: number; err: string }> => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [CLI, ...args], { cwd });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  child.on('error', reject);
  child.on('close', (code) => resolve({ code: code ?? -1, err }));
});

test('set replaces only that line', async () => {
  const dir = setup();
  const r = await cli(dir, ['state', 'set', 'beta', 'Next action', 'three']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /state set: beta · Next action changed in \.burhan\/local\/PROGRESS\.md/);
  assert.equal(state(dir), FILE.replace('- **Next action:** two', '- **Next action:** three'));
});

test('set adds a missing line at the end of the block', async () => {
  const dir = setup();
  const r = await cli(dir, ['state', 'set', 'alpha', 'Branch', 'main']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Branch added/);
  assert.equal(state(dir), FILE.replace('- **Next action:** one\n', '- **Next action:** one\n- **Branch:** main\n'));
});

test('set keeps a CRLF file\'s endings', async () => {
  const crlf = FILE.replace(/\n/g, '\r\n');
  const dir = setup(crlf);
  assert.equal((await cli(dir, ['state', 'set', 'beta', 'Next action', 'three'])).code, 0);
  assert.equal(state(dir), crlf.replace('- **Next action:** two', '- **Next action:** three'));
  assert.equal((await cli(dir, ['state', 'set', 'alpha', 'Branch', 'main'])).code, 0);
  assert.equal(state(dir), crlf.replace('- **Next action:** two', '- **Next action:** three').replace('- **Next action:** one\r\n', '- **Next action:** one\r\n- **Branch:** main\r\n'));
});

test('set refuses a missing block, a bad label and a bad value, and writes nothing', async () => {
  const dir = setup();
  const cases: Array<[string[], RegExp]> = [
    [['gamma', 'Next action', 'x'], /no "### gamma" block under "## Now"/],
    [['alpha', 'Next action', 'a\nb'], /control character/],
    [['alpha', 'Next *', 'x'], /label must be plain text/],
    [['alpha', 'Next: a', 'x'], /label must be plain text/],
    [['alpha', 'Next action', ' '], /value is empty/],
    [['..', 'Next action', 'x'], /not an item slug/],
  ];
  for (const [args, message] of cases) {
    const r = await cli(dir, ['state', 'set', ...args]);
    assert.equal(r.code, 2, args.join(' | '));
    assert.match(r.err, message, args.join(' | '));
    assert.equal(state(dir), FILE, args.join(' | '));
  }
  assert.equal((await cli(dir, ['state', 'set', 'alpha', 'Next action'])).code, 2); // two positionals: the value is missing
  assert.equal(state(dir), FILE);
});

test('set does not touch a block that is not under Now', async () => {
  const text = '# S\n\n## Now\n\n### alpha\n- x\n\n## Waiting on you\n### beta\n- y\n';
  const dir = setup(text);
  const r = await cli(dir, ['state', 'set', 'beta', 'Next action', 'z']);
  assert.equal(r.code, 2);
  assert.equal(state(dir), text);
});

test('show prints a block and the list and writes nothing', async () => {
  const dir = setup();
  const one = await cli(dir, ['state', 'show', 'beta']);
  assert.equal(one.code, 0, one.err);
  assert.equal(one.out, '### beta\n- **Route:** change / bounded · **Mode:** step\n- **Next action:** two\n');
  const list = await cli(dir, ['state', 'show']);
  assert.equal(list.out, 'alpha\nbeta\n');
  assert.equal(state(dir), FILE);
  assert.deepEqual(readdirSync(join(dir, '.burhan', 'local')), ['PROGRESS.md']);
});

test('show refuses a slug with no block', async () => {
  const dir = setup();
  const r = await cli(dir, ['state', 'show', 'gamma']);
  assert.equal(r.code, 2);
  assert.match(r.err, /no "### gamma" block/);
});

test('close replaces the block with the fixed line and leaves every other byte', async () => {
  const dir = setup();
  write(join(dir, DOCS, 'alpha', 'alpha-implementation-plan.md'), planOf('refactor / bounded', 'Completed'));
  const r = await cli(dir, ['state', 'close', 'alpha', '--outcome', 'Done (no QC)', '--commit', '5ae9a09', '--folder', '.burhan/work/alpha']);
  assert.equal(r.code, 0, r.err);
  const line = '- alpha · refactor / bounded · Done (no QC) · 5ae9a09 · .burhan/work/alpha';
  assert.equal(state(dir), FILE.replace('### alpha\n- **Route:** change / bounded · **Mode:** step\n- **Next action:** one\n', `${line}\n`));
  assert.match(r.out, /state close: alpha/);
});

test('close refuses what the closed line cannot hold and an outcome the item has not reached', async () => {
  const dir = setup();
  write(join(dir, DOCS, 'alpha', 'alpha-implementation-plan.md'), planOf('refactor / bounded', 'Completed'));
  const base = ['state', 'close', 'alpha', '--commit', '5ae9a09', '--folder', '.burhan/work/alpha'];
  const cases: Array<[string[], RegExp]> = [
    [[...base, '--outcome', 'Nope'], /not one of QC PASS, Done \(no QC\), Paused, Superseded/],
    [[...base, '--outcome', 'QC PASS'], /is "Done \(no QC\)", not "QC PASS"/],
    [['state', 'close', 'alpha', '--outcome', 'Done (no QC)', '--commit', 'zzz', '--folder', 'f'], /would not be a closed line/],
    [['state', 'close', 'alpha', '--outcome', 'Done (no QC)', '--commit', '5ae9a09', '--folder', 'a · b'], /would not be a closed line/],
    [['state', 'close', 'alpha', '--outcome', 'Done (no QC)', '--commit', '5ae9a09', '--folder', 'a\nb'], /control character/],
    [['state', 'close', 'alpha', '--outcome', 'Done (no QC)'], /needs --outcome, --commit and --folder/],
    [['state', 'close', 'beta', '--outcome', 'Done (no QC)', '--commit', '5ae9a09', '--folder', 'f'], /has no folder/],
  ];
  for (const [args, message] of cases) {
    const r = await cli(dir, args);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.err, message, args.join(' '));
    assert.equal(state(dir), FILE, args.join(' '));
  }
});

test('eight processes setting eight blocks at once change only their own lines', async () => {
  const slugs = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'];
  const text = `# State\n\n## Now\n\n${slugs.map((s) => `### ${s}\n- **Next action:** old\n`).join('\n')}\n## Waiting on you\n- nothing\n`;
  const dir = setup(text);
  const results = await Promise.all(slugs.map((s) => run(dir, ['state', 'set', s, 'Next action', `new-${s}`])));
  for (const r of results) assert.equal(r.code, 0, r.err);
  let expected = text;
  for (const s of slugs) expected = expected.replace(`### ${s}\n- **Next action:** old\n`, `### ${s}\n- **Next action:** new-${s}\n`);
  assert.equal(state(dir), expected);
  assert.deepEqual(readdirSync(join(dir, '.burhan', 'local')), ['PROGRESS.md']);
});
