import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
const good: Probe = { nodeVersion: () => '24.13.0', claudeVersion: () => '2.1.296', home: () => home };

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
const cfgOf = (t: string) => parseConfig(readFileSync(join(t, '.burhan/workflow.config'), 'utf8'));
const section = (s: string, head: string): string => {
  const m = s.match(new RegExp(`^${head}\\b[^\\n]*\\n([\\s\\S]*?)(?=^\\S|$(?![\\s\\S]))`, 'm'));
  return m ? m[1] : '';
};

test('recommended: installed agent dirs, else claude; fresh projects share work files', () => {
  const t = fresh();
  assert.deepEqual(recommended(t, home), answers({ docs: { kind: 'shared' } }));
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
  assert.equal(readFileSync(join(t, '.burhan/.gitignore'), 'utf8'), '/local/\n/work/\n/discovery/\n');
  const cs = runChecks(t, good);
  assert.deepEqual(cs.filter((x) => x.status === 'fail'), []);
  assert.deepEqual(cs.filter((x) => x.text.includes('unknown config keys')), []);
  assert.ok(readFileSync(join(t, '.burhan/bindings.md'), 'utf8').includes('feature branches + pull requests; commit only after the a/b/c checkpoint'));
});

test('shared and custom docs choices', () => {
  const s = fresh();
  applySetup(planSetup(s, answers({ docs: { kind: 'shared' }, mode: 'auto' }), home));
  assert.equal(cfgOf(s).values.WF_DOCS_DIR, 'docs/burhan/work');
  assert.equal(cfgOf(s).values.WF_MODE_DEFAULT, 'auto');
  assert.equal(existsSync(join(s, '.burhan/WORKFLOW.md')), true);
  const c = fresh();
  applySetup(planSetup(c, answers({ docs: { kind: 'custom', path: './notes/work/' } }), home));
  assert.equal(cfgOf(c).values.WF_DOCS_DIR, 'notes/work');
  assert.equal(cfgOf(c).values.WF_DISCOVERY_DIR, 'notes/work-discovery');
  for (const bad of ['/abs', '../out', 'a/../../b', "it's", '', 'C:\\x', 'a\nb', '.', './', '.git', '.git/hooks', '.burhan', '.burhan/x', 'a/./b'])
    assert.throws(() => planSetup(fresh(), answers({ docs: { kind: 'custom', path: bad } }), home), /work files|path/i, bad);
});

test('AC-17: a saved docs folder written with a trailing slash still counts as unchanged (review M-1)', () => {
  const t = fresh();
  applySetup(planSetup(t, answers({ docs: { kind: 'custom', path: 'docs' } }), home));
  const cfgFile = join(t, '.burhan/workflow.config');
  writeFileSync(cfgFile, readFileSync(cfgFile, 'utf8').replace("WF_DOCS_DIR='docs'", "WF_DOCS_DIR='docs/'").replace("WF_DISCOVERY_DIR='docs-discovery'", "WF_DISCOVERY_DIR='disc'"));
  applySetup(planSetup(t, answers({ docs: { kind: 'custom', path: 'docs' } }), home));
  assert.equal(cfgOf(t).values.WF_DISCOVERY_DIR, 'disc');
});

for (const setting of ['', 'WF_DOCS_DIR=""\n']) {
  test(`an effective private docs default preserves explicit discovery, setting=${JSON.stringify(setting)}`, () => {
    const target = fresh();
    applySetup(planSetup(target, answers(), home));
    writeFileSync(join(target, '.burhan/workflow.config'), `${setting}WF_DISCOVERY_DIR="notes/discoveries"\n`);
    const current = currentAnswers(target)!;
    assert.deepEqual(current.docs, { kind: 'private' });
    applySetup(planSetup(target, current, home));
    assert.equal(cfgOf(target).values.WF_DOCS_DIR, '.burhan/work');
    assert.equal(cfgOf(target).values.WF_DISCOVERY_DIR, 'notes/discoveries');
  });
}

test('re-running with the same answers changes nothing', () => {
  const t = fresh();
  writeFileSync(join(t, 'CLAUDE.md'), '# mine\n');
  applySetup(planSetup(t, answers(), home));
  const h = hash(t);
  applySetup(planSetup(t, answers(), home));
  assert.equal(hash(t), h);
});

test('currentAnswers: null when not installed; prefilled saved private, shared, and custom choices stay unchanged', () => {
  const t = fresh();
  assert.equal(currentAnswers(t), null);
  applySetup(planSetup(t, answers({ mode: 'auto', docs: { kind: 'shared' } }), home));
  assert.deepEqual(currentAnswers(t), answers({ mode: 'auto', docs: { kind: 'shared' } }));
  const p = fresh();
  applySetup(planSetup(p, answers({ docs: { kind: 'private' } }), home));
  assert.deepEqual(currentAnswers(p)?.docs, { kind: 'private' });
  const c = fresh();
  applySetup(planSetup(c, answers({ docs: { kind: 'custom', path: 'x/y' } }), home));
  assert.deepEqual(currentAnswers(c)?.docs, { kind: 'custom', path: 'x/y' });
});

test('an existing check command is kept, gets no pending, and the verify skill exists after ONE apply (AC-07)', () => {
  const t = fresh();
  mkdirSync(join(t, '.burhan'));
  writeFileSync(join(t, '.burhan/workflow.config'), "# mine\nWF_CHECK_CMD='make lint'\nWF_SKILLS='none'\n");
  applySetup(planSetup(t, answers(), home));
  const c = cfgOf(t);
  assert.equal(c.values.WF_CHECK_CMD, 'make lint');
  assert.notEqual(c.values.WF_STACK_SETUP, 'pending');
  assert.ok(readFileSync(join(t, '.burhan/workflow.config'), 'utf8').startsWith('# mine\n'));
  assert.ok(readFileSync(join(t, '.claude/skills/burhan-verify/SKILL.md'), 'utf8').includes('make lint'));
});

test('an existing non-empty skills value is kept; a pending marker is not reset to done-less', () => {
  const t = fresh();
  mkdirSync(join(t, '.burhan'));
  writeFileSync(join(t, '.burhan/workflow.config'), "WF_SKILLS='other'\nWF_STACK_SETUP='done'\n");
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

const SUPERPOWERS_LINES = {
  en: {
    found: "Superpowers found — burhan uses its skills at each step: brainstorming before a story, TDD while building, verification before \"done\". Strongly recommended; turn off with WF_SKILLS='none'.",
    disabled: "Superpowers found, but turned off for this project (WF_SKILLS='none'). To use it, set WF_SKILLS='superpowers'.",
    absent: 'Superpowers is strongly recommended, and optional: burhan never installs it · Claude Code: /plugin install superpowers@claude-plugins-official',
  },
  ar: {
    found: "لقينا Superpowers — burhan هيستخدم الـ skills بتاعته في كل مرحلة: brainstorming قبل الـ story، و TDD وإنت بتكتب الكود، وتأكيد قبل ما يقول \"خلصت\". موصى به بقوة؛ وتقدر تقفله بـ WF_SKILLS='none'.",
    disabled: "لقينا Superpowers، بس هو مقفول في المشروع ده (WF_SKILLS='none'). لو عايز تستخدمه، خلّيها WF_SKILLS='superpowers'.",
    absent: 'Superpowers موصى به بقوة، وهو اختياري: burhan مش بيسطّبه خالص · Claude Code: /plugin install superpowers@claude-plugins-official',
  },
} as const;

for (const present of [false, true]) for (const skills of ['none', 'superpowers']) {
test(`Superpowers summary has exactly one availability line for configured ${skills}, present=${present}`, () => {
    const target = fresh();
    const suppliedHome = tmpDir('burhan-optional-home-');
    if (present) mkdirSync(join(suppliedHome, '.claude/plugins/cache/vendor/superpowers'), { recursive: true });
    mkdirSync(join(target, '.burhan'));
    writeFileSync(join(target, '.burhan/workflow.config'), `WF_SKILLS='${skills}'\n`);
    const beforeHome = tree(suppliedHome);
    const plan = planSetup(target, answers(), suppliedHome);
    assert.equal(plan.skills, skills);
    assert.equal(plan.superpowersAvailable, present);
    for (const lang of ['en', 'ar'] as const) {
      const summary = renderSummary(plan, lang);
      const expected = present ? skills === 'none' ? SUPERPOWERS_LINES[lang].disabled : SUPERPOWERS_LINES[lang].found : SUPERPOWERS_LINES[lang].absent;
      const allLines = Object.values(SUPERPOWERS_LINES[lang]);
      assert.equal(summary.split(expected).length - 1, 1);
      assert.equal(allLines.reduce((count, line) => count + (summary.includes(line) ? 1 : 0), 0), 1);
    }
    applySetup(plan);
    assert.equal(cfgOf(target).values.WF_SKILLS, skills);
    assert.deepEqual(tree(suppliedHome), beforeHome);
    assert.equal(existsSync(join(target, '.claude/plugins')), false);
  });
}

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
  assert.match(section(en, 'Created'), /\.burhan\//);
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
  // The summary names the physical project dir (macOS: /var is a link to /private/var).
  const t = realpathSync(fresh());
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
  mkdirSync(join(t, '.burhan'));
  writeFileSync(join(t, '.burhan/workflow.config'), "WF_CHECK_CMD='make lint'\n");
  applySetup(planSetup(t, answers(), home));
  assert.ok(existsSync(join(t, '.claude/skills/burhan-verify/SKILL.md')));
  writeFileSync(join(t, '.burhan/workflow.config'), "WF_CHECK_CMD=''\n");
  const p = planSetup(t, answers(), home);
  const f = p.install.files.find((x) => x.rel === '.claude/skills/burhan-verify/SKILL.md');
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

test('Q3 names each task artifact and presents path-labelled private, shared, and custom choices in order', () => {
  const expected = {
    en: {
      ask: "Where should burhan save each task's story, plan and reviews?",
      choices: [
        ['shared', 'In git, for the team — docs/burhan/work/', 'recommended'],
        ['private', 'Only on my machine — .burhan/work/ (not in git)', ''],
        ['custom', 'A folder I choose', ''],
      ],
    },
    ar: {
      ask: 'burhan يحفظ الـ story والخطة والـ reviews بتاعة كل مهمة فين؟',
      choices: [
        ['shared', 'في git للفريق — docs/burhan/work/', 'مقترح'],
        ['private', 'على جهازي بس — .burhan/work/ (بره git)', ''],
        ['custom', 'فولدر أختاره أنا', ''],
      ],
    },
  } as const;
  for (const lang of ['en', 'ar'] as const) {
    const q = QUESTIONS[lang][2];
    assert.equal(q.ask, expected[lang].ask);
    assert.deepEqual(q.options.map((o) => [o.value, o.label, o.hint ?? '']), expected[lang].choices);
  }
});

test('question texts: four questions, no internal terms other than Q3 task artifacts', () => {
  assert.equal(QUESTIONS.en.length, 4);
  assert.equal(QUESTIONS.ar.length, 4);
  const banned = /WF_|\bQC\b|evidence|\bgate|superpowers|regex/i;
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
