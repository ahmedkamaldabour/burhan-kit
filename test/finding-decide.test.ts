import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cli, read, setPlanStatus } from './item-fixture.js';
import { addFinding, OWNER, reviewFile, withReviews } from './findings-fixture.js';

const decide = (dir: string, id: number | string, ...args: string[]) => cli(dir, ['finding', 'decide', 'foo', String(id), ...args]);
const row = (dir: string, id: number): string => read(reviewFile(dir)).split('\n').find((l) => l.startsWith(`| ${id} |`)) ?? '';
const today = (): string => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Item foo with a review for sub-unit 1 and three findings: #1 Minor, #2 Important, #3 Critical. */
async function three(): Promise<string> {
  const dir = await withReviews([1]);
  await addFinding(dir, 'review:1', 'Minor', 'src/a.ts:1 minor');
  await addFinding(dir, 'review:1', 'Important', 'src/b.ts:2 important');
  await addFinding(dir, 'review:1', 'Critical', 'src/c.ts:3 critical');
  return dir;
}

test('--fixed unit:N records the decision, the pointer and "<name> · <date>" in the finding\'s row (AC-03, AC-04)', async () => {
  const dir = await three();
  const r = await decide(dir, 1, '--fixed', 'unit:1', '--by', OWNER);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /finding decide: #1 Minor decided fixed \(unit 1\) by dev-dabour; it was run from the shell, so the turn-end report lists it as agent-run/);
  assert.match(r.out, /2 findings have no decision yet\./);
  assert.equal(row(dir, 1), `| 1 | Minor | src/a.ts:1 minor | fixed | unit 1 | ${OWNER} · ${today()} |`);
  assert.equal(row(dir, 2), '| 2 | Important | src/b.ts:2 important |  |  |  |');
});

test('--fixed refuses a sub-unit the plan does not have, and a Deviations row that is open or rejected; an approved row is a fix (AC-07)', async () => {
  const dir = await three();
  assert.match((await decide(dir, 1, '--fixed', 'unit:9', '--by', OWNER)).err, /the plan has no Sub-unit 9/);
  assert.match((await decide(dir, 1, '--fixed', 'step:1', '--by', OWNER)).err, /--fixed is unit:<N>/);
  setPlanStatus(dir, 'In progress');
  assert.equal((await cli(dir, ['deviation', 'add', 'foo', '--unit', '1', '--what', 'a fix after the review', '--where', 'src/a.ts:1', '--output', 'x'])).code, 0);
  assert.match((await decide(dir, 1, '--fixed', 'deviation:1', '--by', OWNER)).err, /Deviations row 1 is open: only an approved row is a fix/);
  assert.match((await decide(dir, 1, '--fixed', 'deviation:5', '--by', OWNER)).err, /no row 5/);
  await cli(dir, ['deviation', 'resolve', 'foo', '1', '--rejected', '--by', OWNER]);
  assert.match((await decide(dir, 1, '--fixed', 'deviation:1', '--by', OWNER)).err, /Deviations row 1 is rejected/);
  await cli(dir, ['deviation', 'add', 'foo', '--unit', '1', '--what', 'second try', '--where', 'src/a.ts:1', '--output', 'y']);
  await cli(dir, ['deviation', 'resolve', 'foo', '2', '--approved', '--by', OWNER]);
  const ok = await decide(dir, 1, '--fixed', 'deviation:2', '--by', OWNER);
  assert.equal(ok.code, 0, ok.err);
  assert.match(row(dir, 1), /\| fixed \| deviation 2 \| dev-dabour · /);
  assert.equal(row(dir, 2), '| 2 | Important | src/b.ts:2 important |  |  |  |');
});

test('--discovery needs a discovery file that exists in the discovery folder, by name only (AC-03)', async () => {
  const dir = await three();
  assert.match((await decide(dir, 1, '--discovery', 'nope.md', '--by', OWNER)).err, /the discovery file \.burhan\/discovery\/nope\.md does not exist/);
  for (const bad of ['../x.md', 'a/b.md', 'notmd', '']) assert.equal((await decide(dir, 1, '--discovery', bad, '--by', OWNER)).code, 2, bad);
  mkdirSync(join(dir, '.burhan', 'discovery'), { recursive: true });
  writeFileSync(join(dir, '.burhan', 'discovery', '2026-11-08-a-finding.md'), '# a finding\n');
  const ok = await decide(dir, 1, '--discovery', '2026-11-08-a-finding.md', '--by', OWNER);
  assert.equal(ok.code, 0, ok.err);
  assert.match(row(dir, 1), /\| discovery \| 2026-11-08-a-finding\.md \| dev-dabour · /);
});

test('--discovery honours WF_DISCOVERY_DIR', async () => {
  const dir = await three();
  writeFileSync(join(dir, '.burhan', 'workflow.config'), 'WF_DISCOVERY_DIR=notes/found\n');
  mkdirSync(join(dir, 'notes', 'found'), { recursive: true });
  writeFileSync(join(dir, 'notes', 'found', 'd.md'), '# d\n');
  assert.equal((await decide(dir, 1, '--discovery', 'd.md', '--by', OWNER)).code, 0);
});

test('--accepted needs a reason; an Important needs a sentence; a Critical is never accepted (AC-03, AC-08)', async () => {
  const dir = await three();
  assert.match((await decide(dir, 1, '--accepted', '', '--by', OWNER)).err, /needs the owner's reason/);
  assert.equal((await decide(dir, 1, '--accepted', 'cosmetic', '--by', OWNER)).code, 0);
  assert.match(row(dir, 1), /\| accepted \| cosmetic \| dev-dabour · /);
  const word = await decide(dir, 2, '--accepted', 'fine', '--by', OWNER);
  assert.equal(word.code, 2);
  assert.match(word.err, /at least one sentence/);
  assert.equal((await decide(dir, 2, '--accepted', 'the check is repeated on purpose, for the audit', '--by', OWNER)).code, 0);
  const crit = await decide(dir, 3, '--accepted', 'a long and honest reason for leaving it', '--by', OWNER);
  assert.equal(crit.code, 2);
  assert.match(crit.err, /Critical and cannot be accepted/);
  assert.equal(row(dir, 3), '| 3 | Critical | src/c.ts:3 critical |  |  |  |');
});

test('a Critical is a discovery only with --outside, a reason that the code is not this item\'s; --outside is for nothing else (AC-08)', async () => {
  const dir = await three();
  mkdirSync(join(dir, '.burhan', 'discovery'), { recursive: true });
  writeFileSync(join(dir, '.burhan', 'discovery', 'c.md'), '# c\n');
  assert.match((await decide(dir, 3, '--discovery', 'c.md', '--by', OWNER)).err, /--outside/);
  assert.match((await decide(dir, 3, '--discovery', 'c.md', '--outside', 'later', '--by', OWNER)).err, /in a sentence/);
  assert.match((await decide(dir, 1, '--discovery', 'c.md', '--outside', 'not this item code at all', '--by', OWNER)).err, /only for a Critical/);
  assert.equal((await decide(dir, 3, '--discovery', 'c.md', '--outside', 'the code is in a module this item did not change', '--by', OWNER)).code, 0);
  assert.match(row(dir, 3), /\| discovery \| c\.md — outside this item: the code is in a module this item did not change \| dev-dabour · /);
});

test('the decision is a person\'s: no --by, an agent\'s name, or a placeholder is refused; exactly one decision; a known number; no overwrite (AC-04)', async () => {
  const dir = await three();
  const before = read(reviewFile(dir));
  assert.match((await decide(dir, 1, '--fixed', 'unit:1')).err, /--by is needed: the name of the person who decides/);
  for (const by of ['Claude', 'claude · sonnet', '<owner>', 'haiku']) assert.match((await decide(dir, 1, '--fixed', 'unit:1', '--by', by)).err, /person who decides/, by);
  assert.match((await decide(dir, 1, '--by', OWNER)).err, /exactly one of --fixed, --discovery or --accepted/);
  assert.match((await decide(dir, 1, '--fixed', 'unit:1', '--accepted', 'a reason here', '--by', OWNER)).err, /exactly one/);
  assert.match((await decide(dir, 'x', '--fixed', 'unit:1', '--by', OWNER)).err, /needs the finding number/);
  assert.match((await decide(dir, 99, '--fixed', 'unit:1', '--by', OWNER)).err, /no finding #99/);
  assert.equal(read(reviewFile(dir)), before);
  assert.equal((await decide(dir, 1, '--fixed', 'unit:1', '--by', OWNER)).code, 0);
  assert.match((await decide(dir, 1, '--accepted', 'changed my mind', '--by', OWNER)).err, /already decided \(fixed: unit 1\); a decision is not overwritten/);
});

test('with every finding decided, finding list shows each decision and no question; there is no command that decides them all (AC-04)', async () => {
  const dir = await three();
  await decide(dir, 1, '--fixed', 'unit:1', '--by', OWNER);
  await decide(dir, 2, '--accepted', 'the repeated check is on purpose, for the audit', '--by', OWNER);
  const last = await decide(dir, 3, '--fixed', 'unit:1', '--by', OWNER);
  assert.match(last.out, /Every finding has a decision now\./);
  const list = (await cli(dir, ['finding', 'list', 'foo'])).out;
  assert.match(list, /3 findings, 0 without a decision/);
  assert.match(list, /#2 Important · review Sub-unit 1 · accepted \(the repeated check is on purpose, for the audit\) · dev-dabour · /);
  assert.doesNotMatch(list, /QUESTION FOR THE OWNER/);
  assert.equal((await cli(dir, ['finding', 'decide', 'foo', '--all', '--by', OWNER])).code, 2);
  assert.equal((await cli(dir, ['finding', 'decide', 'foo', '--by', OWNER])).code, 2);
});

test('--discovery does not take a folder or a link to a file outside the project as a pointer (Deviation 4, review Minor 11)', { skip: process.platform === 'win32' }, async () => {
  const dir = await three();
  const folder = join(dir, '.burhan', 'discovery');
  mkdirSync(join(folder, 'x.md'), { recursive: true });
  const outside = join(mkdtempSync(join(tmpdir(), 'decide-out-')), 'outside.md');
  writeFileSync(outside, '# outside\n');
  symlinkSync(outside, join(folder, 'l.md'));
  for (const name of ['x.md', 'l.md']) {
    const r = await decide(dir, 1, '--discovery', name, '--by', OWNER);
    assert.equal(r.code, 2, name);
    assert.match(r.err, /does not exist/, name);
  }
  assert.doesNotMatch(row(dir, 1), /discovery/);
});

test('finding decide says when a review file is a link and so is not read (Deviation 18, review Minor 9)', { skip: process.platform === 'win32' }, async () => {
  const dir = await three();
  const outside = join(mkdtempSync(join(tmpdir(), 'decide-link-')), 'outside.md');
  writeFileSync(outside, read(reviewFile(dir)));
  rmSync(reviewFile(dir));
  symlinkSync(outside, reviewFile(dir));
  const r = await decide(dir, 1, '--fixed', 'unit:1', '--by', OWNER);
  assert.equal(r.code, 2);
  assert.match(r.err, /reviews\/foo-review\.md is a link and is not read/);
});

test('a model or tool name anywhere in --by is not a person (Deviation 19, review Minor 10)', async () => {
  const dir = await three();
  for (const by of ['Ahmed Claude', 'Sara GPT-4', 'dev-dabour Codex']) {
    const r = await decide(dir, 1, '--fixed', 'unit:1', '--by', by);
    assert.equal(r.code, 2, by);
    assert.match(r.err, /not an agent/, by);
  }
  assert.equal((await decide(dir, 1, '--fixed', 'unit:1', '--by', 'Ahmed Dabour')).code, 0);
});

test('a given name that has a tool word after its first word is a person when it is not a model name (Deviation 22, the "Hassan Cursor" probe)', async () => {
  const dir = await three();
  assert.equal((await decide(dir, 1, '--fixed', 'unit:1', '--by', 'Hassan Cursor')).code, 0);
  assert.equal((await decide(dir, 2, '--fixed', 'unit:1', '--by', 'Ahmed Claude')).code, 2);
});
