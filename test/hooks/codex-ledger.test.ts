import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers.js';
import { run } from '../../src/hooks/main.mjs';
import { installRoot } from '../../src/hooks/install-root.mjs';
import { ledgerDir, prune, validId } from '../../src/hooks/adapters/codex/ledger.mjs';

const DAY = 86_400_000;
const age = (path: string, days: number): void => { const t = new Date(Date.now() - days * DAY); utimesSync(path, t, t); };

test('validId: a safe charset only, never . or ..', () => {
  for (const ok of ['S1', 'a.b-c_d', '0123']) assert.equal(validId(ok), true, ok);
  for (const bad of ['', '.', '..', 'a/b', '../x', 'a b', 'é', 'a\nb']) assert.equal(validId(bad), false, JSON.stringify(bad));
});

test('ledgerDir: WF_CODEX_LEDGER_DIR, else XDG_STATE_HOME, else ~/.local/state — empty values count as unset', () => {
  assert.equal(ledgerDir({ WF_CODEX_LEDGER_DIR: '/x' }), '/x');
  assert.equal(ledgerDir({ XDG_STATE_HOME: '/s' }), join('/s', 'burhan', 'codex'));
  assert.equal(ledgerDir({ WF_CODEX_LEDGER_DIR: '', XDG_STATE_HOME: '', HOME: '/h' }), join('/h', '.local', 'state', 'burhan', 'codex'));
});

test('prune: only inside a marked root, only old safe session dirs that hold nothing but ledgers', () => {
  const root = tmpDir('burhan-codex-prune-');
  const env = { WF_CODEX_LEDGER_DIR: root };
  const session = (name: string, days: number, files: string[]): string => {
    const dir = join(root, name); mkdirSync(dir, { recursive: true });
    for (const f of files) writeFileSync(join(dir, f), '{}\n');
    age(dir, days); return dir;
  };
  const oldLedger = session('old', 5, ['U1.jsonl']);
  const oldOther = session('old-with-note', 5, ['U1.jsonl', 'notes.txt']);
  const recent = session('recent', 1, ['U1.jsonl']);
  const justOver = session('three-days', 3.5, ['U1.jsonl']);
  const exactlyTwo = session('two-days', 2.5, ['U1.jsonl']);
  const unsafe = session('bad name', 9, ['U1.jsonl']);
  prune(env);
  for (const kept of [oldLedger, oldOther, recent, justOver, exactlyTwo, unsafe]) assert.equal(existsSync(kept), true, 'no marker: nothing is removed');
  writeFileSync(join(root, '.burhan-ledger'), '');
  prune(env);
  assert.equal(existsSync(oldLedger), false, 'old session with only ledgers: removed');
  assert.equal(existsSync(justOver), false, '3.5 days: removed (find -mtime +2 = at least 3 whole days)');
  assert.equal(existsSync(exactlyTwo), true, '2.5 days: kept (2 whole days is not more than 2)');
  assert.equal(existsSync(oldOther), true, 'a dir holding anything but .jsonl is kept');
  assert.equal(existsSync(recent), true);
  assert.equal(existsSync(unsafe), true, 'an unsafe dir name is never touched');
});

test('prune: never the home directory or a root without the marker', () => {
  const home = tmpDir('burhan-codex-home-');
  writeFileSync(join(home, '.burhan-ledger'), '');
  const dir = join(home, 'old'); mkdirSync(dir); writeFileSync(join(dir, 'U1.jsonl'), '{}\n'); age(dir, 9);
  prune({ WF_CODEX_LEDGER_DIR: home, HOME: home });
  assert.equal(existsSync(dir), true);
});

test('hook: a Stop consumes the turn ledger; a multi-file patch is reported once; an unknown check does neither', async () => {
  const root = tmpDir('burhan-codex-hook-');
  const project = tmpDir('burhan-codex-project-');
  mkdirSync(join(project, '.burhan'), { recursive: true });
  writeFileSync(join(project, '.burhan/workflow.config'), "WF_CODE_REGEX='\\.src$'\nWF_EVIDENCE_REGEX='^verify-it'\n");
  const env = { WF_CODEX_LEDGER_DIR: root };
  const patch = '*** Begin Patch\n*** Add File: x.src\n+a\n*** Add File: y.src\n+b\n*** End Patch\n';
  const post = JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 'S1', turn_id: 'U1', cwd: project, tool_name: 'apply_patch', tool_use_id: 't1', tool_input: { command: patch }, tool_response: 'Exit code: 0' });
  const out = (await run(['codex', 'hook', 'post-edit-reminder'], post, env)).stdout;
  assert.equal(out.split('failing test written FIRST').length - 1, 1, 'the reminder is said once for two files');
  assert.equal(existsSync(join(root, 'S1/U1.jsonl')), true, 'the PostToolUse was recorded');
  const stop = JSON.stringify({ hook_event_name: 'Stop', session_id: 'S1', turn_id: 'U1', cwd: project, last_assistant_message: 'All done ✅' });
  await run(['codex', 'hook', 'no-such-check'], stop, env);
  assert.equal(existsSync(join(root, 'S1/U1.jsonl')), true, 'an unknown check leaves the ledger alone');
  const blocked = (await run(['codex', 'hook', 'turn-audit'], stop, env)).stdout;
  assert.match(blocked, /"decision":"block"/u);
  assert.match(blocked, /VERIFICATION GATE/u);
  assert.equal(existsSync(join(root, 'S1/U1.jsonl')), false, 'the turn is over: its ledger is consumed');
});

test('prune: a non-ledger file at any depth keeps the session dir; the marker must be a regular file', () => {
  const root = tmpDir('burhan-codex-prune-deep-');
  writeFileSync(join(root, '.burhan-ledger'), '');
  const dir = join(root, 'S1');
  mkdirSync(join(dir, 'x.jsonl'), { recursive: true });
  writeFileSync(join(dir, 'x.jsonl', 'precious.txt'), 'keep');
  age(dir, 9);
  prune({ WF_CODEX_LEDGER_DIR: root });
  assert.equal(existsSync(dir), true, 'bash: find -mindepth 1 ! -name "*.jsonl" sees precious.txt');
  const fake = tmpDir('burhan-codex-prune-fake-');
  mkdirSync(join(fake, '.burhan-ledger'));
  const old = join(fake, 'S1'); mkdirSync(old); writeFileSync(join(old, 'U1.jsonl'), '{}\n'); age(old, 9);
  prune({ WF_CODEX_LEDGER_DIR: fake });
  assert.equal(existsSync(old), true, 'a directory named like the marker is not the marker');
});

test('hook: the project is where the kit is installed, not the payload cwd (Codex may start in a subdirectory)', async () => {
  const project = tmpDir('burhan-codex-install-');
  mkdirSync(join(project, '.burhan'), { recursive: true });
  mkdirSync(join(project, 'pkg/inner'), { recursive: true });
  writeFileSync(join(project, '.burhan/workflow.config'), "WF_CODE_REGEX='\\.src$'\n");
  const post = JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 'S1', turn_id: 'U1', cwd: join(project, 'pkg/inner'), tool_name: 'apply_patch', tool_use_id: 't1', tool_input: { command: '*** Begin Patch\n*** Add File: x.src\n+a\n*** End Patch\n' }, tool_response: 'Exit code: 0' });
  const env = { WF_CODEX_LEDGER_DIR: tmpDir('burhan-codex-ledger-') };
  const installed = join(project, '.burhan/hooks/node/main.mjs');
  const fromInstall = (await run(['codex', 'hook', 'post-edit-reminder'], post, env, undefined, installed)).stdout;
  assert.match(fromInstall, /failing test written FIRST/u, 'config found at the install root');
  const fromCwd = (await run(['codex', 'hook', 'post-edit-reminder'], post, env)).stdout;
  assert.equal(fromCwd, '', 'without an install path the cwd is the project, and it has no config');
});

test('installRoot: only <project>/.burhan/hooks/node/main.mjs names a project', () => {
  assert.equal(installRoot('/p/.burhan/hooks/node/main.mjs'), '/p');
  assert.equal(installRoot('C:\\p\\.burhan\\hooks\\node\\main.mjs'), 'C:/p');
  assert.equal(installRoot('/repo/dist/hooks/main.mjs'), '');
});
