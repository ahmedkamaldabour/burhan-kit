import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { jsonText, slashes, tmpDir } from '../helpers.js';
import { parseEvent } from '../../src/hooks/core/lib.mjs';
import { linkItem, projectKey } from '../../src/hooks/core/store.mjs';
import { evidencePrune, phaseNow } from '../../src/hooks/core/ledger.mjs';
import { readLedger } from '../../src/lib/evidence.js';
import { nodeDriver } from './drivers.js';
import { fixture, project, record, runCorpus } from './corpora/ledger.js';

test('turn-audit records the Bash + jq golden ledger (through the core entry)', () => runCorpus(nodeDriver));

function jsonlFiles(dir: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.jsonl')) out[slashes(relative(dir, path))] = readFileSync(path, 'utf8').split('\n').filter((line) => line !== '');
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

test('evidenceRecord (called directly) matches the Bash + jq golden ledger', () => {
  for (const c of fixture.cases) {
    const dir = project(c.state);
    const root = tmpDir('burhan-ledger-root-');
    for (const event of c.events) record(dir, root, event);
    const actual = jsonlFiles(join(root, projectKey(dir)));
    const expected = Object.fromEntries(Object.entries(c.files).filter(([name]) => name.endsWith('.jsonl')));
    const normalized = Object.fromEntries(Object.entries(actual).map(([name, lines]) => [name, lines.map((line) => line.replace(/"ts":"[^"]+"/, '"ts":"TS"').replaceAll(jsonText(dir), '@P').replaceAll(dir, '@P'))]));
    assert.deepEqual(normalized, expected, c.name);
  }
});

test('evidenceRecord writes private directories and files', { skip: process.platform === 'win32' }, () => {
  const dir = project('## Now\n### alpha\n- **Sub-unit:** build\n');
  const root = tmpDir('burhan-ledger-modes-');
  record(dir, root, fixture.cases[0].events[0]);
  const session = join(root, projectKey(dir), 'S1');
  assert.equal(statSync(root).mode & 0o777, 0o700);
  assert.equal(statSync(join(root, projectKey(dir))).mode & 0o777, 0o700);
  assert.equal(statSync(session).mode & 0o777, 0o700);
  assert.equal(statSync(join(session, 'T1.jsonl')).mode & 0o777, 0o600);
});

test('evidenceRecord is off for all disabled ledger values', () => {
  const dir = project('## Now\n### alpha\n');
  for (const value of ['off', 'no', 'false', '0']) {
    const root = join(tmpDir('burhan-ledger-off-'), value);
    record(dir, root, fixture.cases[0].events[0], { WF_EVIDENCE_LEDGER: value });
    assert.equal(existsSync(root), false, value);
  }
});

test('evidenceRecord fails open when the root cannot be written', { skip: process.platform === 'win32' }, () => {
  const dir = project('## Now\n### alpha\n');
  const root = tmpDir('burhan-ledger-readonly-');
  chmodSync(root, 0o555);
  try {
    assert.doesNotThrow(() => record(dir, root, fixture.cases[0].events[0]));
    assert.deepEqual(readdirSync(root), []);
  } finally { chmodSync(root, 0o700); }
});

test('readLedger reads records written by the Node hook', () => {
  const dir = project('## Now\n### alpha\n- **Sub-unit:** build\n');
  const root = tmpDir('burhan-ledger-reader-');
  record(dir, root, fixture.cases[0].events[0]);
  const rows = readLedger(dir, { WF_EVIDENCE_DIR: root });
  assert.deepEqual(rows.map((row: (typeof rows)[number] & { phase?: string | null }) => [row.item, row.phase, row.kind, row.file ?? row.cmd]), [
    ['alpha', 'build', 'edit', 'src/a.ts'], ['alpha', 'build', 'cmd', 'npm test'],
    ['alpha', 'build', 'cmd', 'sleep 9 &'], ['alpha', 'build', 'edit', '/elsewhere/x.md'],
    ['alpha', 'build', 'edit', 'docs/r.md'], ['alpha', 'build', 'cmd', 'echo é\ttab \x7f del "q" \\ b'],
  ]);
});

test('evidenceRecord uses the safe session item link when Now has multiple items', () => {
  const dir = project('## Now\n### alpha\n### beta\n- **Sub-unit:** build\n');
  const root = tmpDir('burhan-ledger-link-');
  linkItem(dir, 'S1', 'beta', ['alpha', 'beta'], { WF_EVIDENCE_DIR: root });
  record(dir, root, fixture.cases[0].events[0]);
  const row = JSON.parse(readFileSync(join(root, projectKey(dir), 'S1', 'T1.jsonl'), 'utf8').split('\n')[0]) as { item: string | null };
  assert.equal(row.item, 'beta');
});

test('phaseNow uses the first Sub-unit line in Now and cuts by code points', () => {
  assert.equal(phaseNow('### a\n- **Sub-unit:** first\n### b\n- **Sub-unit:** second'), 'first');
  assert.equal(phaseNow('### a\n- no phase'), '');
  assert.equal(phaseNow(`- **Sub-unit:** ${'é'.repeat(81)}`), 'é'.repeat(80));
});

test('evidencePrune only removes old, safe ledger sessions below a marked root', () => {
  const root = tmpDir('burhan-ledger-prune-');
  const key = '0123456789abcdef';
  const old = join(root, key, 'S1');
  const fresh = join(root, key, 'S2');
  const unsafe = join(root, key, 'bad session');
  const nonLedger = join(root, key, 'S3');
  const tempOnly = join(root, key, 'S4');
  const badKey = join(root, 'not-a-project-key', 'S1');
  for (const dir of [old, fresh, unsafe, nonLedger, tempOnly, badKey]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, '.burhan-evidence'), '');
  writeFileSync(join(old, 'T1.jsonl'), '{}\n');
  writeFileSync(join(fresh, 'T1.jsonl'), '{}\n');
  writeFileSync(join(unsafe, 'T1.jsonl'), '{}\n');
  writeFileSync(join(nonLedger, 'note.txt'), 'keep');
  writeFileSync(join(tempOnly, '.turn.leftover'), '');
  writeFileSync(join(badKey, 'T1.jsonl'), '{}\n');
  const now = new Date('2026-10-15T00:00:00Z');
  const oldTime = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
  for (const dir of [old, unsafe, nonLedger, tempOnly, badKey]) utimesSync(dir, oldTime, oldTime);
  evidencePrune(root, now);
  assert.equal(existsSync(old), false);
  assert.equal(existsSync(fresh), true);
  assert.equal(existsSync(unsafe), true);
  assert.equal(existsSync(nonLedger), true);
  assert.equal(existsSync(tempOnly), false, '.turn.* files are safe to prune');
  assert.equal(existsSync(badKey), true, 'only 16-hex project directories are candidates');
  assert.equal(existsSync(root), true, 'never deletes the root');

  const unmarked = tmpDir('burhan-ledger-unmarked-');
  const spared = join(unmarked, key, 'S1');
  mkdirSync(spared, { recursive: true }); writeFileSync(join(spared, 'T1.jsonl'), '{}\n'); utimesSync(spared, oldTime, oldTime);
  evidencePrune(unmarked, now);
  assert.equal(existsSync(spared), true, 'an unmarked root is never pruned');
});

test('the marker belongs only to a root created by the hook', () => {
  const dir = project('## Now\n### alpha\n');
  const existing = tmpDir('burhan-ledger-existing-');
  record(dir, existing, fixture.cases[0].events[0]);
  assert.equal(existsSync(join(existing, '.burhan-evidence')), false);

  const parent = tmpDir('burhan-ledger-parent-');
  const created = join(parent, 'new-root');
  record(dir, created, fixture.cases[0].events[0]);
  assert.equal(existsSync(join(created, '.burhan-evidence')), true);
});
