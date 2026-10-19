import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { applyBlock, bootstrapBody, renderBlock, BlockError } from '../src/lib/bootstrap.js';

const V = '0.1.0';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const block = renderBlock('claude', V);

test('bodies: claude imports the rules, codex reads them and explains $ARGUMENTS', () => {
  assert.match(bootstrapBody('claude'), /^@\.burhan\/WORKFLOW\.md$/m);
  assert.match(bootstrapBody('claude'), /^@\.burhan\/bindings\.md$/m);
  assert.match(bootstrapBody('codex'), /Read `\.burhan\/WORKFLOW\.md`/);
  assert.match(bootstrapBody('codex'), /\.burhan\/commands\/e2e\.md/);
  assert.match(bootstrapBody('codex'), /\.burhan\/commands\/onboard\.md/);
  assert.match(bootstrapBody('codex'), /\$ARGUMENTS/);
});

test('exact Markdown delimiters surround version and body-hash metadata', () => {
  const [first, metadata] = block.split('\n');
  assert.equal(first, '<!-- burhan:start -->');
  assert.ok(metadata.startsWith(`<!-- burhan:metadata version=${V} sha256=${sha(bootstrapBody('claude') + '\n')} `));
  assert.ok(block.endsWith('\n<!-- burhan:end -->'));
});

test('absent file -> the block alone', () => {
  assert.deepEqual(applyBlock(null, 'claude', V), { content: block + '\n', editedInside: false });
});

test('appends after existing text with one blank line, with or without a final newline', () => {
  assert.equal(applyBlock('# Mine\n\nKeep.\n', 'claude', V).content, `# Mine\n\nKeep.\n\n${block}\n`);
  assert.equal(applyBlock('# Mine\n\nKeep.', 'claude', V).content, `# Mine\n\nKeep.\n\n${block}\n`);
});

test('idempotent, and text around the block is kept', () => {
  const once = applyBlock('top\n', 'claude', V).content + 'bottom\n';
  const twice = applyBlock(once, 'claude', V);
  assert.equal(twice.content, once);
  assert.equal(twice.editedInside, false);
});

test('a version bump refreshes the block without an "edited" warning', () => {
  const old = applyBlock('top\n', 'claude', '0.0.9').content;
  const r = applyBlock(old, 'claude', V);
  assert.equal(r.editedInside, false);
  assert.equal(r.content, `top\n\n${block}\n`);
});

test('edits inside the block are detected and replaced', () => {
  const edited = applyBlock('top\n', 'claude', V).content.replace('At the start', 'MINE. At the start');
  const r = applyBlock(edited, 'claude', V);
  assert.equal(r.editedInside, true);
  assert.ok(!r.content.includes('MINE.'));
});

test('insertion before metadata and missing metadata are treated as edits', () => {
  const original = applyBlock('top\n', 'claude', V).content + 'bottom\n';
  for (const edited of [
    original.replace('<!-- burhan:start -->\n', '<!-- burhan:start -->\nMY NOTE\n'),
    original.replace(/^<!-- burhan:metadata.*\n/m, ''),
  ]) {
    const result = applyBlock(edited, 'claude', V);
    assert.equal(result.editedInside, true);
    assert.equal(result.content, original);
  }
});

test('broken markers are refused', () => {
  assert.throws(() => applyBlock('<!-- burhan:start -->\nUSER\n', 'claude', V), BlockError);
  assert.throws(() => applyBlock('<!-- burhan:end -->\n<!-- burhan:start -->\n', 'claude', V), /before the begin/);
  assert.throws(() => applyBlock(`${block}\n${block}\n`, 'claude', V), /exactly one pair/);
});

test('CRLF files stay CRLF', () => {
  const r = applyBlock('a\r\nb\r\n', 'claude', V).content;
  assert.ok(r.split('\n').slice(0, -1).every((l) => l.endsWith('\r')));
  assert.ok(r.startsWith('a\r\nb\r\n\r\n<!-- burhan:start -->'));
});
