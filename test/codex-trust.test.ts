import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_CODEX_CONFIG_BYTES, normalisePath, readCodexConfig, stateTableNames, trustedEvents } from '../src/lib/codex-trust.js';
import { tmpDir } from './helpers.js';

// All keys and paths below are SYNTHETIC (they contain "synthetic"); no test reads the real ~/.codex.
const home = (toml?: string | Buffer): string => {
  const h = tmpDir('burhan-synthetic-home-');
  if (toml !== undefined) { mkdirSync(join(h, '.codex')); writeFileSync(join(h, '.codex/config.toml'), toml); }
  return h;
};
const EV = ['session_start', 'user_prompt_submit', 'pre_tool_use', 'post_tool_use', 'stop'];
const snapshot = (dir: string): string => JSON.stringify(readdirSync(dir, { recursive: true }).sort().map((f) => [f, statSync(join(dir, String(f))).mtimeMs]));

test('reader: absent folder or file, a symlinked file or folder, not a regular file, over 1 MiB, unreadable → a skip reason', (t) => {
  assert.deepEqual(readCodexConfig(home()), { skip: 'absent' });
  const noFile = home(); mkdirSync(join(noFile, '.codex'));
  assert.deepEqual(readCodexConfig(noFile), { skip: 'absent' });
  assert.equal(MAX_CODEX_CONFIG_BYTES, 1024 * 1024);
  assert.deepEqual(readCodexConfig(home(Buffer.alloc(MAX_CODEX_CONFIG_BYTES + 1, 0x20))), { skip: 'large' });
  assert.ok('text' in readCodexConfig(home(Buffer.alloc(MAX_CODEX_CONFIG_BYTES, 0x20))), 'exactly 1 MiB is read');
  const dirAsFile = home(); mkdirSync(join(dirAsFile, '.codex/config.toml'), { recursive: true });
  assert.deepEqual(readCodexConfig(dirAsFile), { skip: 'not a file' });
  if (process.platform === 'win32') { t.diagnostic('symlink and chmod cases skipped on Windows'); return; }
  const real = home('[hooks.state."/synthetic/p/.codex/hooks.json:stop:0:0"]\n');
  const fileLink = home(); mkdirSync(join(fileLink, '.codex')); symlinkSync(join(real, '.codex/config.toml'), join(fileLink, '.codex/config.toml'));
  assert.deepEqual(readCodexConfig(fileLink), { skip: 'symlink' });
  const dirLink = home(); symlinkSync(join(real, '.codex'), join(dirLink, '.codex'));
  assert.deepEqual(readCodexConfig(dirLink), { skip: 'symlink' });
  if (process.getuid?.() === 0) { t.diagnostic('unreadable case skipped as root'); return; }
  const locked = home('x = 1\n'); chmodSync(join(locked, '.codex/config.toml'), 0o000);
  assert.deepEqual(readCodexConfig(locked), { skip: 'unreadable' });
  chmodSync(join(locked, '.codex/config.toml'), 0o600);
});

test('reader: never writes under home', () => {
  const h = home('[hooks.state."/synthetic/p/.codex/hooks.json:stop:0:0"]\ntrusted_hash = "synthetic"\n');
  const before = snapshot(h);
  readCodexConfig(h);
  assert.equal(snapshot(h), before);
});

test('parser: only [hooks.state.<key>] header names, basic and literal strings, escapes decoded', () => {
  const text = [
    '# [hooks.state."/synthetic/comment/.codex/hooks.json:stop:0:0"]',
    'model = "synthetic-model"',
    'note = "[hooks.state.\\"/synthetic/value/.codex/hooks.json:stop:0:0\\"]"',
    '[hooks.state."/synthetic/a/.codex/hooks.json:stop:0:0"]',
    'trusted_hash = "synthetic-hash"',
    "[hooks.state.'C:\\synthetic\\b\\.codex\\hooks.json:stop:1:2']",
    '[hooks.state."C:\\\\synthetic\\\\c\\\\.codex\\\\hooks.json:pre_tool_use:0:0"]  # trailing comment',
    '  [ hooks . state . "/synthetic/\\u0064/.codex/hooks.json:stop:0:0" ]\r',
    '[[hooks.state."/synthetic/array/.codex/hooks.json:stop:0:0"]]',
    '[hooks.state."/synthetic/sub/.codex/hooks.json:stop:0:0".deeper]',
    '[hooks.state."/synthetic/bad\\q/.codex/hooks.json:stop:0:0"]',
    '[hooks.state.bare_synthetic]',
    'block = """',
    '[hooks.state."/synthetic/in-multi/.codex/hooks.json:stop:0:0"]',
    '\\""" still inside',
    '"""',
    "lit = '''",
    '[hooks.state."/synthetic/in-literal/.codex/hooks.json:stop:0:0"]',
    "'''",
    '[other."/synthetic/other-table/.codex/hooks.json:stop:0:0"]',
  ].join('\n');
  assert.deepEqual(stateTableNames(text), [
    '/synthetic/a/.codex/hooks.json:stop:0:0',
    'C:\\synthetic\\b\\.codex\\hooks.json:stop:1:2',
    'C:\\synthetic\\c\\.codex\\hooks.json:pre_tool_use:0:0',
    '/synthetic/d/.codex/hooks.json:stop:0:0',
  ]);
});

test('matching: this project only, any group and handler, burhan events only, paths normalised', () => {
  const names = [
    '/synthetic/proj/.codex/hooks.json:stop:3:7',
    '/synthetic/proj/.codex/hooks.json:not_an_event:0:0',
    '/synthetic/proj2/.codex/hooks.json:session_start:0:0',
    'remember@synthetic-plugins:hooks/hooks.json:user_prompt_submit:0:0',
    '/synthetic/proj/.codex/hooks.json:pre_tool_use:x:0',
    '/synthetic/proj/.codex/hooks.json:post_tool_use:0:0',
  ];
  assert.deepEqual([...trustedEvents(names, ['/synthetic/proj/'], EV, false)].sort(), ['post_tool_use', 'stop']);
  assert.deepEqual([...trustedEvents(names, ['/synthetic/other'], EV, false)], []);
  const win = ['C:\\Synthetic\\Proj\\.codex\\hooks.json:stop:0:0'];
  assert.deepEqual([...trustedEvents(win, ['c:/synthetic/proj'], EV, true)], ['stop'], 'Windows: separators and case');
  assert.deepEqual([...trustedEvents(win, ['c:/synthetic/proj'], EV, false)], [], 'POSIX: case kept');
  assert.equal(normalisePath('C:\\synthetic\\x\\', true), 'c:/synthetic/x');
  assert.equal(normalisePath('C:\\', true), 'c:/');
  assert.equal(normalisePath('/', false), '/');
});

// doctor hands trustedEvents the resolved project (realTarget); a temp folder can itself sit under a link (macOS /var).
test('matching: a key under a symlink to the project counts', (t) => {
  if (process.platform === 'win32') { t.diagnostic('symlink case skipped on Windows'); return; }
  const real = realpathSync(tmpDir('burhan-synthetic-proj-')); const parent = tmpDir('burhan-synthetic-l-');
  symlinkSync(real, join(parent, 'link'));
  assert.deepEqual([...trustedEvents([`${join(parent, 'link')}/.codex/hooks.json:stop:0:0`], [real], EV, false)], ['stop']);
});

// QC fix round (QC M-1, M-2, M-4).
test('QC M-1: a leading BOM and CR-only line endings do not hide headers', () => {
  const key = '/synthetic/q/.codex/hooks.json:stop:0:0';
  assert.deepEqual(stateTableNames(`\uFEFF[hooks.state."${key}"]\nx = 1\n`), [key]);
  assert.deepEqual(stateTableNames(`x = 1\r[hooks.state."${key}"]\rtrusted_hash = "synthetic"\r[hooks.state."${key}2"]\r`), [key, `${key}2`]);
});

test('QC M-2: only the TOML 1.0 escapes of AC-02 are decoded; \\e and \\x are malformed', () => {
  assert.deepEqual(stateTableNames('[hooks.state."/synthetic/\\e/.codex/hooks.json:stop:0:0"]\n[hooks.state."/synthetic/\\x41/.codex/hooks.json:stop:0:0"]\n'), []);
});

test('QC M-4: a project at a root matches (POSIX "/", Windows "C:\\")', () => {
  assert.deepEqual([...trustedEvents(['/.codex/hooks.json:stop:0:0'], ['/'], EV, false)], ['stop']);
  assert.deepEqual([...trustedEvents(['C:\\.codex\\hooks.json:stop:0:0'], ['C:\\'], EV, true)], ['stop']);
  assert.deepEqual([...trustedEvents(['/.codex/hooks.json:stop:0:0'], ['/synthetic/proj'], EV, false)], []);
});

// Review fix round (SU1 review F-1…F-3).
test('F-1: on POSIX a backslash is part of a name, never a separator', () => {
  assert.deepEqual([...trustedEvents(['/synthetic/a\\b/.codex/hooks.json:stop:0:0'], ['/synthetic/a/b'], EV, false)], []);
  assert.deepEqual([...trustedEvents(['/synthetic/proj\\.codex\\hooks.json:stop:0:0'], ['/synthetic/proj'], EV, false)], []);
  assert.deepEqual([...trustedEvents(['/synthetic/a\\b/.codex/hooks.json:stop:0:0'], ['/synthetic/a\\b'], EV, false)], ['stop']);
  assert.equal(normalisePath('/synthetic/a\\b/', false), '/synthetic/a\\b');
});

test('F-2: an unreadable ~/.codex is "unreadable", not "absent"', (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0) { t.diagnostic('chmod case skipped (Windows or root)'); return; }
  const h = home('x = 1\n');
  chmodSync(join(h, '.codex'), 0o000);
  const r = readCodexConfig(h);
  chmodSync(join(h, '.codex'), 0o755);
  assert.deepEqual(r, { skip: 'unreadable' });
});

test('F-3: only space and tab count as TOML whitespace in a header', () => {
  assert.deepEqual(stateTableNames('[\u00a0hooks.state."/synthetic/n/.codex/hooks.json:stop:0:0"]\n[\thooks . state . "/synthetic/t/.codex/hooks.json:stop:0:0"\t]\n'), ['/synthetic/t/.codex/hooks.json:stop:0:0']);
});
