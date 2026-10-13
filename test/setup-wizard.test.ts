import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { parseConfig } from '../src/lib/config.js';
import { CANCEL, numberedPrompter, scriptedPrompter, withFallback, type Prompter } from '../src/lib/setup/prompter.js';
import { runWizard } from '../src/lib/setup/wizard.js';
import { docsPathError } from '../src/lib/setup/engine.js';
import { capture, tmpDir } from './helpers.js';

const home = tmpDir('burhan-wiz-home-');
const fresh = (): string => { const d = tmpDir('burhan-wiz-'); spawnSync('git', ['init', '-q'], { cwd: d }); return d; };
function tree(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const e of readdirSync(dir)) {
    if (e === '.git') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { out[p.slice(base.length) + '/'] = ''; tree(p, base, out); } else out[p.slice(base.length)] = readFileSync(p, 'utf8');
  }
  return out;
}
const hash = (d: string): string => createHash('sha256').update(JSON.stringify(tree(d))).digest('hex');
const cfg = (t: string) => parseConfig(readFileSync(join(t, '.burhan/workflow.config'), 'utf8')).values;

for (const lang of ['en', 'ar'] as const) for (const present of [false, true]) {
  test(`${lang}: wizard summary offers optional Superpowers once iff absent, present=${present}`, async () => {
    const target = fresh();
    const suppliedHome = tmpDir('burhan-wizard-optional-home-');
    if (present) mkdirSync(join(suppliedHome, '.claude/plugins/superpowers'), { recursive: true });
    const before = hash(target);
    const beforeHome = hash(suppliedHome);
    const prompter = scriptedPrompter(['use', 'cancel']);
    const result = capture(target);
    assert.equal(await runWizard(target, result.io, prompter, lang, suppliedHome), 0);
    const output = prompter.shown.join('\n') + result.o.out;
    assert.equal(output.split('/plugin install superpowers@claude-plugins-official').length - 1, present ? 0 : 1);
    if (!present) assert.match(output, /Claude Code/);
    assert.equal(hash(target), before);
    assert.equal(hash(suppliedHome), beforeHome);
  });
}

test('first screen: three outcome lines, "sends nothing", the recommended preview and the summary promise (AC-02, AC-03)', async () => {
  const t = fresh(); const p = scriptedPrompter([CANCEL]); const { io } = capture(t);
  await runWizard(t, io, p, 'en', home);
  const s = p.shown.join('\n');
  assert.match(s, /short plan and waits for your OK/);
  assert.match(s, /checks its own work before every commit/);
  assert.match(s, /never commits without asking/);
  assert.match(s, /inside this project only · sends nothing · removable with one command/);
  assert.match(s, /Check before commit: your agent sets this up on first use/);
  assert.match(s, /you'll see the full summary before anything is written/);
});

test('fast path: two answers, files written (AC-03)', async () => {
  const t = fresh(); const p = scriptedPrompter(['use', 'apply']); const { o, io } = capture(t);
  assert.equal(await runWizard(t, io, p, 'en', home), 0);
  assert.equal(p.asked.length, 2);
  assert.equal(cfg(t).WF_DOCS_DIR, '.burhan/work');
  assert.match(o.out, /npx burhan-kit uninstall/);
  assert.match(o.out, /change burhan settings/);
});

test('choose myself asks exactly three questions, then the summary choice (AC-04)', async () => {
  const t = fresh(); const p = scriptedPrompter(['choose', 'both', 'auto', 'shared', 'apply']); const { io } = capture(t);
  assert.equal(await runWizard(t, io, p, 'en', home), 0);
  assert.equal(p.asked.length, 5); // use/choose + 3 questions + apply
  assert.equal(cfg(t).WF_MODE_DEFAULT, 'auto');
  assert.equal(cfg(t).WF_DOCS_DIR, 'docs/burhan/work');
});

test('"change something" goes back to the questions, prefilled', async () => {
  const t = fresh(); const p = scriptedPrompter(['use', 'change', 'claude', 'step', 'private', 'apply']); const { io } = capture(t);
  assert.equal(await runWizard(t, io, p, 'en', home), 0);
  assert.equal(p.asked.length, 6);
});

test('cancel anywhere writes nothing and exits 0', async () => {
  for (const script of [[CANCEL], ['use', CANCEL], ['use', 'cancel'], ['choose', 'claude', CANCEL]]) {
    const t = fresh(); const before = hash(t); const { io } = capture(t); const p = scriptedPrompter(script);
    assert.equal(await runWizard(t, io, p, 'en', home), 0);
    assert.equal(hash(t), before);
    // The flow stops at the cancel: no question after it (a script that runs out also answers CANCEL, so the count is the proof).
    assert.equal(p.asked.length, script.length, JSON.stringify(script));
  }
});

test('the summary is shown before anything is written, with the undo and nothing-committed lines (AC-06)', async () => {
  const t = fresh(); const before = hash(t); const p = scriptedPrompter(['use', CANCEL]); const { io } = capture(t);
  assert.equal(await runWizard(t, io, p, 'en', home), 0);
  const s = p.shown.join('\n');
  assert.match(s, /Change anytime: npx burhan-kit setup · Undo: npx burhan-kit uninstall/);
  assert.match(s, /Nothing is committed · nothing outside this project changes/);
  assert.equal(hash(t), before, 'shown, not written');
});

test('custom path uses the engine rule (rejects ../x, accepts notes/work)', async () => {
  assert.notEqual(docsPathError('../x'), undefined);
  assert.equal(docsPathError('notes/work'), undefined);
  const t = fresh(); const p = scriptedPrompter(['choose', 'claude', 'step', 'custom', '../x', 'notes/work', 'apply']); const { io } = capture(t);
  assert.equal(await runWizard(t, io, p, 'en', home), 0);
  assert.equal(cfg(t).WF_DOCS_DIR, 'notes/work');
  assert.ok(p.shown.some((x) => /leaves this project/.test(x)));
});

test('a prompter that throws on its 2nd call: the numbered fallback re-asks and finishes (AC-08)', async () => {
  const t = fresh(); const { io } = capture(t);
  const inner = scriptedPrompter(['use']);
  let calls = 0;
  const flaky: Prompter = { ...inner, select: (m, c, i) => { if (++calls === 2) throw new Error('tty broke'); return inner.select(m, c, i); } } as Prompter;
  const input = new PassThrough(); const out = new PassThrough();
  input.end('1\n');
  assert.equal(await runWizard(t, io, withFallback(flaky, () => numberedPrompter(input, out)), 'en', home), 0);
  assert.equal(cfg(t).WF_DOCS_DIR, '.burhan/work');
});

test('numberedPrompter: "2" picks the 2nd, "9 then 1" re-asks, EOF cancels', async () => {
  const ch = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];
  const run = async (txt: string) => { const i = new PassThrough(); i.end(txt); const o = new PassThrough(); const p = numberedPrompter(i, o); const r = await p.select('q', ch, 'a'); p.close(); return r; };
  assert.equal(await run('2\n'), 'b');
  assert.equal(await run('9\n1\n'), 'a');
  assert.equal(await run(''), CANCEL);
});

test('--lang ar shows Arabic and no setting names', async () => {
  const t = fresh(); const p = scriptedPrompter(['use', 'apply']); const { o, io } = capture(t);
  await runWizard(t, io, p, 'ar', home);
  const s = p.shown.join('\n') + o.out;
  assert.match(s, /[؀-ۿ]/);
  assert.doesNotMatch(s, /WF_/);
  assert.match(p.shown.join('\n'), /جوّه المشروع ده بس/);
});

test('an installed project opens prefilled (AC-17)', async () => {
  const t = fresh(); const { io } = capture(t);
  await runWizard(t, io, scriptedPrompter(['choose', 'claude', 'auto', 'shared', 'apply']), 'en', home);
  const p = scriptedPrompter(['use', 'apply']);
  await runWizard(t, io, p, 'en', home);
  assert.match(p.shown.join('\n'), /Current settings of this project/);
  assert.match(p.shown.join('\n'), /docs\/burhan\/work/);
  assert.equal(cfg(t).WF_MODE_DEFAULT, 'auto'); // "use these" kept the installed values
});
