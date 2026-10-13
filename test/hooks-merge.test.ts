import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeHooks, removeHooks, validHooksFile, type Settings } from '../src/lib/hooks-merge.js';
import { kitDir } from '../src/lib/kit.js';

const snippet = JSON.parse(readFileSync(join(kitDir(), 'hooks/adapters/claude/settings.snippet.json'), 'utf8')) as Settings;
const M = '.burhan/hooks/adapters/claude/hook.sh';
const previous = `bash "${M}" turn-audit --previous`;
const owned = [...Object.values(snippet.hooks ?? {}).flat().flatMap((group) => group.hooks.map((entry) => entry.command!)), previous];
const cmds = (s: Settings) => Object.values(s.hooks ?? {}).flat().flatMap((g) => g.hooks.map((h) => h.command ?? ''));

test('shape validation', () => {
  for (const ok of [{}, { hooks: {} }, { hooks: null }, { hooks: { Stop: [] } }, { env: { A: '1' } }]) assert.equal(validHooksFile(ok), true, JSON.stringify(ok));
  for (const bad of [null, [], 'x', { hooks: [] }, { hooks: 'x' }, { hooks: { Stop: {} } }, { hooks: { PreToolUse: [null] } }, { hooks: { Stop: [{ hooks: [{ command: 5 }] }] } }, { hooks: { Stop: [{ hooks: [null] }] } }, { hooks: { Stop: [{ hooks: 'x' }] } }]) assert.equal(validHooksFile(bad), false, JSON.stringify(bad));
});

test('into an empty file: our hooks, with the pre-commit timeout applied', () => {
  const out = mergeHooks({}, snippet, owned, 70);
  assert.equal(cmds(out).filter((c) => c.includes('turn-audit')).length, 1);
  assert.equal(out.hooks!.PreToolUse[0].hooks[0].timeout, 70);
});

test('unrelated keys and foreign hooks are kept; our stale entries are replaced', () => {
  const cur: Settings = {
    permissions: { allow: ['Bash(ls)'] },
    hooks: { Stop: [
      { hooks: [{ type: 'command', command: 'echo mine' }] },
      { hooks: [{ type: 'command', command: previous }] },
    ] },
  };
  const out = mergeHooks(cur, snippet, owned, 70);
  assert.deepEqual(out.permissions, { allow: ['Bash(ls)'] });
  assert.ok(cmds(out).includes('echo mine'));
  assert.ok(!cmds(out).some((c) => c.includes('--previous')));
  assert.equal(cmds(out).filter((c) => c.includes('turn-audit')).length, 1);
  assert.equal(out.hooks!.Stop.length, 1 + snippet.hooks!.Stop.length); // the emptied group is dropped
});

test('idempotent and does not mutate its inputs', () => {
  const before = JSON.stringify(snippet);
  const once = mergeHooks({}, snippet, owned, 70);
  assert.deepEqual(mergeHooks(once, snippet, owned, 70), once);
  assert.equal(JSON.stringify(snippet), before);
});

test('merge and removal preserve mentions, mixed groups, empty groups and unrelated JSON', () => {
  const foreign: Settings = { enabled: false, arbitrary: null, hooks: {
    Stop: [{ matcher: 'mine', metadata: { keep: true }, hooks: [{ command: `echo ${M}` }, { command: `bash "${M}" turn-audit --mine`, timeout: 11 }] }, { matcher: 'empty', hooks: [] }],
    Custom: [],
  } };
  const current = structuredClone(foreign);
  current.hooks!.Stop[0].hooks.splice(1, 0, { command: previous });
  const first = mergeHooks(current, snippet, owned, 70);
  assert.deepEqual(first.hooks!.Stop.slice(0, 2), foreign.hooks!.Stop);
  assert.deepEqual(mergeHooks(first, snippet, owned, 70), first);
  assert.deepEqual(removeHooks(first, owned), foreign);
  assert.deepEqual(current.hooks!.Stop[0].hooks[1], { command: previous });
});

test('removal with no exact owned commands leaves empty and null hooks values unchanged', () => {
  const examples: Settings[] = [{}, { hooks: {} }, { hooks: null }, { hooks: { Custom: [] } }];
  for (const settings of examples)
    assert.deepEqual(removeHooks(settings, owned), settings);
});
