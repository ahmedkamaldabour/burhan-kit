import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hookKey, mergeHooks, readExistingHooks, removeHooks, snippetKeys, validHooksFile, type HookEntry, type Settings } from '../src/lib/hooks-merge.js';
import { kitDir } from '../src/lib/kit.js';
import { tmpDir } from './helpers.js';

const snippet = (rel: string): Settings => JSON.parse(readFileSync(join(kitDir(), 'hooks/adapters', rel), 'utf8')) as Settings;
const claudeBash = snippet('claude/settings.snippet.json');
const claudeNode = snippet('claude/settings.node.snippet.json');
const codexBash = snippet('codex/hooks.snippet.json');
const codexNode = snippet('codex/hooks.node.snippet.json');
const CHECKS = ['session-gates', 'prompt-router', 'pre-commit-check', 'post-edit-reminder', 'turn-audit'];
const entries = (s: Settings): HookEntry[] => Object.values(s.hooks ?? {}).flat().flatMap((g) => g.hooks);
const mine: HookEntry = { type: 'command', command: 'node', args: ['tools/my-hook.js'] };

test('the Claude Node snippet is exec form: node + the installed entry, no shell', () => {
  const list = entries(claudeNode);
  assert.equal(list.length, 5);
  for (const e of list) {
    assert.equal(e.command, 'node');
    assert.deepEqual((e.args as string[]).slice(0, 3), ['${CLAUDE_PROJECT_DIR}/.burhan/hooks/node/main.mjs', 'claude', 'hook']);
    assert.ok(CHECKS.includes((e.args as string[])[3]), String(e.args));
    assert.equal((e.args as string[]).length, 4);
  }
  assert.deepEqual(Object.keys(claudeNode.hooks!), Object.keys(claudeBash.hooks!), 'same events, same matchers');
  assert.equal(claudeNode.hooks!.PreToolUse[0].matcher, 'Bash');
});

test('the Codex Node snippet is one launcher in the shell-safe subset (S1 W2)', () => {
  const list = entries(codexNode);
  assert.equal(list.length, 5);
  for (const e of list) {
    const c = e.command as string;
    assert.match(c, /^node -e "[^"]*" codex hook [a-z-]+$/u, c);
    assert.doesNotMatch(c, /[$%^&|<>!`\\]/u, `forbidden character in: ${c}`);
    assert.ok(c.includes('.burhan') && c.includes('main.mjs'), 'finds the installed entry');
    assert.equal(e.args, undefined, 'Codex has no argv form');
  }
  assert.deepEqual(entries(codexNode).map((e) => (e.command as string).split(' ').pop()), entries(codexBash).map((e) => /\b(session-gates|prompt-router|pre-commit-check|post-edit-reminder|turn-audit)\b/u.exec(String(e.command))![1]));
});

test('hookKey tells a command-only entry from an exec-form entry, and one exec form from another', () => {
  assert.equal(hookKey({ command: 'echo x' }), 'echo x');
  assert.notEqual(hookKey({ command: 'node', args: ['a'] }), hookKey({ command: 'node', args: ['b'] }));
  assert.notEqual(hookKey({ command: 'node', args: ['a'] }), hookKey({ command: 'node' }));
  assert.equal(hookKey({ command: 'node', args: ['a'] }), hookKey({ type: 'command', command: 'node', args: ['a'], timeout: 5 }));
  assert.equal(snippetKeys(claudeNode).length, 5);
});

test('validHooksFile accepts args as an array of strings only', () => {
  const file = (e: unknown) => ({ hooks: { Stop: [{ hooks: [e] }] } });
  assert.equal(validHooksFile(file({ command: 'node', args: ['a'] })), true);
  for (const bad of [{ command: 'node', args: 'a' }, { command: 'node', args: [1] }, { command: 'node', args: null }]) assert.equal(validHooksFile(file(bad)), false, JSON.stringify(bad));
});

test('merge writes the exec form, applies the pre-commit timeout by args, keeps a user node hook, and is idempotent', () => {
  const owned = [...snippetKeys(claudeBash), ...snippetKeys(claudeNode)];
  const current: Settings = { hooks: { Stop: [{ hooks: [mine] }] } };
  const out = mergeHooks(current, claudeNode, owned, 70);
  assert.deepEqual(out.hooks!.Stop[0].hooks, [mine]);
  assert.equal(entries(out).filter((e) => e.command === 'node').length, 6);
  assert.equal(out.hooks!.PreToolUse[0].hooks[0].timeout, 70);
  assert.deepEqual(mergeHooks(out, claudeNode, owned, 70), out);
});

test('migration: the old bash entries are replaced by the Node ones, the user\'s hooks stay, nothing is duplicated', () => {
  const owned = [...snippetKeys(claudeBash), ...snippetKeys(claudeNode)];
  const old = mergeHooks({ hooks: { Stop: [{ hooks: [mine] }] } }, claudeBash, owned, 70);
  assert.equal(entries(old).filter((e) => String(e.command).includes('hook.sh')).length, 5);
  const upgraded = mergeHooks(old, claudeNode, owned, 70);
  assert.equal(entries(upgraded).filter((e) => String(e.command).includes('hook.sh')).length, 0);
  assert.equal(entries(upgraded).filter((e) => e.command === 'node' && (e.args as string[])[1] === 'claude').length, 5);
  assert.deepEqual(upgraded.hooks!.Stop[0].hooks, [mine]);
  assert.deepEqual(removeHooks(upgraded, owned), { hooks: { Stop: [{ hooks: [mine] }] } });
});

test('Codex: the old launcher is replaced by the new one; a user command is kept', () => {
  const owned = [...snippetKeys(codexBash), ...snippetKeys(codexNode)];
  const user: HookEntry = { type: 'command', command: 'echo mine' };
  const old = mergeHooks({ hooks: { Stop: [{ hooks: [user] }] } }, codexBash, owned, 70);
  const upgraded = mergeHooks(old, codexNode, owned, 70);
  assert.equal(entries(upgraded).filter((e) => String(e.command).includes('hook.sh')).length, 0);
  assert.equal(entries(upgraded).filter((e) => String(e.command).startsWith('node -e')).length, 5);
  assert.deepEqual(upgraded.hooks!.Stop[0].hooks, [user]);
});

test('readExistingHooks reports a user\'s node hook and not ours', () => {
  const dir = tmpDir('burhan-existing-');
  mkdirSync(join(dir, '.claude'), { recursive: true });
  mkdirSync(join(dir, '.burhan/hooks/adapters/claude'), { recursive: true });
  const owned = snippetKeys(claudeNode);
  const settings = mergeHooks({ hooks: { Stop: [{ hooks: [mine] }] } }, claudeNode, owned, 70);
  writeFileSync(join(dir, '.claude/settings.json'), JSON.stringify(settings));
  const found = readExistingHooks(dir, ['claude']);
  assert.deepEqual(found.map((h) => h.command), ['node']);
  assert.equal(JSON.parse(found[0].hookJson).args[0], 'tools/my-hook.js');
});
