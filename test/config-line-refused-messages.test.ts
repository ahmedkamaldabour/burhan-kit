import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cli, planFile, read, write } from './item-fixture.js';
import { reviewsDecided } from './findings-fixture.js';
import { ledgerFor, recordProject, verifyRun } from './record-fixture.js';

const saved = { state: process.env.XDG_STATE_HOME, ev: process.env.WF_EVIDENCE_DIR };
afterEach(() => {
  if (saved.state === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = saved.state;
  if (saved.ev === undefined) delete process.env.WF_EVIDENCE_DIR; else process.env.WF_EVIDENCE_DIR = saved.ev;
});

const complete = async (dir: string): Promise<void> => {
  write(planFile(dir), read(planFile(dir))
  .replace(/^- \*\*Overall status:\*\* .*$/m, '- **Overall status:** In progress').replace(/· ⬜ Draft$/gm, '· ✅ Reviewed').replace(/- \[ \]/g, '- [x]'));
  await reviewsDecided(dir);
};
const team = (dir: string, text: string): void => writeFileSync(join(dir, '.burhan', 'workflow.config'), text);
const local = (dir: string, text: string): void => writeFileSync(join(dir, '.burhan', 'local', 'workflow.config'), text);
const fullLine = async (dir: string): Promise<string> => (await cli(dir, ['guide', 'foo'])).out.split('\n').find((l) => l.startsWith('full run:')) ?? '(no full run line)';
const finish = (dir: string, ...args: string[]) => cli(dir, ['item', 'finish', 'foo', ...args]);
const status = (dir: string): string => /^- \*\*Overall status:\*\* (.*)$/m.exec(readFileSync(planFile(dir), 'utf8'))?.[1] ?? '';

const OLD_FULL = 'full run: cannot tell — WF_FULL_TEST_REGEX is empty or not usable, so the ledger cannot tell a full run from a run of one file';
const FIX = (key: string): string => `put the value in single quotes, as ${key}='…'`;
const LITERAL = "not a literal KEY=value line (allowed: KEY=word, KEY='text', KEY=\"text\" without $ ` \\ inside)";

test('guide names a refused WF_FULL_TEST_REGEX line and keeps the old words (AC-02)', async () => {
  const dir = await recordProject();
  team(dir, "WF_CODE_REGEX='[.]ts$'\nWF_FULL_TEST_REGEX=\"^npm test$\"\n");
  assert.equal(await fullLine(dir), `${OLD_FULL}; WF_FULL_TEST_REGEX is empty because its line .burhan/workflow.config:2 was refused by the config parser: ${FIX('WF_FULL_TEST_REGEX')}`);
  ledgerFor(dir, [{ kind: 'edit', ts: '2026-10-27T10:00:00Z', file: 'src/a.ts' }]);
  const ev = await cli(dir, ['evidence', '--item', 'foo']);
  assert.equal(ev.code, 0, ev.err);
  assert.ok(ev.out.split('\n').some((l) => l.includes('WF_FULL_TEST_REGEX is empty because its line .burhan/workflow.config:2 was refused')), 'evidence --item prints the same full run line');
});

test('guide does not blame a refused line of another key (AC-01)', async () => {
  const dir = await recordProject();
  team(dir, "WF_CODE_REGEX='[.]ts$'\nWF_TEST_REGEX=\"a$b\"\n");
  assert.equal(await fullLine(dir), OLD_FULL, 'WF_FULL_TEST_REGEX is plainly absent: the old words, nothing more');
  team(dir, "WF_FULL_TEST_REGEX='process[.]exitCode'\nWF_TEST_REGEX=\"a$b\"\n");
  const line = await fullLine(dir);
  assert.doesNotMatch(line, /refused|WF_FULL_TEST_REGEX is empty/, 'WF_FULL_TEST_REGEX has its value; the refused line is WF_TEST_REGEX\'s');
});

test('a plain empty key keeps the old messages and a single-quoted value is unaffected (AC-04)', async () => {
  const dir = await recordProject();
  team(dir, "WF_CODE_REGEX='[.]ts$'\nWF_FULL_TEST_REGEX=''\n");
  assert.equal(await fullLine(dir), OLD_FULL);
  team(dir, "WF_CODE_REGEX='[.]ts$'\nWF_FULL_TEST_REGEX='^npm test$'\n");
  assert.doesNotMatch(await fullLine(dir), /refused|WF_FULL_TEST_REGEX is empty/);

  const empty = await recordProject('process[.]exitCode', "WF_EVIDENCE_REGEX=''\n");
  await complete(empty);
  const e = await finish(empty);
  assert.equal(e.code, 2);
  assert.ok(e.err.includes('(WF_EVIDENCE_REGEX is empty, so any command counts, and the plan will say the proof was stated)'), e.err);
  assert.doesNotMatch(e.err, /refused/);

  const quoted = await recordProject('process[.]exitCode', "WF_EVIDENCE_REGEX='^node$'\n");
  await complete(quoted);
  const q = await finish(quoted);
  assert.equal(q.code, 2);
  assert.ok(q.err.includes('(a command WF_EVIDENCE_REGEX matches)'), q.err);
  assert.doesNotMatch(q.err, /refused/);
});

test('guide names a refused line of the local override file (AC-05)', async () => {
  const dir = await recordProject();
  team(dir, "WF_CODE_REGEX='[.]ts$'\n");
  local(dir, 'WF_FULL_TEST_REGEX="^npm test$"\n');
  assert.ok((await fullLine(dir)).endsWith(`WF_FULL_TEST_REGEX is empty because its line .burhan/local/workflow.config:1 was refused by the config parser: ${FIX('WF_FULL_TEST_REGEX')}`));
  team(dir, "WF_FULL_TEST_REGEX='^npm test$'\n");
  local(dir, 'WF_FULL_TEST_REGEX="^b$"\n');
  assert.doesNotMatch(await fullLine(dir), /refused|WF_FULL_TEST_REGEX is empty/, 'the team value stands; the refused local line changes nothing');
});

test('item finish names a refused WF_CODE_REGEX line in its refusal (AC-03)', async () => {
  const dir = await recordProject();
  await complete(dir);
  team(dir, "WF_CODE_REGEX=\"[.]ts$\"\nWF_EVIDENCE_REGEX='node'\n");
  ledgerFor(dir, [{ kind: 'edit', ts: '2026-10-27T10:00:00Z', file: 'src/a.ts' }]);
  const r = await finish(dir);
  assert.equal(r.code, 2);
  assert.ok(r.err.includes('in the evidence ledger. WF_CODE_REGEX or WF_EVIDENCE_REGEX is empty or not usable, so every edit counts as code and a proof cannot be recognised. WF_CODE_REGEX is empty because its line .burhan/workflow.config:1 was refused by the config parser: put the value in single quotes, as WF_CODE_REGEX=\'…\'. The ledger is written'), r.err);
  assert.doesNotMatch(r.err, /WF_EVIDENCE_REGEX is empty because/);
});

test('item finish names a refused WF_EVIDENCE_REGEX line in the hint, the stated note and the stdout line (AC-03)', async () => {
  const dir = await recordProject('process[.]exitCode', 'WF_EVIDENCE_REGEX="^node$"\n'); // the third line of the config
  await complete(dir);
  const because = `WF_EVIDENCE_REGEX is empty because its line .burhan/workflow.config:3 was refused by the config parser: ${FIX('WF_EVIDENCE_REGEX')}`;
  const refused = await finish(dir);
  assert.equal(refused.code, 2);
  assert.ok(refused.err.includes(`(WF_EVIDENCE_REGEX is empty, so any command counts, and the plan will say the proof was stated; ${because})`), refused.err);
  assert.equal((await verifyRun(dir, 0)).code, 0);
  const done = await finish(dir);
  assert.equal(done.code, 0, done.err);
  assert.ok(done.out.includes(`(evidence stated, not proven: WF_EVIDENCE_REGEX is empty, so the burhan verify command was not checked to be a proof command; ${because})`), done.out);
  assert.match(status(dir), /^Completed · stated evidence: burhan verify .* passed at \S+ on the current code state; WF_EVIDENCE_REGEX is empty, so any command counted; WF_EVIDENCE_REGEX is empty because its line \.burhan\/workflow\.config:3 was refused/);
});

test('a later valid empty line keeps the old messages (AC-04)', async () => {
  const dir = await recordProject();
  team(dir, "WF_CODE_REGEX='[.]ts$'\nWF_FULL_TEST_REGEX=\"^npm test$\"\nWF_FULL_TEST_REGEX=''\n");
  assert.equal(await fullLine(dir), OLD_FULL, 'same file: the key is plainly empty');
  team(dir, "WF_CODE_REGEX='[.]ts$'\nWF_FULL_TEST_REGEX=\"^npm test$\"\n");
  local(dir, "WF_FULL_TEST_REGEX=''\n");
  assert.equal(await fullLine(dir), OLD_FULL, 'other file: the local empty line gives the key its value');

  const empty = await recordProject('process[.]exitCode', "WF_EVIDENCE_REGEX=\"^node$\"\nWF_EVIDENCE_REGEX=''\n");
  await complete(empty);
  const e = await finish(empty);
  assert.equal(e.code, 2);
  assert.ok(e.err.includes('(WF_EVIDENCE_REGEX is empty, so any command counts, and the plan will say the proof was stated)'), e.err);
  assert.doesNotMatch(e.err, /refused/);
});

test("guide and item finish give the parser's reason for a refusal that single quotes do not fix (AC-04)", async () => {
  const dir = await recordProject();
  team(dir, "WF_CODE_REGEX='[.]ts$'\nWF_FULL_TEST_REGEX='^npm test\n");
  assert.equal(await fullLine(dir), `${OLD_FULL}; WF_FULL_TEST_REGEX is empty because its line .burhan/workflow.config:2 was refused by the config parser: ${LITERAL}`);

  const spaced = await recordProject('process[.]exitCode', "WF_EVIDENCE_REGEX = 'node'\n"); // the third line of the config
  await complete(spaced);
  const because = `WF_EVIDENCE_REGEX is empty because its line .burhan/workflow.config:3 was refused by the config parser: ${LITERAL}`;
  const refused = await finish(spaced);
  assert.equal(refused.code, 2);
  assert.ok(refused.err.includes(`(WF_EVIDENCE_REGEX is empty, so any command counts, and the plan will say the proof was stated; ${because})`), refused.err);
  assert.doesNotMatch(refused.err, /single quotes/, 'no false advice');
  assert.equal((await verifyRun(spaced, 0)).code, 0);
  const done = await finish(spaced);
  assert.equal(done.code, 0, done.err);
  assert.ok(done.out.includes(`(evidence stated, not proven: WF_EVIDENCE_REGEX is empty, so the burhan verify command was not checked to be a proof command; ${because})`), done.out);
  assert.ok(status(spaced).includes(`WF_EVIDENCE_REGEX is empty, so any command counted; ${because}`), status(spaced));
});
