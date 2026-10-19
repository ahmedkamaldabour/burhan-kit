import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { baselineState, parseFacts, readBaseline } from '../src/hooks/core/baseline.mjs';
import { runCli } from '../src/main.js';
import { capture, tmpDir } from './helpers.js';

// Project memory format: kit/templates/{project,context-area}.md and the Baseline row of kit/phases/files.md.
const HEAD = '| ID | Fact | Confidence (confirmed / inferred / unresolved) | Evidence | Verified (date @ commit) |\n|----|------|------------|----------|-----------|\n';
const SUP_HEAD = '| ID | Fact | Confidence | Evidence | Verified | Superseded by | When |\n|----|------|------------|----------|----------|---------------|------|\n';
const row = (id: string, o: { conf?: string; ev?: string; ver?: string } = {}): string =>
  `| ${id} | A fact. | ${o.conf ?? 'confirmed'} | ${o.ev ?? '`src/a.ts` sha256:0123456789abcdef'} | ${o.ver ?? '2026-10-19 @ fc7f444'} |\n`;
const area = (current: string, superseded = ''): string =>
  `# Data\nCurrent knowledge first.\n\n## Current\n${HEAD}${current}\n## Disputed\n\n## Superseded\n${SUP_HEAD}${superseded}`;

function project(baseline: string | null, areas: Record<string, string> = {}): string {
  const p = tmpDir('burhan-mem-');
  mkdirSync(join(p, '.burhan/context'), { recursive: true });
  if (baseline !== null) writeFileSync(join(p, '.burhan/PROJECT.md'), `# Demo\n${baseline}\n\n## Purpose\nDemo.\n`);
  for (const [name, text] of Object.entries(areas)) writeFileSync(join(p, '.burhan/context', name), text);
  return p;
}
async function check(p: string): Promise<{ rc: number; out: string }> {
  const { o, io } = capture(p);
  const rc = await runCli(['memory', 'check', p], io);
  return { rc, out: o.out + o.err };
}

test('Baseline: the three exact forms', () => {
  assert.deepEqual(readBaseline('- **Baseline:** Draft\n'), { state: 'draft', line: 1, legacy: false });
  assert.deepEqual(readBaseline('x\n- **Baseline:** Approved — Ahmed Dabour · 2026-10-19\n'), { state: 'approved', line: 2, legacy: false, name: 'Ahmed Dabour', date: '2026-10-19' });
  assert.deepEqual(readBaseline('- **Baseline:** Waived — سارة · 2026-10-19\n'), { state: 'waived', line: 1, legacy: false, name: 'سارة', date: '2026-10-19' });
});

test('Baseline: anything else is malformed — no name, a placeholder, a bad date, two lines, extra words', () => {
  for (const v of ['Approved', 'Approved 2026-10-19', 'Approved — <name> · YYYY-MM-DD', 'Approved — 123 · 2026-10-19', 'Approved — Ahmed · 2026-13-40', 'Waived — Ahmed', 'draft', 'Draft (awaiting approval)', 'Approved — A · B · 2026-10-19']) {
    assert.equal(readBaseline(`- **Baseline:** ${v}\n`).state, 'malformed', v);
  }
  assert.equal(readBaseline('- **Baseline:** Draft\n- **Baseline:** Draft\n').state, 'malformed');
  assert.equal(readBaseline('# Demo\nno field\n').state, 'malformed');
});

test('Baseline: legacy Memory status — "Approved <date>" is approved without a name, any other value is Draft', () => {
  assert.deepEqual(readBaseline('- **Memory status:** Approved 2026-10-15\n'), { state: 'approved', line: 1, legacy: true, date: '2026-10-15' });
  assert.equal(readBaseline('- **Memory status:** Draft (awaiting human approval) | Approved YYYY-MM-DD\n').state, 'draft');
  assert.equal(readBaseline('- **Memory status:** whatever\n').legacy, true);
});

test('baselineState: no PROJECT.md = none; the file decides otherwise', () => {
  assert.equal(baselineState(project(null)), 'none');
  assert.equal(baselineState(project('- **Baseline:** Draft')), 'draft');
  assert.equal(baselineState(project('- **Baseline:** Approved — Ahmed · 2026-10-19')), 'approved');
});

test('parseFacts: rows of Current and Superseded, with their state and line; placeholder and header rows skipped', () => {
  const text = area(row('DATA-users-email') + '| <AREA>-<short-slug> | | | `path/to/file` sha256:<16 hex> | YYYY-MM-DD @ <commit> |\n', '| DATA-old | Old. | inferred | `a` | 2026-10-01 | DATA-users-email | 2026-10-19 |\n');
  const r = parseFacts(text, 'data.md');
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.facts.map((f) => [f.id, f.state, f.line]), [['DATA-users-email', 'current', 7], ['DATA-old', 'superseded', 15]]);
});

test('parseFacts: a bad ID, confidence, verified, empty evidence or a short row fails with its line', () => {
  const cases: [string, RegExp][] = [
    [row('data-lower'), /ID/], [row('DATA_x'), /ID/], [row('DATA-01x', { conf: 'sure' }), /confidence/],
    [row('DATA-a', { ver: 'yesterday' }), /Verified/], [row('DATA-b', { ev: ' ' }), /evidence/],
    [row('DATA-c', { ev: '`a` sha256:ABCDEF0123456789' }), /hash/], [row('DATA-d', { ev: '`a` sha256:0123' }), /hash/],
    ['| DATA-e | A fact. | confirmed |\n', /columns/],
  ];
  for (const [r, msg] of cases) {
    const res = parseFacts(area(r), 'data.md');
    assert.equal(res.problems.length, 1, r);
    assert.equal(res.problems[0].line, 7, r);
    assert.match(res.problems[0].message, msg, r);
    assert.equal(res.problems[0].level, 'fail');
  }
});

test('parseFacts: the older Verified form "date · commit" and a date alone are accepted; several evidence items too', () => {
  for (const ver of ['2026-10-15 · 5ba75ca', '2026-10-15', '2026-10-15 @ 5ba75ca']) assert.deepEqual(parseFacts(area(row('DATA-x', { ver })), 'd.md').problems, [], ver);
  assert.deepEqual(parseFacts(area(row('DATA-y', { ev: '`a.ts:1-9` sha256:0123456789abcdef `b.ts#f` sha256:fedcba9876543210' })), 'd.md').problems, []);
  assert.deepEqual(parseFacts(area(row('DATA-z', { ev: 'person: Ahmed · 2026-10-19' })), 'd.md').problems, []);
});

test('memory check: a valid memory passes (exit 0) and says how much it read', async () => {
  const r = await check(project('- **Baseline:** Approved — Ahmed · 2026-10-19', { 'data.md': area(row('DATA-a') + row('DATA-b')), 'stack.md': area(row('STACK-node')) }));
  assert.equal(r.rc, 0, r.out);
  assert.match(r.out, /memory check: 3 facts in 2 files · 0 fail · 0 warn/);
});

test('memory check: no project memory is not an error', async () => {
  const p = tmpDir('burhan-mem-none-');
  const r = await check(p);
  assert.equal(r.rc, 0);
  assert.match(r.out, /no project memory/);
});

test('memory check: the same ID twice — across files, or in Current and Superseded — fails (exit 1)', async () => {
  const across = await check(project('- **Baseline:** Draft', { 'data.md': area(row('DATA-a')), 'stack.md': area(row('DATA-a')) }));
  assert.equal(across.rc, 1);
  assert.match(across.out, /FAIL \.burhan\/context\/stack\.md:7 duplicate ID DATA-a \(also \.burhan\/context\/data\.md:7\)/);
  const states = await check(project('- **Baseline:** Draft', { 'data.md': area(row('DATA-a'), '| DATA-a | Old. | inferred | `a` | 2026-10-01 | DATA-b | 2026-10-19 |\n') }));
  assert.equal(states.rc, 1);
  assert.match(states.out, /DATA-a is in two states \(current, superseded\)/);
});

test('memory check: each leftover merge marker at line start fails', async () => {
  for (const marker of ['<<<<<<< HEAD', '>>>>>>> theirs']) {
    const r = await check(project('- **Baseline:** Draft', { 'data.md': area(row('DATA-a') + `${marker}\n`) }));
    assert.equal(r.rc, 1, marker);
    assert.match(r.out, /FAIL \.burhan\/context\/data\.md:8 merge conflict marker/, marker);
  }
  const halfResolved = await check(project('- **Baseline:** Draft', { 'data.md': `${area(row('DATA-a'))}=======\ny\n>>>>>>> b\n` }));
  assert.equal((halfResolved.out.match(/merge conflict marker/g) ?? []).length, 2, 'a ======= is a marker when the file has another marker');
  const inProject = await check(project('- **Baseline:** Draft\n<<<<<<< HEAD'));
  assert.match(inProject.out, /FAIL \.burhan\/PROJECT\.md:3 merge conflict marker/);
});

test('memory check: a malformed Baseline fails with its line; the legacy field is a warning to update', async () => {
  const bad = await check(project('- **Baseline:** Approved'));
  assert.equal(bad.rc, 1);
  assert.match(bad.out, /FAIL \.burhan\/PROJECT\.md:2 Baseline/);
  const legacy = await check(project('- **Memory status:** Approved 2026-10-15'));
  assert.equal(legacy.rc, 0, legacy.out);
  assert.match(legacy.out, /WARN \.burhan\/PROJECT\.md:2 .*Memory status/);
});

test('memory check: a secret-looking value warns (exit 0) and is never printed', async () => {
  const lines = ['-----BEGIN RSA PRIVATE KEY-----', 'key AKIAABCDEFGHIJKLMNOP here', 'password=hunter2xyz', 'api_key: sk-livevalue123'];
  for (const l of lines) {
    const r = await check(project('- **Baseline:** Draft', { 'env.md': area(row('ENV-a')) + `\n${l}\n` }));
    assert.equal(r.rc, 0, l);
    assert.match(r.out, /WARN \.burhan\/context\/env\.md:\d+ looks like a secret/, l);
    for (const value of ['hunter2xyz', 'AKIAABCDEFGHIJKLMNOP', 'sk-livevalue123', 'RSA PRIVATE KEY']) assert.ok(!r.out.includes(value), `${value} printed`);
  }
});

test('memory check: a symlinked area file is not followed (warn)', async (t) => {
  if (process.platform === 'win32') { t.skip('symlinks need privileges on Windows'); return; }
  const p = project('- **Baseline:** Draft', { 'data.md': area(row('DATA-a')) });
  const outside = join(tmpDir('burhan-mem-out-'), 'x.md'); writeFileSync(outside, area(row('DATA-a')));
  symlinkSync(outside, join(p, '.burhan/context/link.md'));
  const r = await check(p);
  assert.equal(r.rc, 0, r.out);
  assert.match(r.out, /WARN \.burhan\/context\/link\.md symlink not followed/);
  assert.match(r.out, /1 facts in 1 files/);
});

// Review fix round (SU2 review F-1…F-9).
test('F-1: a long Baseline value is answered at once (no catastrophic backtracking)', () => {
  for (const v of [`Approved — ${'a '.repeat(100_000)}`, `Waived — ${'x'.repeat(200_000)} ·`, `Approved — ${'·'.repeat(50_000)}`]) {
    const t0 = performance.now();
    assert.equal(readBaseline(`- **Baseline:** ${v}\n`).state, 'malformed');
    assert.ok(performance.now() - t0 < 200, `took ${performance.now() - t0} ms`);
  }
  assert.equal(readBaseline('- **Baseline:** Approved — Dr. Ahmed K. Dabour · 2026-10-19\n').name, 'Dr. Ahmed K. Dabour');
});

test('F-2: a symlinked PROJECT.md or context folder is not followed', async (t) => {
  if (process.platform === 'win32') { t.skip('symlinks need privileges on Windows'); return; }
  const outside = tmpDir('burhan-mem-out2-');
  writeFileSync(join(outside, 'PROJECT.md'), '- **Baseline:** Approved — Eve · 2026-10-19\npassword=leakedvalue1\n');
  mkdirSync(join(outside, 'context')); writeFileSync(join(outside, 'context/data.md'), area(row('DATA-out')));
  const p = tmpDir('burhan-mem-link-'); mkdirSync(join(p, '.burhan'));
  symlinkSync(join(outside, 'PROJECT.md'), join(p, '.burhan/PROJECT.md'));
  symlinkSync(join(outside, 'context'), join(p, '.burhan/context'));
  assert.equal(baselineState(p), 'none');
  const r = await check(p);
  assert.equal(r.rc, 0, r.out);
  assert.match(r.out, /WARN \.burhan\/PROJECT\.md symlink not followed/);
  assert.match(r.out, /WARN \.burhan\/context symlink not followed/);
  assert.ok(!r.out.includes('secret') && !r.out.includes('DATA-out'), r.out);
  assert.match(r.out, /0 facts in 0 files/);
});

test('F-3: an unreadable or oversized file is a clean FAIL, never a stack trace', async (t) => {
  const p = project('- **Baseline:** Draft', { 'data.md': area(row('DATA-a')) });
  mkdirSync(join(p, '.burhan/context/dir.md'));
  writeFileSync(join(p, '.burhan/context/big.md'), 'x'.repeat(1024 * 1024 + 1));
  const r = await check(p);
  assert.equal(r.rc, 1, r.out);
  assert.match(r.out, /FAIL \.burhan\/context\/big\.md larger than 1 MiB, not read/);
  assert.ok(!/\n\s+at /.test(r.out), r.out);
  const q = tmpDir('burhan-mem-dir-'); mkdirSync(join(q, '.burhan/PROJECT.md'), { recursive: true });
  const d = await check(q);
  assert.equal(d.rc, 1, d.out);
  assert.match(d.out, /FAIL \.burhan\/PROJECT\.md cannot be read/);
  assert.equal(baselineState(q), 'none');
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    const u = project('- **Baseline:** Draft', { 'data.md': area(row('DATA-a')) });
    const { chmodSync } = await import('node:fs');
    chmodSync(join(u, '.burhan/context/data.md'), 0o000);
    const ur = await check(u);
    chmodSync(join(u, '.burhan/context/data.md'), 0o644);
    assert.equal(ur.rc, 1);
    assert.match(ur.out, /FAIL \.burhan\/context\/data\.md cannot be read \(EACCES\)/);
  } else t.diagnostic('chmod case skipped (Windows or root)');
});

test('F-4: a Setext underline of seven = is not a merge marker; between real markers it is', async () => {
  const setext = await check(project('- **Baseline:** Draft', { 'data.md': `Title\n=======\n${area(row('DATA-a'))}` }));
  assert.equal(setext.rc, 0, setext.out);
  const real = await check(project('- **Baseline:** Draft', { 'data.md': `${area(row('DATA-a'))}<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> b\n` }));
  assert.equal((real.out.match(/merge conflict marker/g) ?? []).length, 3, real.out);
});

test('F-6/F-7: a short separator is not a row; rows under an unknown heading warn once', () => {
  assert.deepEqual(parseFacts(`## Current\n| ID | Fact | C | E | V |\n|-|-|-|-|-|\n${row('DATA-a')}`, 'd.md').problems, []);
  const r = parseFacts(`## Current\n${HEAD}${row('DATA-a')}\n## Notes\n| a | b |\n| c | d |\n`, 'd.md');
  assert.deepEqual(r.problems.map((p) => [p.level, p.line]), [['warn', 7]]);
  assert.match(r.problems[0]!.message, /Notes/);
});

test('F-9: a Disputed row has six columns and is parsed; escaped pipes, CRLF, a real date', () => {
  const disputed = '## Disputed\n| ID | Fact | Confidence | Evidence | Conflicting evidence | Raised |\n|--|--|--|--|--|--|\n| DATA-d | X. | inferred | `a` | `b` | 2026-10-19 |\n| DATA-e | X. | inferred | `a` | 2026-10-19 |\n';
  const d = parseFacts(disputed, 'd.md');
  assert.deepEqual(d.facts.map((f) => [f.id, f.state]), [['DATA-d', 'disputed']]);
  assert.deepEqual(d.problems.map((p) => p.line), [5]);
  assert.match(d.problems[0]!.message, /6 columns/);
  assert.deepEqual(parseFacts(area('| DATA-p | a \\| b | confirmed | `x` | 2026-10-19 |\n'), 'd.md').problems, []);
  const crlf = area(row('DATA-c')).replace(/\n/g, '\r\n');
  assert.deepEqual(parseFacts(crlf, 'd.md').facts.map((f) => f.id), ['DATA-c']);
  assert.equal(readBaseline('- **Baseline:** Approved — Ahmed · 2026-10-19\r\n').state, 'approved');
  assert.match(parseFacts(area(row('DATA-v', { ver: '2026-02-30' })), 'd.md').problems[0]?.message ?? '', /Verified/);
});

test('F-9: fails print before warnings; an empty context folder and a legacy-only PROJECT.md are checked', async () => {
  const r = await check(project('- **Baseline:** Draft', { 'a.md': area(row('DATA-a')) + '\npassword=abcdefgh\n', 'b.md': area(row('DATA-a')) }));
  const lines = r.out.trim().split('\n');
  assert.match(lines[0]!, /^FAIL /); assert.match(lines[1]!, /^WARN /);
  const empty = await check(project('- **Baseline:** Draft'));
  assert.equal(empty.rc, 0); assert.match(empty.out, /0 facts in 0 files · 0 fail · 0 warn/);
  const legacy = await check(project('- **Memory status:** Draft (awaiting human approval)'));
  assert.equal(legacy.rc, 0); assert.match(legacy.out, /1 warn/);
});
