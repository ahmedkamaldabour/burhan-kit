import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeHooks, validHooksFile, type Settings } from '../src/lib/hooks-merge.js';
import { kitDir } from '../src/lib/kit.js';

const snippet = JSON.parse(readFileSync(join(kitDir(), 'hooks/adapters/claude/settings.snippet.json'), 'utf8')) as Settings;
const M = '.workflow/hooks/adapters/claude/hook.sh';
const cmds = (s: Settings) => Object.values(s.hooks ?? {}).flat().flatMap((g) => g.hooks.map((h) => h.command ?? ''));

test('shape validation', () => {
  for (const ok of [{}, { hooks: {} }, { hooks: null }, { hooks: { Stop: [] } }, { env: { A: '1' } }]) assert.equal(validHooksFile(ok), true, JSON.stringify(ok));
  for (const bad of [null, [], 'x', { hooks: [] }, { hooks: 'x' }, { hooks: { Stop: {} } }, { hooks: { PreToolUse: [null] } }, { hooks: { Stop: [{ hooks: [{ command: 5 }] }] } }, { hooks: { Stop: [{ hooks: [null] }] } }, { hooks: { Stop: [{ hooks: 'x' }] } }]) assert.equal(validHooksFile(bad), false, JSON.stringify(bad));
});

test('into an empty file: our hooks, with the pre-commit timeout applied', () => {
  const out = mergeHooks({}, snippet, M, 70);
  assert.equal(cmds(out).filter((c) => c.includes('turn-audit')).length, 1);
  assert.equal(out.hooks!.PreToolUse[0].hooks[0].timeout, 70);
});

test('unrelated keys and foreign hooks are kept; our stale entries are replaced', () => {
  const cur: Settings = {
    permissions: { allow: ['Bash(ls)'] },
    hooks: { Stop: [
      { hooks: [{ type: 'command', command: 'echo mine' }] },
      { hooks: [{ type: 'command', command: `bash "${M}" turn-audit --old` }] },
    ] },
  };
  const out = mergeHooks(cur, snippet, M, 70);
  assert.deepEqual(out.permissions, { allow: ['Bash(ls)'] });
  assert.ok(cmds(out).includes('echo mine'));
  assert.ok(!cmds(out).some((c) => c.includes('--old')));
  assert.equal(cmds(out).filter((c) => c.includes('turn-audit')).length, 1);
  assert.equal(out.hooks!.Stop.length, 1 + snippet.hooks!.Stop.length); // the emptied group is dropped
});

test('idempotent and does not mutate its inputs', () => {
  const before = JSON.stringify(snippet);
  const once = mergeHooks({}, snippet, M, 70);
  assert.deepEqual(mergeHooks(once, snippet, M, 70), once);
  assert.equal(JSON.stringify(snippet), before);
});
