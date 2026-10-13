import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from './helpers.js';
import { spawnSync } from 'node:child_process';
import { parseConfig, readProjectConfig } from '../src/lib/config.js';
import { kitDir } from '../src/lib/kit.js';

const ALLOWED = [
  `A='x && y'`, `B="a b"`, `C=plain`, `D=''`, `E='\\.(ts|js)$'`, `F="x" # note`, `G=`,
  `H='(^|[;&| ])(npx jest)[[:space:]]*($|[;&|])'`, `  I=indented`, `J="tab\there"`,
];
const REJECTED = [`export X=1`, `X=$(cmd)`, `X="$HOME"`, `X=a b`, `if true; then`, `X=~/p`, `X="a\\.b"`, `x=lower`, `X=a\\b`, `X=a\u00a0`, `X='a'\v`];

/** What bash gets for each key after sourcing the file. */
function bashValues(file: string, keys: string[]): Record<string, string> {
  const r = spawnSync('bash', ['-c', '. "$1"; shift; for k; do printf "%s=%s\\0" "$k" "${!k}"; done', '_', file, ...keys], { encoding: 'utf8' });
  return Object.fromEntries(r.stdout.split('\0').filter(Boolean).map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));
}

test('allowed lines parse to exactly what bash sources', () => {
  const dir = tmpDir('burhan-cfg-');
  const file = join(dir, 'c'); writeFileSync(file, ALLOWED.join('\n') + '\n');
  const { values, problems } = parseConfig(readFileSync(file, 'utf8'));
  assert.deepEqual(problems, []);
  assert.equal(Object.keys(values).length, ALLOWED.length);
  assert.deepEqual(values, bashValues(file, Object.keys(values)));
});

test('single-quoted config values keep dollar signs and backslashes literal (AC-17)', () => {
  const { values, problems } = parseConfig("WF_CODE_REGEX='\\.(ts|tsx)$'\nWF_EVIDENCE_REGEX='\\$HOME\\\\bin'\n");
  assert.deepEqual(problems, []);
  assert.equal(values.WF_CODE_REGEX, '\\.(ts|tsx)$');
  assert.equal(values.WF_EVIDENCE_REGEX, '\\$HOME\\\\bin');
});

test('single-quoted values keep backticks literal; double-quoted values refuse $ ` \\ (AC-17, header grammar)', () => {
  const ok = parseConfig("WF_CHECK_CMD='echo `date`'\n");
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.values.WF_CHECK_CMD, 'echo `date`');
  for (const bad of ['WF_CHECK_CMD="echo `date`"', 'WF_CHECK_CMD="a$b"', 'WF_CHECK_CMD="a\\b"']) {
    assert.equal(parseConfig(bad + '\n').problems.length, 1, bad);
  }
});

test('the shipped config example is fully literal and agrees with bash', () => {
  const file = join(kitDir(), 'workflow.config.example');
  const { values, problems } = parseConfig(readFileSync(file, 'utf8'));
  assert.deepEqual(problems, []);
  assert.ok(Object.keys(values).length >= 10);
  assert.deepEqual(values, bashValues(file, Object.keys(values)));
});

test('non-literal lines are reported with their line number, never evaluated', () => {
  const { values, problems } = parseConfig(['# comment', '', ...REJECTED].join('\n'), 'cfg');
  assert.deepEqual(values, {});
  assert.deepEqual(problems.map((p) => p.line), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.equal(problems[0].file, 'cfg');
  assert.match(problems[0].reason, /literal KEY=value/);
});

test('CRLF lines are reported (bash would keep the \\r in the value)', () => {
  const { problems } = parseConfig('A=1\r\nB=2\n');
  assert.equal(problems.length, 1);
  assert.match(problems[0].reason, /CRLF/);
});

test('local config overrides the team config key by key', () => {
  const p = tmpDir('burhan-proj-');
  mkdirSync(join(p, '.burhan/local'), { recursive: true });
  writeFileSync(join(p, '.burhan/workflow.config'), 'WF_CHECK_CMD="team"\nWF_SKILLS=none\n');
  writeFileSync(join(p, '.burhan/local/workflow.config'), 'WF_CHECK_CMD="mine"\n');
  assert.deepEqual(readProjectConfig(p).values, { WF_CHECK_CMD: 'mine', WF_SKILLS: 'none' });
});

test('missing config files -> empty values, no problems', () => {
  const p = tmpDir('burhan-proj-');
  assert.deepEqual(readProjectConfig(p), { values: {}, problems: [] });
});
