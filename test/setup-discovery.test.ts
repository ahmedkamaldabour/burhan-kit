import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseConfig } from '../src/lib/config.js';
import { BurhanError } from '../src/lib/errors.js';
import { applySetup, currentAnswers, discoveryPathError, docsPathError, planSetup } from '../src/lib/setup/engine.js';
import type { SetupAnswers } from '../src/lib/setup/answers.js';
import { readAnswers, agentInstructions } from '../src/lib/setup/agent.js';
import { renderSummary } from '../src/lib/setup/summary.js';
import { runWizard } from '../src/lib/setup/wizard.js';
import { scriptedPrompter } from '../src/lib/setup/prompter.js';
import { QUESTIONS } from '../src/lib/setup/messages.js';
import { capture, tmpDir } from './helpers.js';

const home = tmpDir('burhan-disc-home-');
const fresh = (): string => { const d = tmpDir('burhan-disc-'); spawnSync('git', ['init', '-q'], { cwd: d }); return d; };
const custom = (path: string, o: Partial<SetupAnswers> = {}): SetupAnswers => ({ agents: ['claude'], mode: 'step', docs: { kind: 'custom', path }, lang: 'en', ...o });
const cfgOf = (t: string) => parseConfig(readFileSync(join(t, '.burhan/workflow.config'), 'utf8')).values;
const row = (t: string): string => readFileSync(join(t, '.burhan/bindings.md'), 'utf8').split('\n').find((l) => l.includes('Discovery location')) ?? '';

test('AC-02: an existing discovery folder beside the docs folder is used', () => {
  const t = fresh(); mkdirSync(join(t, 'AI_SPEC/docs'), { recursive: true }); mkdirSync(join(t, 'AI_SPEC/discovery'));
  const plan = planSetup(t, custom('AI_SPEC/docs'), home);
  assert.equal(parseConfig(plan.config).values.WF_DISCOVERY_DIR, 'AI_SPEC/discovery');
});

test('AC-02: no discovery folder beside the docs folder → <docs>-discovery, as today', () => {
  const t = fresh(); mkdirSync(join(t, 'AI_SPEC/docs'), { recursive: true });
  assert.equal(parseConfig(planSetup(t, custom('AI_SPEC/docs'), home).config).values.WF_DISCOVERY_DIR, 'AI_SPEC/docs-discovery');
});

test('AC-02: a `discovery` file or a symlinked folder is not discovered', () => {
  const t = fresh(); const out = tmpDir('burhan-disc-out-');
  mkdirSync(join(t, 'A/docs'), { recursive: true }); writeFileSync(join(t, 'A/discovery'), 'x');
  assert.equal(parseConfig(planSetup(t, custom('A/docs'), home).config).values.WF_DISCOVERY_DIR, 'A/docs-discovery');
  const u = fresh(); mkdirSync(join(u, 'B/docs'), { recursive: true }); symlinkSync(out, join(u, 'B/discovery'), 'dir');
  assert.equal(parseConfig(planSetup(u, custom('B/docs'), home).config).values.WF_DISCOVERY_DIR, 'B/docs-discovery');
});

test('AC-02: private and shared keep their fixed folders', () => {
  const t = fresh();
  assert.equal(parseConfig(planSetup(t, { ...custom('x'), docs: { kind: 'private' } }, home).config).values.WF_DISCOVERY_DIR, '.burhan/discovery');
  assert.equal(parseConfig(planSetup(t, { ...custom('x'), docs: { kind: 'shared' } }, home).config).values.WF_DISCOVERY_DIR, 'docs/burhan/discovery');
});

test('AC-03: a chosen folder reaches WF_DISCOVERY_DIR, the bindings row (placeholder only) and the preview', () => {
  const t = fresh(); const a = custom('AI_SPEC/docs', { discovery: { kind: 'custom', path: 'notes/found' } });
  const plan = planSetup(t, a, home);
  assert.equal(parseConfig(plan.config).values.WF_DISCOVERY_DIR, 'notes/found');
  assert.match(renderSummary(plan, 'en'), /Discoveries: notes\/found\//);
  assert.match(renderSummary(plan, 'ar'), /notes\/found\//);
  applySetup(plan);
  assert.equal(cfgOf(t).WF_DISCOVERY_DIR, 'notes/found');
  assert.match(row(t), /`notes\/found\/`/);
  // a row the person already filled is kept
  const u = fresh(); mkdirSync(join(u, '.burhan'));
  writeFileSync(join(u, '.burhan/bindings.md'), readFileSync(join(process.cwd(), 'kit/templates/bindings.md'), 'utf8').replace('*(dated files for things found mid-task)*', 'mine'));
  applySetup(planSetup(u, a, home));
  assert.match(row(u), /\| mine \|/);
});

test('AC-04: unsafe discovery paths are refused and name the discovery folder', () => {
  const t = fresh();
  for (const bad of ['', '/abs', 'C:/x', '..', '../x', 'a/../b', 'a\\b', '~/x', '.git', '.git/x', '.burhan', '.burhan/x', '.', './.', 'a/./b', 'a"b', 'a$b', "a'b", 'a\nb', 'AI_SPEC/docs', 'AI_SPEC/docs/inner', 'AI_SPEC']) {
    assert.throws(() => planSetup(t, custom('AI_SPEC/docs', { discovery: { kind: 'custom', path: bad } }), home), (e: unknown) => e instanceof BurhanError && /discovery folder/.test(e.message), JSON.stringify(bad));
  }
  assert.match(discoveryPathError('../x', { kind: 'shared' }) ?? '', /discovery folder/);
  assert.equal(discoveryPathError('notes/found', { kind: 'shared' }), undefined);
});

test('AC-05: an answers file without the field behaves as before; the shapes are validated', () => {
  const f = (v: unknown): string => { const p = join(tmpDir('burhan-disc-ans-'), 'a.json'); writeFileSync(p, JSON.stringify(v)); return p; };
  const base = { agents: 'claude', mode: 'step', docs: 'private' };
  assert.equal(readAnswers(f(base), 'en').discovery, undefined);
  assert.deepEqual(readAnswers(f({ ...base, discovery: 'beside' }), 'en').discovery, { kind: 'beside' });
  assert.deepEqual(readAnswers(f({ ...base, discovery: { kind: 'custom', path: 'n/f' } }), 'en').discovery, { kind: 'custom', path: 'n/f' });
  for (const bad of ['custom', 'x', 3, { kind: 'custom' }, { kind: 'custom', path: '../x' }, { kind: 'beside', extra: 1 }]) assert.throws(() => readAnswers(f({ ...base, discovery: bad }), 'en'), BurhanError, JSON.stringify(bad));
});

test('AC-05: a saved WF_DISCOVERY_DIR is kept when nothing changes, and currentAnswers reads it', () => {
  const t = fresh(); mkdirSync(join(t, 'AI_SPEC/docs'), { recursive: true });
  applySetup(planSetup(t, custom('AI_SPEC/docs', { discovery: { kind: 'custom', path: 'notes/found' } }), home));
  assert.deepEqual(currentAnswers(t)?.discovery, { kind: 'custom', path: 'notes/found' });
  assert.equal(parseConfig(planSetup(t, custom('AI_SPEC/docs'), home).config).values.WF_DISCOVERY_DIR, 'notes/found');
  const u = fresh(); mkdirSync(join(u, 'AI_SPEC/docs'), { recursive: true }); mkdirSync(join(u, 'AI_SPEC/discovery'));
  applySetup(planSetup(u, custom('AI_SPEC/docs'), home));
  assert.equal(currentAnswers(u)?.discovery, undefined);
});

test('review I-1: a saved folder the new rules refuse never makes setup throw, and is kept when the answer is not given', () => {
  for (const saved of ['docs', 'docs/work/disc', '/abs/disc', '../disc']) {
    const t = fresh(); mkdirSync(join(t, '.burhan'));
    writeFileSync(join(t, '.burhan/workflow.config'), `WF_DOCS_DIR='docs/work'\nWF_DISCOVERY_DIR='${saved}'\n`);
    mkdirSync(join(t, '.burhan'), { recursive: true }); writeFileSync(join(t, '.burhan/WORKFLOW.md'), 'x');
    const cur = currentAnswers(t); assert.ok(cur, saved);
    assert.equal(cur.discovery, undefined, saved);
    assert.equal(parseConfig(planSetup(t, cur, home).config).values.WF_DISCOVERY_DIR, saved, saved);
  }
});

test('review I-2: an explicit `beside` replaces a saved custom folder; an absent answer keeps it', () => {
  const t = fresh();
  applySetup(planSetup(t, custom('AI_SPEC/docs', { discovery: { kind: 'custom', path: 'notes/found' } }), home));
  assert.equal(parseConfig(planSetup(t, custom('AI_SPEC/docs'), home).config).values.WF_DISCOVERY_DIR, 'notes/found');
  assert.equal(parseConfig(planSetup(t, custom('AI_SPEC/docs', { discovery: { kind: 'beside' } }), home).config).values.WF_DISCOVERY_DIR, 'AI_SPEC/docs-discovery');
});

for (const lang of ['en', 'ar'] as const) {
  test(`AC-01 ${lang}: the fourth question is in the catalog, the agent json and the wizard`, async () => {
    assert.deepEqual(QUESTIONS[lang].map((q) => q.id), ['agents', 'mode', 'docs', 'discovery']);
    assert.deepEqual(QUESTIONS[lang][3].options.map((o) => o.value), ['beside', 'custom']);
    const t = fresh();
    const json = JSON.parse([...agentInstructions(t, lang, home).matchAll(/```json\n([\s\S]*?)\n```/g)][0][1]);
    assert.deepEqual(json.questions.map((q: { id: string }) => q.id), ['agents', 'mode', 'docs', 'discovery']);
    const p = scriptedPrompter(['choose', 'claude', 'step', 'custom', 'AI_SPEC/docs', 'custom', 'notes/found', 'apply']);
    const { io } = capture(t);
    assert.equal(await runWizard(t, io, p, lang, home), 0);
    assert.equal(cfgOf(t).WF_DISCOVERY_DIR, 'notes/found');
    assert.ok(p.asked.includes(QUESTIONS[lang][3].ask));
  });
}

test('QC D4a: the names git and burhan keep for themselves are refused in any letter case, for docs and discovery', () => {
  const t = fresh();
  for (const bad of ['.GIT', '.Git/x', '.BURHAN', '.Burhan/work']) {
    assert.throws(() => planSetup(t, custom(bad), home), BurhanError, `docs ${bad}`);
    assert.throws(() => planSetup(t, custom('AI_SPEC/docs', { discovery: { kind: 'custom', path: bad } }), home), BurhanError, `discovery ${bad}`);
  }
});

test('QC D4b: a custom docs or discovery path that is, or runs through, a link leaving the project is refused', () => {
  const t = fresh(); const out = tmpDir('burhan-disc-link-out-');
  symlinkSync(out, join(t, 'L'), 'dir');
  mkdirSync(join(t, 'ok/docs'), { recursive: true });
  for (const bad of ['L', 'L/x', 'L/x/y']) {
    assert.throws(() => planSetup(t, custom(bad), home), (e: unknown) => e instanceof BurhanError && /link/.test(e.message), `docs ${bad}`);
    assert.throws(() => planSetup(t, custom('ok/docs', { discovery: { kind: 'custom', path: bad } }), home), (e: unknown) => e instanceof BurhanError && /link/.test(e.message), `discovery ${bad}`);
  }
  assert.equal(discoveryPathError('L/x', { kind: 'shared' }, t) === undefined, false);
  assert.equal(parseConfig(planSetup(t, custom('ok/docs', { discovery: { kind: 'custom', path: 'ok/found' } }), home).config).values.WF_DISCOVERY_DIR, 'ok/found');
});

test('QC r3: a saved discovery folder that is a link out of the project is kept the same way in every flow, and a nested .git step is refused', () => {
  const t = fresh(); const out = tmpDir('burhan-disc-saved-out-');
  symlinkSync(out, join(t, 'L'), 'dir'); mkdirSync(join(t, 'ok/docs'), { recursive: true });
  mkdirSync(join(t, '.burhan'), { recursive: true });
  writeFileSync(join(t, '.burhan/workflow.config'), "WF_DOCS_DIR='ok/docs'\nWF_DISCOVERY_DIR='L'\n");
  writeFileSync(join(t, '.burhan/WORKFLOW.md'), 'x');
  const cur = currentAnswers(t); assert.ok(cur);
  assert.equal(cur.discovery, undefined, 'a saved link is not turned into an answer');
  assert.equal(parseConfig(planSetup(t, cur, home).config).values.WF_DISCOVERY_DIR, 'L', 'and not refused: kept as saved');
  for (const bad of ['docs/.git', 'a/.GIT/b']) assert.throws(() => planSetup(fresh(), custom('ok/docs', { discovery: { kind: 'custom', path: bad } }), home), BurhanError, bad);
  assert.throws(() => planSetup(fresh(), custom('x/.git'), home), BurhanError);
});

test('QC D4c: the "." message gives its hint once', () => {
  const m = discoveryPathError('a/./b', { kind: 'shared' }) ?? '';
  assert.equal(m.split('like docs/discovery').length - 1, 1, m);
  const d = docsPathError('a/./b') ?? '';
  assert.equal(d.split('like docs/work').length - 1, 1, d);
});

for (const lang of ['en', 'ar'] as const) {
  test(`QC D3 ${lang}: the wizard names the folder "beside" means, and the agent rule tells the agent to`, async () => {
    const t = fresh(); mkdirSync(join(t, 'AI_SPEC/docs'), { recursive: true }); mkdirSync(join(t, 'AI_SPEC/discovery'));
    const p = scriptedPrompter(['choose', 'claude', 'step', 'custom', 'AI_SPEC/docs', 'beside', 'cancel']);
    await runWizard(t, capture(t).io, p, lang, home);
    const at = p.shown.indexOf(QUESTIONS[lang][3].ask);
    const afterDocs = p.shown.slice(at, at + 3); // the question and its two choices, nothing later
    assert.ok(afterDocs.some((l) => l.includes('AI_SPEC/discovery/')), afterDocs.join('\n'));
    const q = fresh();
    const p2 = scriptedPrompter(['choose', 'claude', 'step', 'shared', 'beside', 'cancel']);
    await runWizard(q, capture(q).io, p2, lang, home);
    const at2 = p2.shown.indexOf(QUESTIONS[lang][3].ask);
    assert.ok(p2.shown.slice(at2, at2 + 3).some((l) => l.includes('docs/burhan/discovery/')));
    const rules = agentInstructions(t, lang, home);
    assert.match(rules, lang === 'en' ? /tell the person which folder "beside" means/ : /قول للشخص "beside" يعني أنهي فولدر/);
  });
}
