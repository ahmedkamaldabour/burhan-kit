import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL_CONFIG, TEAM_CONFIG, parseConfig, readProjectConfig, refusedLineOf } from '../src/lib/config.js';
import { tmpDir } from './helpers.js';

const FIX = "put the value in single quotes, as WF_FULL_TEST_REGEX='…'";
const LITERAL = "not a literal KEY=value line (allowed: KEY=word, KEY='text', KEY=\"text\" without $ ` \\ inside)";

test('refusedLineOf names the refused line of the key and says single quotes (AC-01)', () => {
  const cfg = parseConfig("WF_CODE_REGEX='[.]ts$'\nWF_FULL_TEST_REGEX=\"^npm test$\"\n", '.burhan/workflow.config');
  assert.deepEqual(cfg.values, { WF_CODE_REGEX: '[.]ts$' }, 'control: the parser refuses the line and leaves the key unset');
  assert.equal(refusedLineOf(cfg, 'WF_FULL_TEST_REGEX'), `WF_FULL_TEST_REGEX is empty because its line .burhan/workflow.config:2 was refused by the config parser: ${FIX}`);
  const spaced = parseConfig('# a\n  WF_FULL_TEST_REGEX = "^npm test$"\n', 'f');
  assert.equal(refusedLineOf(spaced, 'WF_FULL_TEST_REGEX'), `WF_FULL_TEST_REGEX is empty because its line f:2 was refused by the config parser: ${LITERAL}`, 'blanks around = : single quotes do not fix it, so the parser\'s reason is given (R-2)');
});

test('refusedLineOf does not blame another key, a key with a value, or a key with no refused line (AC-01)', () => {
  const other = parseConfig('WF_TEST_REGEX="a$b"\nWF_FULL_TEST_REGEX_EXTRA="x$"\n', 'f');
  assert.equal(other.problems.length, 2, 'control: both lines are refused');
  assert.equal(refusedLineOf(other, 'WF_FULL_TEST_REGEX'), null, 'neither refused line belongs to this key (a longer key name is not this key)');
  assert.match(refusedLineOf(other, 'WF_TEST_REGEX') ?? '', /^WF_TEST_REGEX is empty because its line f:1 was refused/);
  assert.equal(refusedLineOf(parseConfig("WF_FULL_TEST_REGEX='^npm test$'\n", 'f'), 'WF_FULL_TEST_REGEX'), null, 'single quotes are read: no refused line');
  assert.equal(refusedLineOf(parseConfig("WF_FULL_TEST_REGEX=''\n", 'f'), 'WF_FULL_TEST_REGEX'), null, 'plain empty');
  assert.equal(refusedLineOf(parseConfig('', 'f'), 'WF_FULL_TEST_REGEX'), null, 'absent');
  assert.equal(refusedLineOf(parseConfig("WF_X='a'\nWF_X=\"b$\"\n", 'f'), 'WF_X'), null, 'an earlier valid line keeps the value: the refused one changes nothing');
});

test("refusedLineOf gives the parser's reason for a CRLF line (AC-01)", () => {
  const cfg = parseConfig("WF_FULL_TEST_REGEX='x'\r\n", 'f');
  assert.equal(refusedLineOf(cfg, 'WF_FULL_TEST_REGEX'), 'WF_FULL_TEST_REGEX is empty because its line f:1 was refused by the config parser: CRLF line ending — save the file with LF endings');
});

test('refusedLineOf reads the local file: its own path, and a value from the other file wins (AC-05)', () => {
  const dir = tmpDir('burhan-refused-');
  mkdirSync(join(dir, '.burhan', 'local'), { recursive: true });
  const team = (text: string): void => writeFileSync(join(dir, TEAM_CONFIG), text);
  const local = (text: string): void => writeFileSync(join(dir, LOCAL_CONFIG), text);

  team("WF_CODE_REGEX='[.]ts$'\n");
  local('WF_FULL_TEST_REGEX="^npm test$"\n');
  assert.equal(refusedLineOf(readProjectConfig(dir), 'WF_FULL_TEST_REGEX'), `WF_FULL_TEST_REGEX is empty because its line .burhan/local/workflow.config:1 was refused by the config parser: ${FIX}`);

  team('WF_FULL_TEST_REGEX="^a$"\n');
  local("WF_FULL_TEST_REGEX='^b$'\n");
  assert.equal(refusedLineOf(readProjectConfig(dir), 'WF_FULL_TEST_REGEX'), null, 'the local value fills the key the team line left unset');

  team("WF_FULL_TEST_REGEX='^a$'\n");
  local('WF_FULL_TEST_REGEX="^b$"\n');
  assert.equal(refusedLineOf(readProjectConfig(dir), 'WF_FULL_TEST_REGEX'), null, 'the team value stays when the local line is refused');

  team('WF_FULL_TEST_REGEX="^a$"\n');
  local('\nWF_FULL_TEST_REGEX="^b$"\n');
  assert.match(refusedLineOf(readProjectConfig(dir), 'WF_FULL_TEST_REGEX') ?? '', /its line \.burhan\/local\/workflow\.config:2 was refused/, 'both refused: the last one, the one that would have won');
});

test('refusedLineOf says nothing when a later valid empty line gives the key a value (AC-01)', () => {
  const same = parseConfig("WF_FULL_TEST_REGEX=\"^npm test$\"\nWF_FULL_TEST_REGEX=''\n", 'f');
  assert.equal(same.problems.length, 1, 'control: the first line is refused');
  assert.deepEqual(same.values, { WF_FULL_TEST_REGEX: '' }, 'control: the key is plainly empty by the later valid line');
  assert.equal(refusedLineOf(same, 'WF_FULL_TEST_REGEX'), null, 'the key is empty by a valid line, not because of the refused one');
  assert.match(refusedLineOf(parseConfig('WF_FULL_TEST_REGEX="^npm test$"\n', 'f'), 'WF_FULL_TEST_REGEX') ?? '', /^WF_FULL_TEST_REGEX is empty because its line f:1 was refused/, 'control: with no later line the refused one is still named');

  const dir = tmpDir('burhan-refused-empty-');
  mkdirSync(join(dir, '.burhan', 'local'), { recursive: true });
  const team = (text: string): void => writeFileSync(join(dir, TEAM_CONFIG), text);
  const local = (text: string): void => writeFileSync(join(dir, LOCAL_CONFIG), text);

  team('WF_FULL_TEST_REGEX="^a$"\n');
  local("WF_FULL_TEST_REGEX=''\n");
  const merged = readProjectConfig(dir);
  assert.equal(merged.problems.length, 1, 'control: the team line is refused');
  assert.equal(refusedLineOf(merged, 'WF_FULL_TEST_REGEX'), null, 'the local empty line gives the key its value');

  team("WF_FULL_TEST_REGEX=''\n");
  local('WF_FULL_TEST_REGEX="^b$"\n');
  assert.equal(refusedLineOf(readProjectConfig(dir), 'WF_FULL_TEST_REGEX'), null, 'the key keeps the team value \'\'; a refused local line is not blamed (R-3)');
});

test("refusedLineOf gives single-quote advice only when it is true, else the parser's reason (AC-02, AC-03)", () => {
  const say = (text: string): string | null => refusedLineOf(parseConfig(`${text}\n`, 'f'), 'WF_FULL_TEST_REGEX');
  const because = (how: string): string => `WF_FULL_TEST_REGEX is empty because its line f:1 was refused by the config parser: ${how}`;
  // true advice: a double-quoted value with $, a backtick or a backslash, no blanks around =, no quote inside
  for (const line of ['WF_FULL_TEST_REGEX="^npm test$"', 'WF_FULL_TEST_REGEX="a`b"', 'WF_FULL_TEST_REGEX="a\\b"', 'WF_FULL_TEST_REGEX="^a$" # note', '  WF_FULL_TEST_REGEX="^a$"  ']) {
    assert.equal(say(line), because(FIX), line);
  }
  // single quotes would not help (or are already there): the parser's own reason
  for (const line of [
    "WF_FULL_TEST_REGEX='^npm test", // unterminated quote
    "WF_FULL_TEST_REGEX = '^npm test$'", // single-quoted, blanks around =
    'WF_FULL_TEST_REGEX = "^npm test$"', // blanks around =
    'WF_FULL_TEST_REGEX="it\'s $x"', // a quote inside: it cannot be put in single quotes
    'WF_FULL_TEST_REGEX="a$b" junk', // text after the closing quote
    'WF_FULL_TEST_REGEX="a$b', // unterminated double quote
    'WF_FULL_TEST_REGEX=a b', // unquoted value with a blank
  ]) {
    assert.equal(say(line), because(LITERAL), line);
  }
  assert.equal(say("WF_FULL_TEST_REGEX='x'\r"), because('CRLF line ending — save the file with LF endings'), 'a CRLF line keeps its reason');
});

test("refusedLineOf does not advise single quotes for a key the parser would refuse (Deviation 1)", () => {
  const cfg = parseConfig('constructor="x$"\n', 'f');
  assert.equal(refusedLineOf(cfg, 'constructor'), `constructor is empty because its line f:1 was refused by the config parser: ${LITERAL}`);
});
