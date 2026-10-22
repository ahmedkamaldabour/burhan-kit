import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseConfig } from '../src/lib/config.js';
import { BurhanError } from '../src/lib/errors.js';
import { applySetup, planSetup } from '../src/lib/setup/engine.js';
import { sensitiveRegex } from '../src/lib/setup/config-write.js';
import { parseSetArgs, setStack, stackInstructions, type StackValues } from '../src/lib/setup/stack.js';
import { capture, tmpDir } from './helpers.js';
import { install } from '../src/lib/install.js';
import { writeFileSync } from 'node:fs';

const home = tmpDir('burhan-stack-home-');
function installed(): string {
  const d = tmpDir('burhan-stack-');
  spawnSync('git', ['init', '-q'], { cwd: d });
  applySetup(planSetup(d, { agents: ['claude'], mode: 'step', docs: { kind: 'private' }, lang: 'en' }, home));
  return d;
}
const cfgText = (t: string): string => readFileSync(join(t, '.burhan/workflow.config'), 'utf8');
const cfgOf = (t: string) => parseConfig(cfgText(t)).values;
const v = (o: Partial<{ check: string; sensitive: string[] }> = {}) => ({ check: 'exit 0', sensitive: [], ...o });

test('setStack with a passing check saves it, marks done and writes the verify skill', async () => {
  const t = installed();
  assert.equal(cfgOf(t).WF_STACK_SETUP, 'pending');
  const { o, io } = capture(t);
  assert.equal(await setStack(t, v(), { force: false }, io), 0);
  assert.equal(cfgOf(t).WF_CHECK_CMD, 'exit 0');
  assert.equal(cfgOf(t).WF_STACK_SETUP, 'done');
  assert.ok(existsSync(join(t, '.claude/skills/burhan-verify/SKILL.md')));
  assert.match(o.out, /Running the check once: exit 0/);
});

test('a failing check saves nothing, exits 1 and says how to retry', async () => {
  const t = installed();
  const before = cfgText(t);
  const { o, io } = capture(t);
  assert.equal(await setStack(t, v({ check: 'exit 1' }), { force: false }, io), 1);
  assert.equal(cfgText(t), before);
  assert.match(o.out + o.err, /exit 1/);
  assert.match(o.out + o.err, /--force/);
});

test('--force saves a failing check', async () => {
  const t = installed();
  const { io } = capture(t);
  assert.equal(await setStack(t, v({ check: 'exit 1' }), { force: true }, io), 0);
  assert.equal(cfgOf(t).WF_CHECK_CMD, 'exit 1');
  assert.equal(cfgOf(t).WF_STACK_SETUP, 'done');
});

test('check=none saves an empty check and done', async () => {
  const t = installed();
  const { io } = capture(t);
  assert.equal(await setStack(t, v({ check: 'none' }), { force: false }, io), 0);
  assert.equal(cfgOf(t).WF_CHECK_CMD, '');
  assert.equal(cfgOf(t).WF_STACK_SETUP, 'done');
});

test('sensitive lists are written as regexes without removed keys', async () => {
  const t = installed();
  const { io } = capture(t);
  assert.equal(await setStack(t, v({ sensitive: ['app/Policies/'] }), { force: false }, io), 0);
  const c = cfgOf(t);
  assert.equal(c.WF_SENSITIVE_REGEX, sensitiveRegex(['app/Policies/']));
  for (const key of ['WF_FORBIDDEN_REGEX', 'WF_FORBIDDEN_REASON', 'WF_SINGLE_TEST_HINT']) assert.ok(!(key in c), key);
});

test('sensitive paths save the access-control default note, but keep an existing note (AC-19)', async () => {
  const t = installed();
  assert.equal(await setStack(t, v({ sensitive: ['src/auth'] }), { force: false }, capture(t).io), 0);
  assert.equal(cfgOf(t).WF_SENSITIVE_NOTE, 'Access-control path: re-read authorization and data scoping; test allowed AND denied cases.');

  const config = join(t, '.burhan/workflow.config');
  writeFileSync(config, cfgText(t).replace(/^WF_SENSITIVE_NOTE=.*$/m, "WF_SENSITIVE_NOTE='Keep this note'"));
  assert.equal(await setStack(t, v({ sensitive: ['src/admin'] }), { force: false }, capture(t).io), 0);
  assert.equal(cfgOf(t).WF_SENSITIVE_NOTE, 'Keep this note');
});

test('legacy config settings do not refuse a check and their lines are preserved', async () => {
  const t = installed();
  const legacy = "WF_FORBIDDEN_REGEX='^touch'\nWF_FORBIDDEN_REASON='legacy reason'\nWF_SINGLE_TEST_HINT='legacy runner'\n";
  writeFileSync(join(t, '.burhan/workflow.config'), cfgText(t) + legacy);
  // A portable "touch": the check runs in the project directory under bash or cmd.exe, and may not hold a single quote.
  writeFileSync(join(t, 'touch.js'), 'require("fs").writeFileSync(process.argv[2], "");\n');
  const marker = join(t, 'ran2.marker');
  const { o, io } = capture(t);
  assert.equal(await setStack(t, v({ check: 'node touch.js ran2.marker' }), { force: false }, io), 0);
  assert.ok(existsSync(marker));
  assert.ok(cfgText(t).endsWith(legacy));
  assert.doesNotMatch(o.out + o.err, /FORBIDDEN|NEVER RUN|legacy reason|legacy runner/);
});

test('a value with a single quote is refused and nothing is written', async () => {
  const t = installed();
  const before = cfgText(t);
  await assert.rejects(setStack(t, v({ check: "echo 'x'" }), { force: false }, capture(t).io), BurhanError);
  await assert.rejects(setStack(t, v({ sensitive: ["a'b"] }), { force: false }, capture(t).io), BurhanError);
  assert.equal(cfgText(t), before);
});

test('not installed -> a clear error', async () => {
  const d = tmpDir('burhan-stack-empty-');
  await assert.rejects(setStack(d, v(), { force: false }, capture(d).io), /not installed.*setup/);
});

test('parseSetArgs', () => {
  assert.deepEqual(parseSetArgs(['check=make lint', 'sensitive=p;q ']), { check: 'make lint', sensitive: ['p', 'q'] });
  assert.deepEqual(parseSetArgs(['check=none']), { check: 'none', sensitive: [] });
  assert.throws(() => parseSetArgs(['check=x', 'bogus=1']), BurhanError);
  for (const key of ['never-run', 'never-run-regex']) {
    assert.throws(() => parseSetArgs([`${key}=a`]), /removed/i);
    assert.throws(() => parseSetArgs(['check=x', `${key}=`]), /removed/i);
  }
  assert.throws(() => parseSetArgs(['check=']), BurhanError);
  assert.throws(() => parseSetArgs(['check=x', 'nokeyvalue']), BurhanError);
});

test('stackInstructions: the fixed block, never invent, no setting names', () => {
  for (const lang of ['en', 'ar'] as const) {
    const s = stackInstructions(lang);
    assert.ok(!s.includes('WF_'));
    assert.ok(s.includes('npx burhan-kit setup --set'));
    assert.doesNotMatch(s, /never[- ]run|forbidden|SINGLE_TEST_HINT|ممنوع|متتشغّلش/i);
  }
  const s = stackInstructions('en');
  for (const l of ['burhan needs one thing before it can check your work:', 'Recommended for this project (<stack>):', '  Check before commit   <command or "none found, tell me which to use">', '  Sensitive             <paths, or "nothing">', '● Use these   ○ Change something']) assert.ok(s.includes(l), l);
  assert.match(s, /never invent/i);
  assert.match(s, /ask/i);
});

test('stackInstructions permits only the approved workflow.config edit (AC-16)', () => {
  const en = stackInstructions('en');
  assert.ok(en.includes('The agent may edit .burhan/workflow.config only, after showing the diff and getting approval; it is a shared file, so the change reaches the team through review (a pull request) like code; never the kit-owned files.'));
  assert.ok(!en.includes('Do not edit the .burhan/ files yourself.'));
  const ar = stackInstructions('ar');
  assert.match(ar, /\.burhan\/workflow\.config/);
  assert.match(ar, /diff|الفرق/i);
  assert.match(ar, /موافق|موافقة/);
  assert.match(ar, /مشترك/);
  assert.match(ar, /review.*pull request|مراجعة.*طلب سحب/i);
  assert.match(ar, /زي الكود/);
  assert.match(ar, /ملفات.*kit|بتاعة.*kit/i);
});

test('setStack keeps a --no-bootstrap project without the bootstrap block (review I-1)', async () => {
  const t = tmpDir('burhan-stack-nob-');
  spawnSync('git', ['init', '-q', t]);
  install({ mode: 'init', target: t, agents: ['claude'], apply: true, bootstrap: false }, capture(t).io);
  assert.equal(existsSync(join(t, 'CLAUDE.md')), false);
  assert.equal(await setStack(t, v(), { force: false }, capture(t).io), 0);
  assert.equal(existsSync(join(t, 'CLAUDE.md')), false, 'no CLAUDE.md appeared');
  writeFileSync(join(t, 'CLAUDE.md'), '# my own notes\n');
  assert.equal(await setStack(t, v(), { force: false }, capture(t).io), 0);
  assert.equal(readFileSync(join(t, 'CLAUDE.md'), 'utf8'), '# my own notes\n', 'no block added to my own file');
});
test('setStack keeps the block in a project that has one', async () => {
  const t = installed();
  assert.match(readFileSync(join(t, 'CLAUDE.md'), 'utf8'), /<!-- burhan:start /);
  writeFileSync(join(t, 'CLAUDE.md'), readFileSync(join(t, 'CLAUDE.md'), 'utf8').replace('At the start', 'STALE BODY. At the start'));
  assert.equal(await setStack(t, v(), { force: false }, capture(t).io), 0);
  assert.match(readFileSync(join(t, 'CLAUDE.md'), 'utf8'), /<!-- burhan:start /);
  assert.doesNotMatch(readFileSync(join(t, 'CLAUDE.md'), 'utf8'), /STALE BODY/);
});

// first-use-fixes SU1: what counts as code, tests and proof is saved with the check, so the "done without proof" warning is not silent
const w = (o: Partial<StackValues> = {}): StackValues => ({ check: 'exit 0', sensitive: [], ...o });

test('parseSetArgs reads code, test and evidence next to check and sensitive, in any order', () => {
  const got = parseSetArgs(['evidence=^npm test', 'check=npm test', 'code=\\.js$', 'test=\\.test\\.js$', 'sensitive=src/auth']);
  assert.equal(got.check, 'npm test');
  assert.equal(got.code, '\\.js$');
  assert.equal(got.test, '\\.test\\.js$');
  assert.equal(got.evidence, '^npm test');
  assert.deepEqual(got.sensitive, ['src/auth']);
  assert.throws(() => parseSetArgs(['check=x', 'colour=red']), /code, test, evidence/);
});

test('setStack saves the three patterns with the check in one write', async () => {
  const t = installed();
  assert.equal(await setStack(t, w({ code: '\\.(js|ts)$', test: '\\.test\\.(js|ts)$', evidence: '^npm test' }), { force: false }, capture(t).io), 0);
  const c = cfgOf(t);
  assert.equal(c.WF_CODE_REGEX, '\\.(js|ts)$');
  assert.equal(c.WF_TEST_REGEX, '\\.test\\.(js|ts)$');
  assert.equal(c.WF_EVIDENCE_REGEX, '^npm test');
  assert.equal(c.WF_CHECK_CMD, 'exit 0');
  assert.equal(c.WF_STACK_SETUP, 'done');
});

test('a pattern the hooks refuse, or a value with a quote, saves nothing and does not run the check', async () => {
  const marker = 'node -e "require(\\"node:fs\\").writeFileSync(\\"ran.txt\\",\\"x\\")"';
  const cases: [Partial<StackValues>, RegExp][] = [[{ code: '(src)/\\1$' }, /code pattern/], [{ evidence: '.{30000}' }, /evidence pattern/], [{ test: "it's" }, /single quote/]];
  for (const [bad, why] of cases) {
    const t = installed();
    const before = cfgText(t);
    const { o, io } = capture(t);
    await assert.rejects(setStack(t, w({ check: marker, ...bad }), { force: false }, io), (e: unknown) => e instanceof BurhanError && why.test(e.message));
    assert.equal(cfgText(t), before, 'the config is untouched');
    assert.equal(existsSync(join(t, 'ran.txt')), false, 'the check was not run');
    assert.doesNotMatch(o.out, /Running the check/);
  }
});

test('leaving the pattern keys out keeps the ones already saved', async () => {
  const t = installed();
  assert.equal(await setStack(t, w({ code: '\\.js$', evidence: 'npm test' }), { force: false }, capture(t).io), 0);
  assert.equal(await setStack(t, w({ check: 'exit 0' }), { force: false }, capture(t).io), 0);
  assert.equal(cfgOf(t).WF_CODE_REGEX, '\\.js$');
  assert.equal(cfgOf(t).WF_EVIDENCE_REGEX, 'npm test');
});

test('the first-use instructions ask for the code, test and proof decisions in both languages and still show the person no patterns', () => {
  for (const lang of ['en', 'ar'] as const) {
    const text = stackInstructions(lang);
    assert.match(text, /Code files/);
    assert.match(text, /Test files/);
    assert.match(text, /Proof/);
    assert.match(text, /setup --set check=.* code=.* test=.* evidence=/);
    assert.match(text, /POSIX extended/);
  }
  assert.match(stackInstructions('en'), /no tables, no setting names, no patterns/);
});
