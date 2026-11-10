import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyBlock, bootstrapBody, renderBlock, BlockError } from '../src/lib/bootstrap.js';
import { kitDir } from '../src/lib/kit.js';

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

// codex-trust-detect AC-07: the marker reaches Codex's model at SessionStart (verified in a real Codex session, V-0).
test('codex body: tells the agent to warn when the gates are missing; claude body unchanged', () => {
  const marker = readFileSync(join(kitDir(), 'hooks/core/gates.txt'), 'utf8').split('\n')[0];
  assert.ok(marker.startsWith('⚑ WORKFLOW GATES'), marker);
  assert.match(bootstrapBody('codex'), /no line beginning `⚑ WORKFLOW GATES`/);
  assert.match(bootstrapBody('codex'), /\/hooks/);
  assert.match(bootstrapBody('codex'), /never trust them for the user/);
  assert.match(bootstrapBody('codex'), /may not be running/, 'a missing marker is a hint, not proof (SU3 review F-1)');
  assert.match(bootstrapBody('codex'), /tell the user once/, 'said once, not every turn (SU3 review F-2)');
  assert.doesNotMatch(bootstrapBody('claude'), /WORKFLOW GATES/);
});

test('both bodies carry the start-up list, in the kit\'s words, without naming hooks', () => {
  for (const agent of ['claude', 'codex'] as const) {
    const body = bootstrapBody(agent);
    assert.ok(body.includes('Before the first edit of code, tests or config'), agent);
    const list = body.slice(body.indexOf('Before the first edit'), body.indexOf('At the start of every session'));
    assert.match(list, /^1\. Run `burhan guide`/m);
    assert.match(list, /^2\. When it names a process skill/m);
    assert.match(list, /AUTHORIZED/);
    assert.match(list, /burhan item new/);
    assert.match(list, /patch — <reason>/);
    assert.match(list, /burhan item finish <slug>/);
    assert.match(list, /burhan verify <slug> -- <command>/);
    assert.doesNotMatch(list, /hook/i);
    assert.ok(body.endsWith('At the start of every session, read the state file named in `.burhan/bindings.md` first.'), 'the closing line stays last (tests/init.test.sh edits it)');
  }
});

test('the start-up list says that a hand edit of the state file is still possible and only reported', () => {
  for (const agent of ['claude', 'codex'] as const) {
    const body = bootstrapBody(agent);
    assert.match(body, /A hand edit is still possible and nothing stops it; the turn-end report may name some of them, not all\./, agent);
    assert.match(body, /not by editing the file\. A hand edit is still possible/, agent);
  }
});

test('an older block whose body differs is replaced by the new one, the text around it is kept, no edited warning', () => {
  const oldBody = 'OLD BODY';
  const old = renderBlock('claude', '0.7.0').replace(bootstrapBody('claude'), oldBody).replace(/sha256=[0-9a-f]+/, `sha256=${sha(oldBody + '\n')}`);
  const r = applyBlock(`# Mine\n\n${old}\n\nbelow\n`, 'claude', V);
  assert.equal(r.editedInside, false);
  assert.ok(r.content.includes('# Mine'));
  assert.ok(r.content.includes('below'));
  assert.ok(!r.content.includes('OLD BODY'));
  assert.ok(r.content.includes('Before the first edit of code, tests or config'));
});
