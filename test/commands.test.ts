import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CMD_MARK, isManagedCommand, withManagedMark } from '../src/lib/commands.js';

test('the marker goes right after the front matter', () => {
  const out = withManagedMark('---\ndescription: x\n---\n\nBody\n');
  assert.equal(out.split('\n')[3].startsWith(CMD_MARK), true);
  assert.ok(out.endsWith('\nBody\n'));
});

test('managed = our marker; anything else is foreign', () => {
  assert.equal(isManagedCommand(withManagedMark('---\na: b\n---\nx\n')), true);
  assert.equal(isManagedCommand('my own command\n'), false);
});

test('the mark counts only as the line right after the front matter, not quoted in prose or a code block', () => {
  assert.equal(isManagedCommand('see <!-- managed by burhan — x --> here\n'), false);
  assert.equal(isManagedCommand('```\n<!-- managed by burhan — x -->\n```\n'), false);
  assert.equal(isManagedCommand('---\na: b\n---\ntext <!-- managed by burhan — x -->\n'), false);
  assert.equal(isManagedCommand(withManagedMark('---\na: b\n---\nx\n')), true);
});
