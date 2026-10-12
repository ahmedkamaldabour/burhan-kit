import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const dir = mkdtempSync(join(tmpdir(), 'burhan-cfg-'));
  const file = join(dir, 'c'); writeFileSync(file, ALLOWED.join('\n') + '\n');
  const { values, problems } = parseConfig(readFileSync(file, 'utf8'));
  assert.deepEqual(problems, []);
  assert.equal(Object.keys(values).length, ALLOWED.length);
  assert.deepEqual(values, bashValues(file, Object.keys(values)));
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
  const p = mkdtempSync(join(tmpdir(), 'burhan-proj-'));
  mkdirSync(join(p, '.workflow/local'), { recursive: true });
  writeFileSync(join(p, '.workflow/workflow.config'), 'WF_CHECK_CMD="team"\nWF_SKILLS=none\n');
  writeFileSync(join(p, '.workflow/local/workflow.config'), 'WF_CHECK_CMD="mine"\n');
  assert.deepEqual(readProjectConfig(p).values, { WF_CHECK_CMD: 'mine', WF_SKILLS: 'none' });
});

test('missing config files -> empty values, no problems', () => {
  const p = mkdtempSync(join(tmpdir(), 'burhan-proj-'));
  assert.deepEqual(readProjectConfig(p), { values: {}, problems: [] });
});
