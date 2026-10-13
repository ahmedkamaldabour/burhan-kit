import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseConfig } from '../src/lib/config.js';
import { runChecks, type Probe } from '../src/lib/doctor.js';
import { applySetup, planSetup, recommended, currentAnswers } from '../src/lib/setup/engine.js';
import type { SetupAnswers } from '../src/lib/setup/answers.js';
import { renderSummary } from '../src/lib/setup/summary.js';
import { QUESTIONS, messages } from '../src/lib/setup/messages.js';
import { tmpDir } from './helpers.js';

const home = tmpDir('burhan-setup-home-');
const good: Probe = { bashMajor: () => 5, has: () => true, jqVersion: () => 'jq-1.8.1', claudeVersion: () => '2.1.296', home: () => home };

function fresh(): string {
  const d = tmpDir('burhan-setup-');
  spawnSync('git', ['init', '-q'], { cwd: d });
  return d;
}
/** Every path under dir (skipping .git) with its content. */
function tree(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const e of readdirSync(dir)) {
    if (e === '.git') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { out[p.slice(base.length) + '/'] = ''; tree(p, base, out); }
    else out[p.slice(base.length)] = readFileSync(p, 'utf8');
  }
  return out;
}
const hash = (dir: string): string => createHash('sha256').update(JSON.stringify(tree(dir))).digest('hex');
const answers = (o: Partial<SetupAnswers> = {}): SetupAnswers => ({ agents: ['claude'], mode: 'step', docs: { kind: 'private' }, lang: 'en', ...o });
const cfgOf = (t: string) => parseConfig(readFileSync(join(t, '.workflow/workflow.config'), 'utf8'));
const section = (s: string, head: string): string => {
  const m = s.match(new RegExp(`^${head}\\b[^\\n]*\\n([\\s\\S]*?)(?=^\\S|$(?![\\s\\S]))`, 'm'));
  return m ? m[1] : '';
};

test('recommended: installed agent dirs, else claude; cautious defaults', () => {
  const t = fresh();
  assert.deepEqual(recommended(t, home), answers());
  mkdirSync(join(t, '.codex'));
  assert.deepEqual(recommended(t, home).agents, ['codex']);
  mkdirSync(join(t, '.claude'));
  assert.deepEqual(recommended(t, home).agents, ['claude', 'codex']);
});

test('planSetup writes nothing', () => {
  const t = fresh();
  writeFileSync(join(t, 'CLAUDE.md'), '# mine\n');
  const before = tree(t);
  const p = planSetup(t, answers(), home);
  assert.deepEqual(tree(t), before);
  assert.equal(p.install.target.length > 0, true);
  assert.ok(p.config.includes("WF_DOCS_DIR='.burhan/work'"));
});

test('applySetup: config, private folder ignore file, healthy doctor', () => {
  const t = fresh();
  applySetup(planSetup(t, answers(), home));
  const c = cfgOf(t);
  assert.equal(c.values.WF_DOCS_DIR, '.burhan/work');
  assert.equal(c.values.WF_DISCOVERY_DIR, '.burhan/discovery');
  assert.equal(c.values.WF_STACK_SETUP, 'pending');
  assert.equal(c.values.WF_MODE_DEFAULT, 'step');
  assert.deepEqual(c.problems, []);
  assert.equal(readFileSync(join(t, '.burhan/.gitignore'), 'utf8'), '*\n');
  const cs = runChecks(t, good);
  assert.deepEqual(cs.filter((x) => x.status === 'fail'), []);
  assert.deepEqual(cs.filter((x) => x.text.includes('unknown config keys')), []);
  assert.ok(readFileSync(join(t, '.workflow/bindings.md'), 'utf8').includes('feature branches + pull requests; commit only after the a/b/c checkpoint'));
});

test('shared and custom docs choices', () => {
  const s = fresh();
  applySetup(planSetup(s, answers({ docs: { kind: 'shared' }, mode: 'auto' }), home));
  assert.equal(cfgOf(s).values.WF_DOCS_DIR, 'docs/burhan/work');
  assert.equal(cfgOf(s).values.WF_MODE_DEFAULT, 'auto');
  assert.equal(existsSync(join(s, '.burhan')), false);
  const c = fresh();
  applySetup(planSetup(c, answers({ docs: { kind: 'custom', path: './notes/work/' } }), home));
  assert.equal(cfgOf(c).values.WF_DOCS_DIR, 'notes/work');
  assert.equal(cfgOf(c).values.WF_DISCOVERY_DIR, 'notes/work-discovery');
  for (const bad of ['/abs', '../out', 'a/../../b', "it's", '', 'C:\\x', 'a\nb', '.', './', '.git', '.git/hooks', '.workflow', '.workflow/x', 'a/./b'])
    assert.throws(() => planSetup(fresh(), answers({ docs: { kind: 'custom', path: bad } }), home), /work files|path/i, bad);
});

test('AC-17: a saved docs folder written with a trailing slash still counts as unchanged (review M-1)', () => {
  const t = fresh();
  applySetup(planSetup(t, answers({ docs: { kind: 'custom', path: 'docs' } }), home));
  const cfgFile = join(t, '.workflow/workflow.config');
  writeFileSync(cfgFile, readFileSync(cfgFile, 'utf8').replace("WF_DOCS_DIR='docs'", "WF_DOCS_DIR='docs/'").replace("WF_DISCOVERY_DIR='docs-discovery'", "WF_DISCOVERY_DIR='disc'"));
  applySetup(planSetup(t, answers({ docs: { kind: 'custom', path: 'docs' } }), home));
  assert.equal(cfgOf(t).values.WF_DISCOVERY_DIR, 'disc');
});

test('re-running with the same answers changes nothing', () => {
  const t = fresh();
  writeFileSync(join(t, 'CLAUDE.md'), '# mine\n');
  applySetup(planSetup(t, answers(), home));
  const h = hash(t);
  applySetup(planSetup(t, answers(), home));
  assert.equal(hash(t), h);
});

test('currentAnswers: null when not installed; prefilled when installed', () => {
  const t = fresh();
  assert.equal(currentAnswers(t), null);
  applySetup(planSetup(t, answers({ mode: 'auto', docs: { kind: 'shared' } }), home));
  assert.deepEqual(currentAnswers(t), answers({ mode: 'auto', docs: { kind: 'shared' } }));
  const c = fresh();
  applySetup(planSetup(c, answers({ docs: { kind: 'custom', path: 'x/y' } }), home));
  assert.deepEqual(currentAnswers(c)?.docs, { kind: 'custom', path: 'x/y' });
});

test('an existing check command is kept, gets no pending, and the verify skill exists after ONE apply (AC-07)', () => {
  const t = fresh();
  mkdirSync(join(t, '.workflow'));
  writeFileSync(join(t, '.workflow/workflow.config'), "# mine\nWF_CHECK_CMD='make lint'\nWF_SKILLS='none'\n");
  applySetup(planSetup(t, answers(), home));
  const c = cfgOf(t);
  assert.equal(c.values.WF_CHECK_CMD, 'make lint');
  assert.notEqual(c.values.WF_STACK_SETUP, 'pending');
  assert.ok(readFileSync(join(t, '.workflow/workflow.config'), 'utf8').startsWith('# mine\n'));
  assert.ok(readFileSync(join(t, '.claude/skills/verify/SKILL.md'), 'utf8').includes('make lint'));
});

test('an existing non-empty skills value is kept; a pending marker is not reset to done-less', () => {
  const t = fresh();
  mkdirSync(join(t, '.workflow'));
  writeFileSync(join(t, '.workflow/workflow.config'), "WF_SKILLS='other'\nWF_STACK_SETUP='done'\n");
  applySetup(planSetup(t, answers(), home));
  assert.equal(cfgOf(t).values.WF_SKILLS, 'other');
  assert.equal(cfgOf(t).values.WF_STACK_SETUP, 'done');
});

test('R-6: superpowers is detected read-only from the home plugins folder', () => {
  const h = tmpDir('burhan-home-');
  const t = fresh();
  assert.equal(planSetup(t, answers(), h).skills, 'none');
  mkdirSync(join(h, '.claude/plugins/cache/x/superpowers/1.0'), { recursive: true });
  const before = tree(h);
  const p = planSetup(t, answers(), h);
  assert.equal(p.skills, 'superpowers');
  assert.deepEqual(tree(h), before);
  applySetup(p);
  assert.equal(cfgOf(t).values.WF_SKILLS, 'superpowers');
});

test('summary: Created / Changed / Removed, change and undo lines, no WF_ (en and ar)', () => {
  const t = fresh();
  writeFileSync(join(t, 'CLAUDE.md'), '# mine\n');
  const p = planSetup(t, answers(), home);
  for (const lang of ['en', 'ar'] as const) {
    const s = renderSummary(p, lang);
    assert.ok(!s.includes('WF_'), lang);
    assert.ok(s.includes('npx burhan-kit setup'), lang);
    assert.ok(s.includes('npx burhan-kit uninstall'), lang);
    assert.ok(!/superpowers.*(faster|cheaper|token)/i.test(s), lang);
  }
  const en = renderSummary(p, 'en');
  assert.match(section(en, 'Changed'), /CLAUDE\.md[^\n]*a short block at the end, your text untouched/);
  assert.match(section(en, 'Created'), /\.workflow\//);
  assert.match(en, /Nothing is committed/);
  assert.ok(!/AGENTS\.md|codex/i.test(en), 'no codex line without codex');
});

test('summary: codex adds the trust line (AC-18)', () => {
  const t = fresh();
  const p = planSetup(t, answers({ agents: ['claude', 'codex'] }), home);
  assert.match(renderSummary(p, 'en'), /Codex[^\n]*trust/);
  assert.ok(/Codex|كودكس/.test(renderSummary(p, 'ar')));
});

test('summary ends by asking for a new agent session in the project (AC-20)', () => {
  const t = fresh();
  const p = planSetup(t, answers(), home);
  const en = renderSummary(p, 'en').trimEnd().split('\n').at(-1);
  assert.equal(en, `Start a new agent session in ${t} for burhan's hooks to take effect.`);
  const ar = renderSummary(p, 'ar').trimEnd().split('\n').at(-1) ?? '';
  assert.match(ar, new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(ar, /session.*agent.*hooks|agent.*session.*hooks/i);
  assert.match(ar, /[\u0600-\u06ff]/);
});

test('A2: a removal is listed under Removed', () => {
  const t = fresh();
  mkdirSync(join(t, '.workflow'));
  writeFileSync(join(t, '.workflow/workflow.config'), "WF_CHECK_CMD='make lint'\n");
  applySetup(planSetup(t, answers(), home));
  assert.ok(existsSync(join(t, '.claude/skills/verify/SKILL.md')));
  writeFileSync(join(t, '.workflow/workflow.config'), "WF_CHECK_CMD=''\n");
  const p = planSetup(t, answers(), home);
  const f = p.install.files.find((x) => x.rel === '.claude/skills/verify/SKILL.md');
  assert.equal(f?.action, 'remove');
  assert.match(section(renderSummary(p, 'en'), 'Removed'), /verify/);
});

test('A3: a blocked plan is refused before anything is written', () => {
  const t = fresh();
  const p = planSetup(t, answers(), home);
  p.install.blocked.push('/x/.codex/hooks.json is not writable');
  const before = tree(t);
  assert.throws(() => applySetup(p), /\/x\/\.codex\/hooks\.json is not writable — nothing was changed/);
  assert.deepEqual(tree(t), before);
});

test('question texts: three questions, no internal terms', () => {
  assert.equal(QUESTIONS.en.length, 3);
  assert.equal(QUESTIONS.ar.length, 3);
  const banned = /WF_|\bstory\b|\bQC\b|evidence|\bgate|superpowers|regex/i;
  for (const lang of ['en', 'ar'] as const)
    for (const q of QUESTIONS[lang]) {
      const text = [q.ask, ...q.options.map((o) => `${o.label} ${o.hint ?? ''}`)].join('\n');
      assert.ok(!banned.test(text), `${lang}: ${text}`);
    }
  assert.match(QUESTIONS.en[0].options.map((o) => o.hint ?? '').join(' '), /Codex/);
  assert.ok(messages('en').nothingCommitted.length > 0);
});

test('the Arabic CLI text is plain Egyptian Arabic, like README.ar.md (owner, 2026-10-13)', () => {
  // Typical Modern Standard Arabic markers; their Egyptian forms are هيتعمل، لازم، اللي، مش، مقدرناش.
  const MSA = /سيتم|يجب|الذي|التي|سوف|تعذّر|ليس |لا يمكن|دون أن|سترى|ماذا|كيف تريد/;
  const texts: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') texts.push(v);
    else if (typeof v === 'function') { try { const r = (v as (...a: unknown[]) => unknown)('x', 'y', 'z'); if (typeof r === 'string') texts.push(r); } catch { /* needs other args */ } }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(messages('ar')); walk(QUESTIONS.ar);
  assert.ok(texts.length > 50, `scanned ${texts.length} strings`);
  const bad = texts.filter((t) => MSA.test(t));
  assert.deepEqual(bad, []);
});
