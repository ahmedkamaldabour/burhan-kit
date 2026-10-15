import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers.js';
import { projectKey as cliProjectKey } from '../../src/lib/evidence.js';
import {
  evidenceRoot, projectKey, safeId, linkFile, linkedItem, linkItem, stateSnapshot,
  stateFingerprint, fingerprintSnapshot, fingerprintChanged, fingerprintRefresh, mtime,
} from '../../src/hooks/core/store.mjs';

/*
 * Store API for src/hooks/core/store.mts:
 * evidenceRoot(env) => string
 * projectKey(project) => string
 * safeId(id) => boolean
 * linkFile(project, session, env) => string | ''
 * linkedItem(project, session, nowSlugs, env) => string
 * linkItem(project, session, item, nowSlugs, env) => void
 * stateSnapshot(project, session, nowSlugs, env) => void
 * stateFingerprint(project, stateFile) => 'missing' | `file:${string}`
 * fingerprintSnapshot(project, session, stateFile, env) => void
 * fingerprintChanged(project, session, stateFile, env) => boolean
 * fingerprintRefresh(project, session, stateFile, env) => boolean
 * mtime(path) => number | null   // whole seconds since the Unix epoch, or null when unreadable
 */

const stateFile = '.burhan/local/PROGRESS.md';
const envAt = (root: string, more: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ WF_EVIDENCE_DIR: root, ...more });
const sessionDir = (project: string, session: string, root: string): string => join(root, projectKey(project), session);
const temps = (dir: string): string[] => readdirSync(dir).filter((name) => /^\.(?:item|now|state)\./.test(name));

function project(state = '## Now\n### alpha\n'): string {
  const dir = tmpDir('burhan-store-project-');
  mkdirSync(join(dir, '.burhan/local'), { recursive: true });
  writeFileSync(join(dir, stateFile), state);
  return dir;
}

function assertPrivate(path: string): void {
  if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600, `${path} is private`);
}

test('store key agrees with the CLI for physical project paths', () => {
  const p = project();
  assert.equal(projectKey(p), cliProjectKey(p));
  const linked = join(tmpDir('burhan-store-project-link-'), 'project');
  symlinkSync(p, linked);
  assert.equal(projectKey(linked), cliProjectKey(linked));
  assert.equal(projectKey(linked), projectKey(p), 'the symlink and its target share a store');
  assert.equal(projectKey(p), cliProjectKey(realpathSync(p)));
});

test('evidenceRoot accepts only an absolute override', () => {
  assert.equal(evidenceRoot({ WF_EVIDENCE_DIR: '/private/evidence' }), '/private/evidence');
  assert.equal(evidenceRoot({ WF_EVIDENCE_DIR: 'relative', XDG_STATE_HOME: '/state' }), '/state/burhan/evidence');
});

test('safeId permits only safe path components', () => {
  for (const id of ['alpha', 'A-1._z']) assert.equal(safeId(id), true, id);
  for (const id of ['', '.', '..', '../alpha', 'alpha/beta', 'alpha\\beta', 'alpha beta', 'é']) {
    assert.equal(safeId(id), false, id);
  }
});

test('links are private, atomic, and ignored once their slug leaves Now', () => {
  const p = project();
  const root = tmpDir('burhan-store-links-');
  const env = envAt(root);
  const now = ['alpha', 'beta'];

  linkItem(p, 'S1', 'beta', now, env);
  const file = linkFile(p, 'S1', env);
  assert.equal(file, join(sessionDir(p, 'S1', root), 'item'));
  assert.equal(linkedItem(p, 'S1', now, env), 'beta');
  assert.equal(linkedItem(p, 'S1', ['alpha'], env), '', 'a closed item is never resurrected from its old link');
  assertPrivate(file);
  if (process.platform !== 'win32') assert.equal(statSync(sessionDir(p, 'S1', root)).mode & 0o777, 0o700);
  assert.deepEqual(temps(sessionDir(p, 'S1', root)), [], 'rename leaves no item temp file behind');
});

test('now-slug snapshots are private and leave no temporary file', () => {
  const p = project();
  const root = tmpDir('burhan-store-now-');
  stateSnapshot(p, 'S1', ['alpha', 'beta'], envAt(root));
  const dir = sessionDir(p, 'S1', root);
  const file = join(dir, 'now-slugs');
  assert.equal(readFileSync(file, 'utf8'), 'alpha\nbeta\n');
  assertPrivate(file);
  if (process.platform !== 'win32') assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.deepEqual(temps(dir), [], 'rename leaves no now temp file behind');
});

test('state fingerprints hash the configured file and report missing files', () => {
  const p = project('## Now\n### alpha\n');
  assert.match(stateFingerprint(p, stateFile), /^file:[0-9a-f]{64}$/);
  assert.equal(stateFingerprint(p, 'missing.md'), 'missing');
});

test('fingerprint refresh fails closed without a baseline, advances only on a change, and otherwise preserves it', () => {
  const p = project('## Now\n### alpha\n');
  const root = tmpDir('burhan-store-fingerprint-');
  const env = envAt(root);
  const dir = sessionDir(p, 'S1', root);
  const baseline = join(dir, 'state-fingerprint');

  assert.equal(fingerprintChanged(p, 'S1', stateFile, env), false, 'no baseline fails closed');
  assert.equal(fingerprintRefresh(p, 'S1', stateFile, env), false, 'a refresh creates the initial baseline but does not call it a change');
  const first = readFileSync(baseline, 'utf8');
  assert.equal(fingerprintRefresh(p, 'S1', stateFile, env), false, 'an unchanged file keeps the baseline');
  assert.equal(readFileSync(baseline, 'utf8'), first);

  writeFileSync(join(p, stateFile), '## Now\n### beta\n');
  assert.equal(fingerprintChanged(p, 'S1', stateFile, env), true);
  assert.equal(fingerprintRefresh(p, 'S1', stateFile, env), true);
  assert.notEqual(readFileSync(baseline, 'utf8'), first, 'a changed file advances its baseline');
  assertPrivate(baseline);
  assert.deepEqual(temps(dir), [], 'rename leaves no state temp file behind');
});

test('fingerprint storage is off when the evidence ledger is disabled', () => {
  const p = project();
  const root = tmpDir('burhan-store-ledger-off-');
  for (const disabled of ['off', 'no', 'false', '0']) {
    const env = envAt(root, { WF_EVIDENCE_LEDGER: disabled });
    assert.equal(fingerprintChanged(p, 'S1', stateFile, env), false, disabled);
    assert.equal(fingerprintRefresh(p, 'S1', stateFile, env), false, disabled);
    fingerprintSnapshot(p, 'S1', stateFile, env);
  }
  assert.deepEqual(readdirSync(root), [], 'ledger-off fingerprint operations write nothing');
});

test('fingerprint snapshots provide a baseline and mtime returns whole epoch seconds', () => {
  const p = project();
  const root = tmpDir('burhan-store-snapshot-');
  const env = envAt(root);
  fingerprintSnapshot(p, 'S1', stateFile, env);
  assert.equal(fingerprintChanged(p, 'S1', stateFile, env), false);
  assert.match(readFileSync(join(sessionDir(p, 'S1', root), 'state-fingerprint'), 'utf8'), /^file:[0-9a-f]{64}\n$/);
  const file = join(p, stateFile);
  assert.equal(mtime(file), Math.floor(statSync(file).mtimeMs / 1000));
  assert.equal(mtime(join(p, 'absent')), null);
});
