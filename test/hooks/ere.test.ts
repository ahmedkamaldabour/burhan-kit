import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ere, ereTest } from '../../src/hooks/core/ere.mjs';

/** [pattern, text, matches] — what GNU grep -E (3.12, glibc C.UTF-8) answers for "any line of text matches".
 *  The differential test below re-checks every row against a real GNU grep when one is available. */
const CASES: [string, string, boolean][] = [
  // the config regexes in use (kit example, suites, this repo)
  ['\\.(ts|tsx|js)$', 'src/a.ts', true], ['\\.(ts|tsx|js)$', 'src/a.tsx.bak', false],
  ['\\.(php|blade\\.php)$', 'v/x.blade.php', true], ['\\.(py|go|rs|java|kt|cs)$', 'a.rs', true],
  ['^src/.*\\.js$', 'src/x/y.js', true], ['^src/.*\\.js$', 'lib/src/y.js', false],
  ['\\.(js|ts)\\b', 'a.ts.map', true], ['\\.(js|ts)\\b', 'a.tsx', false],
  ['\\.src$', 'lib/a.src', true], ['\\.check\\.src$', 'lib/a.check.src', true],
  ['^(src|kit/hooks|scripts)/.*\\.(ts|mts|mjs|sh|awk)$', 'kit/hooks/core/lib.sh', true],
  ['(^|/)test_[^/]*\\.py$', 'pkg/test_a.py', true], ['(^|/)test_[^/]*\\.py$', 'pkg/mytest_a.py', false],
  ['(^|/)tests?/.*Test\\.php$', 'tests/Unit/ATest.php', true],
  ['^(test/[^/]+\\.test\\.ts|tests/.+\\.test\\.sh)$', 'tests/core/x.test.sh', true],
  ['\\.(spec|test)\\.(ts|js)$', 'a.spec.js', true],
  ['^verify-it', 'verify-it src', true], ['\\bverify-it\\b', 'run verify-it now', true], ['\\bverify-it\\b', 'reverify-it', false],
  ['npm (run )?(test|lint)|npm run test:(node|bash)|bash tests/|node --test', 'npm run lint', true],
  ['pytest [^ ]+|go test ./', 'pytest tests/a.py', true], ['tsc --noEmit|eslint|npx jest [^ ]+', 'npx jest', false],
  ['(^|[;&| ])(npx jest|npm (run )?test)[[:space:]]*($|[;&|])', 'cd x && npm test', true],
  ['(^|[;&| ])(npx jest|npm (run )?test)[[:space:]]*($|[;&|])', 'npm test file.js', false],
  ['(^|[;&|][[:space:]]*)(npm publish|git push|git remote)([[:space:]]|$)', 'npm test && git push', true],
  ['(^|[;&|][[:space:]]*)(npm publish|git push|git remote)([[:space:]]|$)', 'echo "never git push"', false],
  ['(guard|polic(y|ies)|permission|role|auth|scope)', 'src/policies/a.ts', true],
  // multi-line text: any line, anchors per line, never across a newline
  ['^b$', 'a\nb\nc', true], ['a.b', 'a\nb', false], ['a[^x]b', 'a\nb', false], ['a\\sb', 'a\nb', false],
  ['a\\Wb', 'a\nb', false], ['a[[:space:]]b', 'a\nb', false], ['^a$', 'a\r', false], ['a.b', 'a\rb', true],
  // bracket expressions
  ['[]a]', ']', true], ['[^]a]', 'b', true], ['[^]a]', ']', false], ['[a-]', '-', true], ['[\\.]', '\\', true], ['[\\.]', 'x', false],
  ['^[[:alpha:]]+$', 'عربي', true], ['^[[:alpha:]]$', '٣', true], ['^[[:digit:]]$', '٣', false], ['^[[:digit:]]$', '7', true],
  ['^[[:alpha:]]$', 'َ', true], ['^[[:alpha:]]$', '²', false], ['^[[:alnum:]]$', 'Ⅻ', true],
  ['^[[:punct:]]$', '،', true], ['^[[:punct:]]$', '؟', true], ['^[[:punct:]]$', '✅', true], ['^[[:punct:]]$', '$', true],
  ['^[[:punct:]]$', '_', true], ['^[[:punct:]]$', '²', true], ['^[[:punct:]]$', '​', true], ['^[[:punct:]]$', 'a', false],
  ['^[[:space:]]$', ' ', false], ['^[[:space:]]$', ' ', true], ['^[[:space:]]$', ' ', false], ['^[[:space:]]$', '\t', true],
  ['^[[:blank:]]$', '　', true], ['^[[:blank:]]$', ' ', false], ['^[[:cntrl:]]$', '\u0085', true],
  ['^[[:upper:]]$', 'É', true], ['^[[:lower:]]$', 'é', true], ['^[[:upper:]]$', 'ǅ', true], ['^[[:lower:]]$', 'ǅ', true],
  ['^[[:xdigit:]]+$', 'fF09', true], ['^[[:graph:]]$', ' ', false], ['^[[:print:]]$', ' ', true],
  ['[ةه]', 'مدرسة', true], ['^[^[:alnum:]_]$', '-', true], ['^[^[:alnum:]_]$', '_', false],
  // GNU escapes and word boundaries (Unicode-aware, \w = [_[:alnum:]])
  ['\\<عربي\\>', 'نص عربي هنا', true], ['\\<ربي', 'عربي', false], ['^\\w+$', 'عربي_1', true], ['\\bdone\\b', 'all done.', true],
  ['\\bdone\\b', 'undone', false], ['x\\B', 'xy', true], ['\\.', 'a.b', true], ['\\.', 'ab', false], ['a\\+', 'a+', true],
  // intervals, quantifier edge cases
  ['^a{2}$', 'aa', true], ['^a{2,}$', 'aaa', true], ['^a{,2}$', 'aa', true], ['^a{,2}$', 'aaa', false], ['a{x', 'a{x', true],
  ['^{', '{', true], ['a}', 'a}', true], ['^*a', '*a', true], ['(*a)', '*a', true], ['x|*a', '*a', true],
  // an operator with nothing to repeat is a no-op; ^ and $ with a min-0 quantifier are optional, word assertions stay
  ['*\\.ts$', 'x.ts', true], ['+a', 'ba', true], ['+a', 'b', false], ['?a', 'b', false], ['{1,2}', 'b', true],
  ['^*a', 'ba', true], ['(*a)', 'ba', true], ['x|*a', 'ba', true], ['a|+b', 'b', true], ['^?a', 'ba', true],
  ['(^)*a', 'ba', true], ['(^)a', 'ba', false], ['^{2}a', 'ba', false], ['^+a', 'ba', false], ['$*', 'b', true],
  ['a$?', 'ba', true], ['\\<+a', 'ba', false], ['\\b?a', 'ba', false], ['\\<*a', 'ba', false], ['\\b*a', 'ba', false],
  ['a^b', 'ab', false], ['(^a)', 'ba', false], ['(a|^b)', 'b', true], ['()', 'b', true], ['a||b', 'x', true], ['(|a)', 'x', true],
  ['a{2}{3}', 'aaaaaa', true], ['a{2}{3}', 'aaaaa', false], ['a**', 'b', true], ['a+*', 'b', true],
  ['a{', 'a{', true], ['a{x', 'a{x', true], ['a{1', 'a{1', true], ['a{1x}', 'a{1x}', true], ['a{,}', 'b', true], ['a{,2}', 'b', true],
  ['a{1}}', 'a}', true], ['b{0}a', 'a', true], ['\\`a', 'ba', false], ["a\\'", 'ab', false],
  ['[a\\]]', 'a]', true], ['[\\]', '\\', true], ['a\\{2\\}', 'a{2}', true],
  ['^xa+?y$', 'xy', true], ['^$', '', false], ['^$', '\n', true], ['a)', 'a)', true],
];
const INVALID = ['(', '[', 'a{2,1}', 'a\\', '[[:nope:]]', '\\1', 'a{}', 'a{1,2,3}', 'a{1,2,}', 'a{,,}', '[a-c-e]', '[:alpha:]',
  '(a)|b\\1', '(a\\1)', '\\1(a)', '[]', '[^]', 'a{32768}'];

test('ere: the case table', () => {
  const bad: string[] = [];
  for (const [p, t, want] of CASES) if (ereTest(p, t) !== want) bad.push(`${JSON.stringify(p)} on ${JSON.stringify(t)}: want ${want}`);
  assert.deepEqual(bad, []);
});
/** Patterns that make a backtracking engine explode; grep answers at once, and so must the port (QC P1 I2). */
/** Valid for grep, refused by the port (the check stays silent; doctor names them): a back-reference needs a
 *  backtracking engine, and a pattern over the state cap is too large to match in bounded time. */
const UNSUPPORTED = ['(a)\\1', '^(ab)\\1$', '(a)(b|\\1)', '(a*)*\\1b', '.{30000}', '(a|b){1,2000}c', '((a|b){1,50}){1,50}c'];
test('ere: unsupported patterns -> null, and grep itself accepts them', () => {
  for (const p of UNSUPPORTED) assert.equal(ere(p), null, p);
  assert.notEqual(ere('.{1000}'), null, 'a plausible large repetition stays supported');
});
test('ere: the work per match is bounded — a large pattern on a long text stops in time (no match)', () => {
  const t0 = process.hrtime.bigint();
  assert.equal(ereTest('(a|b){1,400}c', 'ab'.repeat(50_000)), false);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 1000, `${ms.toFixed(0)} ms`);
});
test('ere: the budget never cuts a real match short — a long heredoc command, evidence at its end', () => {
  const evidence = 'npm (run )?(test|lint)|npm run test:(node|bash)|bash tests/|node --test';
  const cmd = "cat > big.txt <<'EOF'\n" + 'line of generated text, quite ordinary\n'.repeat(8000) + 'EOF\nnpm run lint';
  assert.ok(cmd.length > 300_000);
  assert.equal(ereTest(evidence, cmd), true);
  const commandPattern = '(^|[;&|][[:space:]]*)(npm publish|git push|git remote)([[:space:]]|$)';
  assert.equal(ereTest(commandPattern, cmd + ' && git push'), true);
  const huge = "cat > big.txt <<'EOF'\n" + 'line of generated text, quite ordinary\n'.repeat(32_000) + 'EOF\nnpm run lint';
  assert.ok(huge.length > 1_200_000);
  assert.equal(ereTest(evidence, huge), true, 'the budget grows with the text');
});
const PATHOLOGICAL: [string, string, boolean][] = [
  ['^(.*/)*[^/]*\\.test\\.ts$', 'src/' + 'ab/'.repeat(25) + 'x.md', false],
  ['(.*/)*.*\\.test\\.ts$', 'src/' + 'ab/'.repeat(25) + 'x.md', false],
  ['([a-z]*/?)*\\.ts$', 'abcdefghijklmnopqrstuvwxyz'.repeat(3) + '!', false],
  ['(a|aa)+$', 'a'.repeat(40) + 'b', false],
  ['(a*)*c', 'a'.repeat(40), false],
  ['(.*a){12}x', 'a'.repeat(30), false],
  ['^(a+)+$', 'a'.repeat(5000) + '!', false],
];
test('ere: no catastrophic backtracking — each pathological pattern answers in under 200 ms', () => {
  for (const [p, t, want] of PATHOLOGICAL) {
    const t0 = process.hrtime.bigint();
    assert.equal(ereTest(p, t), want, p);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 200, `${p}: ${ms.toFixed(0)} ms`);
  }
});
test('ere: invalid patterns -> null (the check stays silent, like grep exiting 2)', () => {
  for (const p of INVALID) assert.equal(ere(p), null, p);
});
test('ere: an empty pattern never matches (wf_match)', () => {
  assert.equal(ereTest('', 'anything'), false);
});
test('ere: case-insensitive option (grep -i)', () => {
  assert.equal(ereTest('status:', 'STATUS: x', { i: true }), true);
  assert.equal(ereTest('status:', 'STATUS: x'), false);
});

/** GNU grep under a UTF-8 locale, or null when this machine has none (macOS BSD grep, Windows). */
function gnuGrep(): { bin: string; env: NodeJS.ProcessEnv } | null {
  for (const bin of ['/usr/bin/grep', '/bin/grep', 'grep']) {
    const v = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (v.status !== 0 || !/GNU grep/.test(v.stdout)) continue;
    for (const loc of ['C.UTF-8', 'C.utf8', 'en_US.UTF-8']) {
      const env = { ...process.env, LC_ALL: loc };
      if (spawnSync(bin, ['-qE', '^.$'], { input: 'é', env }).status === 0) return { bin, env };
    }
  }
  return null;
}
const gnu = gnuGrep();
test('ere: unsupported patterns are valid for GNU grep (exit 0 or 1)', { skip: gnu ? false : 'no GNU grep with a UTF-8 locale here' }, () => {
  for (const p of UNSUPPORTED) assert.notEqual(spawnSync(gnu!.bin, ['-qE', '--', p], { input: 'x', env: gnu!.env }).status, 2, p);
});
test('ere: invalid patterns are invalid for GNU grep too (exit 2)', { skip: gnu ? false : 'no GNU grep with a UTF-8 locale here' }, () => {
  for (const p of INVALID) assert.equal(spawnSync(gnu!.bin, ['-qE', '--', p], { input: 'x', env: gnu!.env }).status, 2, p);
});
test('ere: every row agrees with GNU grep -E', { skip: gnu ? false : 'no GNU grep with a UTF-8 locale here' }, () => {
  const bad: string[] = [];
  for (const [p, t] of [...CASES, ...PATHOLOGICAL]) {
    const g = spawnSync(gnu!.bin, ['-qE', '--', p], { input: t, env: gnu!.env }).status === 0;
    if (ereTest(p, t) !== g) bad.push(`${JSON.stringify(p)} on ${JSON.stringify(t)}: grep ${g}`);
  }
  assert.deepEqual(bad, []);
});
