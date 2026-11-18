import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli, project, read, STATE, write } from './item-fixture.js';

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

// --- `state close` ticks the plan's Close-out box (item 005) ---
const EVIDENCE = 'closed line in the state file (burhan state close)';
const BOX = '- [ ] Close-out in the state file';
const alphaPlan = (dir: string): string => join(dir, DOCS, 'alpha', 'alpha-implementation-plan.md');
/** A plan with a gate checklist. A second Close-out line sits after it, outside the checklist: it must never change. */
const withChecklist = (route: string, status: string, box = BOX, eol = '\n'): string =>
  ['# p', `- **Route:** ${route}`, `- **Overall status:** ${status}`, '- **Contract:** 1', '', '## Gate checklist', '- [x] Plan approved', box, '', '## 1. Decisions', BOX, ''].join(eol);
const CLOSE = ['state', 'close', 'alpha', '--outcome', 'Done (no QC)', '--commit', '5ae9a09', '--folder', '.burhan/work/alpha'];
const CLOSED_LINE = '- alpha · refactor / bounded · Done (no QC) · 5ae9a09 · .burhan/work/alpha';
const ticked = (before: string): string => before.replace(BOX, `- [x] Close-out in the state file — ${EVIDENCE}`); // the first (checklist) box only
const canLock = process.platform !== 'win32' && process.getuid?.() !== 0; // a read-only file stops neither root nor Windows

test('close ticks the plan\'s Close-out box for Done (no QC)', async () => { // T1
  const dir = setup();
  const before = withChecklist('refactor / bounded', 'Completed');
  write(alphaPlan(dir), before);
  const r = await cli(dir, CLOSE);
  assert.equal(r.code, 0, r.err);
  assert.ok(state(dir).split('\n').includes(CLOSED_LINE));
  assert.match(r.out, /\n {2}plan: the Close-out box is ticked\n$/);
  assert.equal(read(alphaPlan(dir)), ticked(before)); // one line differs: the checklist box; the Close-out line after the checklist is untouched
});

test('close ticks the plan\'s Close-out box for QC PASS', async () => { // T2
  const dir = setup();
  const before = withChecklist('feature / architectural', 'Completed');
  write(alphaPlan(dir), before);
  write(join(dir, DOCS, 'alpha', 'reviews', 'alpha-qc.md'), '# q\n- **Verdict:** PASS\n- **Accepted by:** dev-dabour · 2026-11-11\n');
  const r = await cli(dir, ['state', 'close', 'alpha', '--outcome', 'QC PASS', '--commit', 'uncommitted', '--folder', '.burhan/work/alpha']);
  assert.equal(r.code, 0, r.err);
  assert.ok(state(dir).split('\n').includes('- alpha · feature / architectural · QC PASS · uncommitted · .burhan/work/alpha'));
  assert.match(r.out, /plan: the Close-out box is ticked/);
  assert.equal(read(alphaPlan(dir)), ticked(before));
});

test('close for Paused and Superseded leaves the box open and says so', async () => { // T3
  for (const outcome of ['Paused', 'Superseded']) {
    const dir = setup();
    const before = withChecklist('refactor / bounded', outcome);
    write(alphaPlan(dir), before);
    const r = await cli(dir, ['state', 'close', 'alpha', '--outcome', outcome, '--commit', 'uncommitted', '--folder', '.burhan/work/alpha']);
    assert.equal(r.code, 0, `${outcome}: ${r.err}`);
    assert.ok(state(dir).split('\n').includes(`- alpha · refactor / bounded · ${outcome} · uncommitted · .burhan/work/alpha`), outcome);
    assert.match(r.out, new RegExp(`plan: the Close-out box stays open: ${outcome} does not tick it`), outcome);
    assert.equal(read(alphaPlan(dir)), before, outcome);
  }
});

test('a refused close leaves the plan and the state file as they were', async () => { // T4
  const dir = setup();
  const before = withChecklist('refactor / bounded', 'Completed');
  write(alphaPlan(dir), before);
  const gamma = join(dir, DOCS, 'gamma', 'gamma-implementation-plan.md'); // a folder and a plan, but no block under Now
  write(gamma, before);
  const base = ['--commit', '5ae9a09', '--folder', '.burhan/work/alpha'];
  const cases: Array<[string[], RegExp]> = [
    [['state', 'close', 'alpha', '--outcome', 'Nope', ...base], /not one of/],
    [['state', 'close', 'alpha', '--outcome', 'QC PASS', ...base], /not "QC PASS"/],
    [['state', 'close', 'alpha', '--outcome', 'Done (no QC)', '--commit', 'zzz', '--folder', 'f'], /would not be a closed line/],
    [['state', 'close', 'alpha', '--outcome', 'Done (no QC)', '--commit', '5ae9a09', '--folder', 'a\nb'], /control character/],
    [['state', 'close', 'alpha', '--outcome', 'Done (no QC)'], /needs --outcome, --commit and --folder/],
    [['state', 'close', 'beta', '--outcome', 'Done (no QC)', ...base], /has no folder/],
    [['state', 'close', 'gamma', '--outcome', 'Done (no QC)', ...base], /no "### gamma" block/],
  ];
  for (const [args, message] of cases) {
    const r = await cli(dir, args);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.err, message, args.join(' '));
    assert.equal(state(dir), FILE, args.join(' '));
    assert.equal(read(alphaPlan(dir)), before, args.join(' '));
    assert.equal(read(gamma), before, args.join(' '));
  }
  if (canLock) { // a state file that cannot be written: refused, and the plan is not reached
    chmodSync(join(dir, STATE), 0o444);
    try {
      const r = await cli(dir, CLOSE);
      assert.equal(r.code, 2);
      assert.match(r.err, /not writable/);
      assert.equal(state(dir), FILE);
      assert.equal(read(alphaPlan(dir)), before);
    } finally { chmodSync(join(dir, STATE), 0o644); }
  }
});

test('close with no checklist, no Close-out box, two boxes or no plan file still closes and says why', async () => { // T5
  const plain = planOf('refactor / bounded', 'Completed');
  const cases: Array<[string, Record<string, string>, RegExp]> = [
    ['no checklist', { 'alpha-implementation-plan.md': plain }, /plan: the Close-out box was not ticked: the plan has no "## Gate checklist" section\n$/],
    ['no box', { 'alpha-implementation-plan.md': `${plain}\n## Gate checklist\n- [x] Plan approved\n` }, /plan: the Close-out box was not ticked: the checklist has no Close-out box\n$/],
    ['two boxes', { 'alpha-implementation-plan.md': `${plain}\n## Gate checklist\n${BOX}\n${BOX}\n` }, /plan: the Close-out box was not ticked: the checklist has more than one Close-out box\n$/],
    ['a box inside a fence only', { 'alpha-implementation-plan.md': `${plain}\n## Gate checklist\n- [x] Plan approved\n\`\`\`\n${BOX}\n\`\`\`\n` }, /plan: the Close-out box was not ticked: the checklist has no Close-out box\n$/],
    ['no plan file', { 'alpha-findings.md': '# f\n- **Route:** investigation / bounded\n- **Status:** Concluded\n' }, /plan: the Close-out box was not ticked: alpha has no implementation plan file\n$/],
  ];
  for (const [label, files, message] of cases) {
    const dir = setup();
    for (const [name, text] of Object.entries(files)) write(join(dir, DOCS, 'alpha', name), text);
    const r = await cli(dir, CLOSE);
    assert.equal(r.code, 0, `${label}: ${r.err}`);
    assert.match(state(dir), /^- alpha · .* · Done \(no QC\) · 5ae9a09 · \.burhan\/work\/alpha$/m, label);
    assert.match(r.out, message, label);
    for (const [name, text] of Object.entries(files)) assert.equal(read(join(dir, DOCS, 'alpha', name)), text, `${label}: ${name} changed`);
  }
});

test('close leaves a box that is already ticked as it is', async () => { // T6
  const dir = setup();
  const before = withChecklist('refactor / bounded', 'Completed', '- [x] Close-out in the state file — by hand');
  write(alphaPlan(dir), before);
  const r = await cli(dir, CLOSE);
  assert.equal(r.code, 0, r.err);
  assert.ok(state(dir).split('\n').includes(CLOSED_LINE));
  assert.match(r.out, /plan: the Close-out box was already ticked: left as it is\n$/);
  assert.equal(read(alphaPlan(dir)), before);
});

test('a second close is refused and changes neither file', async () => { // T7
  const dir = setup();
  write(alphaPlan(dir), withChecklist('refactor / bounded', 'Completed'));
  assert.equal((await cli(dir, CLOSE)).code, 0);
  const stateAfter = state(dir);
  const planAfter = read(alphaPlan(dir));
  const again = await cli(dir, CLOSE);
  assert.equal(again.code, 2);
  assert.match(again.err, /no "### alpha" block/);
  assert.equal(state(dir), stateAfter);
  assert.equal(read(alphaPlan(dir)), planAfter);
});

test('close whose plan write fails keeps the closed line and names the gate tick command', { skip: canLock ? false : 'a read-only file stops neither root nor Windows' }, async () => { // T8
  const dir = setup();
  const before = withChecklist('refactor / bounded', 'Completed');
  write(alphaPlan(dir), before);
  chmodSync(alphaPlan(dir), 0o444);
  let r: { code: number; out: string; err: string };
  try { r = await cli(dir, CLOSE); } finally { chmodSync(alphaPlan(dir), 0o644); }
  assert.equal(r.code, 0, r.err);
  assert.ok(state(dir).split('\n').includes(CLOSED_LINE)); // the close stands
  assert.match(r.out, /plan: the Close-out box was not ticked: .*EACCES.*; run: burhan gate tick alpha "Close-out" --evidence "<text>"\n$/);
  assert.equal(read(alphaPlan(dir)), before);
});

test('close keeps the line endings of a CRLF plan', async () => { // T9
  const dir = setup();
  const before = withChecklist('refactor / bounded', 'Completed', BOX, '\r\n');
  write(alphaPlan(dir), before);
  const r = await cli(dir, CLOSE);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /plan: the Close-out box is ticked/);
  assert.equal(read(alphaPlan(dir)), before.replace(BOX, `- [x] Close-out in the state file — ${EVIDENCE}`)); // the \r of that line stays
});
