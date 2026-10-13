import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers.js';
import { parseEvent, relPath, stateNow, itemNow, itemBlock, itemField, itemRoute } from '../../src/hooks/core/lib.mjs';

// The Node side of tests/core/lib.test.sh (bash-internal), plus what the port adds (Windows paths).
const ev = (o: unknown) => parseEvent(JSON.stringify(o))!;

test('event: get mirrors jq -r "(path) // empty"', () => {
  const e = ev({ a: 'x\n\n', n: 3, t: true, f: false, z: null, s: { k: 'v' }, l: ['p', 'q'] });
  assert.equal(e.get('.a'), 'x', 'trailing newlines dropped, like $(…)');
  assert.equal(e.get('.n'), '3');
  assert.equal(e.get('.t'), 'true');
  assert.equal(e.get('.f'), '');
  assert.equal(e.get('.z'), '');
  assert.equal(e.get('.missing'), '');
  assert.equal(e.get('.s.k'), 'v');
  assert.equal(e.get('.s.k.deeper'), '');
  assert.deepEqual(e.list('.l'), ['p', 'q']);
  assert.deepEqual(e.list('.missing'), []);
  assert.deepEqual(e.list('.a'), []);
});
test('event: empty, invalid or non-object stdin -> null', () => {
  for (const s of ['', 'not json', '[1]', '"s"', 'null']) assert.equal(parseEvent(s), null, s);
});

test('relPath (wf_rel_stream)', () => {
  const P = '/p/proj';
  assert.equal(relPath('/p/proj/a/b.txt', P), 'a/b.txt');
  assert.equal(relPath('./c/d.txt', P), 'c/d.txt');
  assert.equal(relPath('e.txt', P), 'e.txt');
  assert.equal(relPath('../../x', P), '../../x');
  assert.equal(relPath('a/../../../x', P), '../../x');
  assert.equal(relPath('./a/./b/../c', P), 'a/c');
  assert.equal(relPath('a/b/..', P), 'a');
  assert.equal(relPath('/p/proj/s/../AI_SPEC/P.md', P), 'AI_SPEC/P.md');
  assert.equal(relPath('/other/x', P), '/other/x');
  assert.equal(relPath('/../x', P), '/x');
  assert.equal(relPath('/p/proj', P), '/p/proj', 'the project itself is not inside itself');
  assert.equal(relPath('/p/projX/a', P), '/p/projX/a');
});
test('relPath on Windows: backslashes and drive-letter case (W3)', () => {
  assert.equal(relPath('C:\\proj\\src\\a.ts', 'C:/proj', true), 'src/a.ts');
  assert.equal(relPath('c:\\proj\\src\\a.ts', 'C:\\proj', true), 'src/a.ts');
  assert.equal(relPath('src\\..\\b.ts', 'C:\\proj', true), 'b.ts');
  assert.equal(relPath('D:\\other\\a.ts', 'C:\\proj', true), 'D:/other/a.ts');
  assert.equal(relPath('a\\b', '/p', false), 'a\\b', 'not on Windows: a backslash is part of a name');
});

function project(state: string | null, file = '.workflow/local/PROGRESS.md'): string {
  const p = tmpDir('burhan-lib-');
  mkdirSync(join(p, '.workflow/local'), { recursive: true });
  if (state !== null) { mkdirSync(join(p, file, '..'), { recursive: true }); writeFileSync(join(p, file), state); }
  return p;
}
const cfg = { WF_STATE_FILE: '.workflow/local/PROGRESS.md' };

test('stateNow: only the "## Now" section; empty when absent', () => {
  const p = project('# PROGRESS\n## Now\n### foo\n- x\n## Waiting on you\n- secret\n');
  assert.equal(stateNow(p, cfg), '### foo\n- x');
  assert.equal(stateNow(project(null), cfg), '');
  assert.equal(stateNow(project('## Now  \n- a\n'), cfg), '- a', 'trailing blanks after the heading');
  assert.equal(stateNow(project('## Nowhere\n- a\n'), cfg), '');
  assert.equal(stateNow(project('## Now\n- a'), cfg), '- a', 'no final newline');
});

test('itemNow / itemBlock / itemField / itemRoute', () => {
  const now = '- **Branch:** main\n### fix-x\n- **Route:** bug / bounded · **Read-only:** no · **Mode:** auto\n#### notes\n- **Plan:** p.md\n### <slug>\n- **Mode:** step\n### other\n- **Mode:** step';
  assert.equal(itemNow(now), 'fix-x');
  assert.equal(itemBlock(now), '### fix-x\n- **Route:** bug / bounded · **Read-only:** no · **Mode:** auto\n#### notes\n- **Plan:** p.md');
  assert.equal(itemField(now, 'Mode'), 'auto');
  assert.equal(itemField(now, 'Read-only'), 'no');
  assert.equal(itemField(now, 'Plan'), 'p.md');
  assert.equal(itemField(now, 'Missing'), '');
  assert.equal(itemRoute(now), 'bug / bounded');
  assert.equal(itemNow('### <slug>\n- **Mode:** auto'), '', 'a template heading is no item');
  assert.equal(itemNow('### a\u00a0b x'), 'a\u00a0b', 'NBSP is no space in glibc [[:space:]]');
  assert.equal(itemBlock('- a\n- **Mode:** auto'), '- a\n- **Mode:** auto', 'no item: the whole Now');
  assert.equal(itemField('### a\n- **Mode:** <step | auto>', 'Mode'), '', 'a placeholder is no value');
  assert.equal(itemField('### a\n- **Mode:** <step>\n- **Mode:** auto', 'Mode'), '', 'only the first field counts');
  assert.equal(itemField('### a\n* **Mode:**   auto  ', 'Mode'), 'auto');
  assert.equal(itemField('### a\n- Note: **Mode:** auto', 'Mode'), '', 'the field opens the line or follows " · "');
  assert.equal(itemRoute('### a\n- **Type / scope:** feature / architectural'), 'feature / architectural', 'legacy label');
  assert.equal(itemRoute('### a\n- **Route:** feature / huge'), '');
  assert.equal(itemRoute('### a\n- **Route:** Feature / bounded'), '');
});
