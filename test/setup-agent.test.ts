import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCli } from '../src/main.js';
import { scriptedPrompter } from '../src/lib/setup/prompter.js';
import { runWizard } from '../src/lib/setup/wizard.js';
import { currentAnswers, recommended, type SetupAnswers } from '../src/lib/setup/engine.js';
import { messages, QUESTIONS } from '../src/lib/setup/messages.js';
import { capture, tmpDir } from './helpers.js';

const home = tmpDir('burhan-agent-home-');
process.env.HOME = home;
const work = tmpDir('burhan-agent-work-');

const repo = (): string => {
  const d = tmpDir('burhan-agent-');
  spawnSync('git', ['init', '-q'], { cwd: d });
  writeFileSync(join(d, 'CLAUDE.md'), '# My project\n\nUser text that must survive.\n');
  writeFileSync(join(d, 'README.md'), 'hello\n');
  mkdirSync(join(d, 'src'));
  writeFileSync(join(d, 'src/a.txt'), 'a\n');
  return d;
};
function tree(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const e of readdirSync(dir)) {
    if (e === '.git') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { out[p.slice(base.length) + '/'] = ''; tree(p, base, out); } else out[p.slice(base.length)] = readFileSync(p, 'utf8');
  }
  return out;
}
const hash = (d: string): string => createHash('sha256').update(JSON.stringify(tree(d))).digest('hex');
const answersFile = (v: unknown): string => {
  const f = join(work, `a-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v));
  return f;
};
const agentJson = (out: string): { recommended: SetupAnswers; questions: { id: string; text: string; choices: { value: string; label: string; hint?: string }[] }[] } => {
  const blocks = [...out.matchAll(/```json\n([\s\S]*?)\n```/g)];
  assert.equal(blocks.length, 1, 'exactly one json block');
  return JSON.parse(blocks[0][1]);
};

test('--agent prints rules and one json block: same questions as the wizard, recommended on a fresh repo (AC-09)', async () => {
  const t = repo(); const { o, io } = capture(t);
  assert.equal(await runCli(['setup', t, '--agent'], io), 0);
  const j = agentJson(o.out);
  assert.deepEqual(j.questions.map((q) => q.id), QUESTIONS.en.map((q) => q.id));
  assert.deepEqual(j.questions.map((q) => q.text), QUESTIONS.en.map((q) => q.ask));
  assert.deepEqual(j.questions.map((q) => q.choices.map((c) => c.value)), QUESTIONS.en.map((q) => q.options.map((c) => c.value)));
  assert.deepEqual(j.recommended, recommended(t, home));
});

test('--agent rules: never edit .workflow/, apply only after the user says yes, one question per message', async () => {
  const t = repo(); const { o, io } = capture(t);
  assert.equal(await runCli(['setup', t, '--agent'], io), 0);
  assert.match(o.out, /never edit `?\.workflow\//i);
  assert.match(o.out, /only after the user says yes/i);
  assert.match(o.out, /one question per message/i);
  assert.match(o.out, /setup --answers/);
});

test('--agent --lang ar uses the Arabic question texts', async () => {
  const t = repo(); const { o, io } = capture(t);
  assert.equal(await runCli(['setup', t, '--agent', '--lang', 'ar'], io), 0);
  assert.deepEqual(agentJson(o.out).questions.map((q) => q.text), QUESTIONS.ar.map((q) => q.ask));
});

const SETS: { name: string; a: SetupAnswers; script: string[] }[] = [
  { name: 'private/step/claude', a: { agents: ['claude'], mode: 'step', docs: { kind: 'private' }, lang: 'en' }, script: ['choose', 'claude', 'step', 'private', 'apply'] },
  { name: 'shared/auto/claude+codex', a: { agents: ['claude', 'codex'], mode: 'auto', docs: { kind: 'shared' }, lang: 'en' }, script: ['choose', 'both', 'auto', 'shared', 'apply'] },
];
for (const s of SETS) {
  test(`parity: wizard and --answers --apply write identical trees, ${s.name} (AC-10)`, async () => {
    const A = repo(); const B = repo();
    const { io: ioA } = capture(A);
    assert.equal(await runWizard(A, ioA, scriptedPrompter(s.script), 'en', home), 0);
    const { o, io: ioB } = capture(B);
    assert.equal(await runCli(['setup', B, '--answers', answersFile(s.a), '--apply'], ioB), 0, o.err);
    assert.notEqual(Object.keys(tree(B)).length, Object.keys(tree(repo())).length, 'something was written');
    assert.deepEqual(tree(B), tree(A));
    assert.equal(hash(B), hash(A));
    assert.match(tree(B)['/CLAUDE.md'], /User text that must survive\./);
  });
}

const printableAnswers = (lang: 'en' | 'ar'): Record<'agents' | 'mode' | 'docs', string>[] => {
  const printedChoices = Object.fromEntries(QUESTIONS[lang].map((q) => [q.id, q.options.map((o) => o.value)])) as Record<'agents' | 'mode' | 'docs', string[]>;
  return printedChoices.agents.flatMap((agents) =>
    printedChoices.mode.flatMap((mode) =>
      printedChoices.docs.filter((docs) => docs !== 'custom').map((docs) => ({ agents, mode, docs }))));
};

for (const lang of ['en', 'ar'] as const) {
  for (const choice of printableAnswers(lang)) {
    test(`${lang} printed choices are accepted and match the wizard: ${choice.agents}/${choice.mode}/${choice.docs} (AC-11)`, async () => {
      const A = repo(); const B = repo();
      const { io: wizardIo } = capture(A);
      assert.equal(await runWizard(A, wizardIo, scriptedPrompter(['choose', ...QUESTIONS[lang].map((q) => choice[q.id]), 'apply']), lang, home), 0);
      const { o, io } = capture(B);
      assert.equal(await runCli(['setup', B, '--lang', lang, '--answers', answersFile(choice), '--apply'], io), 0, o.err);
      assert.deepEqual(currentAnswers(B), currentAnswers(A));
    });
  }
}

test('a bare printed docs custom value asks for the custom object shape (AC-11)', async () => {
  const t = repo(); const before = hash(t); const { o, io } = capture(t);
  assert.equal(await runCli(['setup', t, '--answers', answersFile({ agents: 'claude', mode: 'step', docs: 'custom' }), '--apply'], io), 2);
  assert.match(o.err, /\{"kind":"custom","path":/);
  assert.equal(hash(t), before);
});

for (const lang of ['en', 'ar'] as const) {
  test(`${lang} answers validation messages name every accepted scalar form (review I-2)`, () => {
    assert.match(messages(lang).agent.badAgents, /"claude".*"codex".*"both"/);
    assert.match(messages(lang).agent.badDocs, /"private".*"shared"/);
    assert.match(messages(lang).agent.badDocs, /\{"kind":"custom","path":/);
  });
}

test('the existing arrays and docs-kind answers shape remains accepted (AC-11)', async () => {
  const A = repo(); const B = repo();
  const answers = { agents: ['codex'], mode: 'auto', docs: { kind: 'custom', path: 'notes/work' } };
  const { io: wizardIo } = capture(A);
  assert.equal(await runWizard(A, wizardIo, scriptedPrompter(['choose', 'codex', 'auto', 'custom', 'notes/work', 'apply']), 'en', home), 0);
  const { o, io } = capture(B);
  assert.equal(await runCli(['setup', B, '--answers', answersFile(answers), '--apply'], io), 0, o.err);
  assert.deepEqual(currentAnswers(B), currentAnswers(A));
});

test('an agents list containing the printed "both" value is accepted as claude and codex (AC-14)', async () => {
  const t = repo(); const { o, io } = capture(t);
  const answer = { agents: ['both'], mode: 'step', docs: 'private' };
  assert.equal(await runCli(['setup', t, '--answers', answersFile(answer), '--apply'], io), 0, o.err);
  assert.deepEqual(currentAnswers(t)?.agents, ['claude', 'codex']);
});

for (const lang of ['en', 'ar'] as const) {
  for (const [where, field, answers] of [
    ['top level', 'extra', { ...SETS[0].a, extra: true }],
    ['docs', 'extra', { ...SETS[0].a, docs: { kind: 'private', extra: true } }],
    ['top level', '__proto__', '{"agents":"claude","mode":"step","docs":"private","__proto__":true}'],
    ['docs', '__proto__', '{"agents":"claude","mode":"step","docs":{"kind":"private","__proto__":true}}'],
    ['top level', 'constructor', '{"agents":"claude","mode":"step","docs":"private","constructor":true}'],
    ['docs', 'constructor', '{"agents":"claude","mode":"step","docs":{"kind":"private","constructor":true}}'],
  ] as const) {
    test(`unknown ${where} ${field} field is rejected in ${lang} before writing (AC-04, AC-06)`, async () => {
      const t = repo(); const before = hash(t); const { o, io } = capture(t);
      assert.equal(await runCli(['setup', t, '--lang', lang, '--answers', answersFile(answers), '--apply'], io), 2);
      assert.match(o.err, new RegExp(field));
      if (lang === 'ar') assert.match(o.err, /[\u0600-\u06ff]/);
      assert.equal(hash(t), before);
    });
  }
}

test('--answers without --apply writes nothing and prints the summary (AC-09)', async () => {
  const t = repo(); const before = hash(t); const { o, io } = capture(t);
  assert.equal(await runCli(['setup', t, '--answers', answersFile(SETS[0].a)], io), 0, o.err);
  assert.equal(hash(t), before);
  assert.match(o.out, /npx burhan-kit uninstall/);
});

const BAD: [string, unknown][] = [
  ["agents ['cursor']", { ...SETS[0].a, agents: ['cursor'] }],
  ["mode 'yolo'", { ...SETS[0].a, mode: 'yolo' }],
  ['docs custom ../x', { ...SETS[0].a, docs: { kind: 'custom', path: '../x' } }],
  ['not JSON', 'this is { not json'],
];
for (const [name, v] of BAD) {
  test(`bad input exits 2 with "burhan: ..." and writes nothing: ${name}`, async () => {
    for (const apply of [false, true]) {
      const t = repo(); const before = hash(t); const { o, io } = capture(t);
      assert.equal(await runCli(['setup', t, '--answers', answersFile(v), ...(apply ? ['--apply'] : [])], io), 2);
      assert.match(o.err, /^burhan: /);
      assert.doesNotMatch(o.err, /unknown option/i, 'rejected by validation, not by the arg parser');
      assert.equal(hash(t), before);
    }
  });
}

test('bad input: a missing file exits 2 with "burhan: ..."', async () => {
  const t = repo(); const before = hash(t); const { o, io } = capture(t);
  assert.equal(await runCli(['setup', t, '--answers', join(work, 'nope.json'), '--apply'], io), 2);
  assert.match(o.err, /^burhan: /);
  assert.doesNotMatch(o.err, /unknown option/i);
  assert.equal(hash(t), before);
});

test('installed project: "recommended" is the current answers (AC-17)', async () => {
  const t = repo(); const { io: wio } = capture(t);
  assert.equal(await runWizard(t, wio, scriptedPrompter(['choose', 'both', 'auto', 'shared', 'apply']), 'en', home), 0);
  const cur = currentAnswers(t);
  assert.ok(cur);
  const { o, io } = capture(t);
  assert.equal(await runCli(['setup', t, '--agent'], io), 0);
  assert.deepEqual(agentJson(o.out).recommended, cur);
  assert.equal(cur.mode, 'auto');
});

test('--answers reads only a regular file of at most 1 MB: no device, no huge file (review M-1: /dev/zero ran the machine out of memory)', async () => {
  const d = tmpDir('burhan-agent-size-');
  spawnSync('git', ['init', '-q', d]);
  const big = join(d, 'big.json'); writeFileSync(big, ' '.repeat(2 * 1024 * 1024) + '{}');
  for (const [file, re] of [['/dev/null', /regular file/], [big, /too large|1 MB/]] as [string, RegExp][]) {
    const { o, io } = capture(d);
    assert.equal(await runCli(['setup', d, '--answers', file], io), 2, file);
    assert.match(o.err, /^burhan: /, file);
    assert.match(o.err, re, file);
  }
});
