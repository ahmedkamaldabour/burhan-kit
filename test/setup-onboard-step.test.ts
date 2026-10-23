import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { agentInstructions, runAnswers } from '../src/lib/setup/agent.js';
import { scriptedPrompter } from '../src/lib/setup/prompter.js';
import { runWizard } from '../src/lib/setup/wizard.js';
import { capture, tmpDir } from './helpers.js';

// Step 3 of the first run: after setup, a NEW agent session runs the project-understanding command. It is its own
// titled block at the very end of setup, with a ready-to-copy line per selected agent, in the chosen language.
const STEP = {
  en: { title: 'Step 3 — start your first session', anyMessage: 'type any message', checkFirst: 'check command', oneApproval: 'approve it once', conditional: 'if it is not set yet', greets: 'only greets you', direct: 'straight to the understanding step', once: 'once', approved: 'an approved understanding is not repeated', draft: 'a draft is completed', claude: '/burhan:onboard', codex: 'Follow .burhan/commands/onboard.md', session: 'NEW agent session' },
  ar: { title: 'الخطوة 3 — ابدأ أول جلسة', anyMessage: 'اكتب أي رسالة', checkFirst: 'أمر الفحص', oneApproval: 'بتوافق عليه مرة واحدة', conditional: 'لو لسه مش متظبط', greets: 'رد بتحية بس', direct: 'تروح للفهم على طول', once: 'مرة واحدة', approved: 'الفهم المعتمد مش بيتكرر', draft: 'المسودة بتتكمّل', claude: '/burhan:onboard', codex: 'اتبع .burhan/commands/onboard.md', session: 'جلسة agent جديدة' },
} as const;
const home = tmpDir('burhan-onboard-home-');
const fresh = (): string => { const d = tmpDir('burhan-onboard-'); spawnSync('git', ['init', '-q'], { cwd: d }); return d; };
const choices = { claude: ['claude'], codex: ['codex'], both: ['claude', 'codex'] } as const;

function checkBlock(out: string, lang: 'en' | 'ar', agents: readonly string[], done: string): void {
  const s = STEP[lang];
  const at = out.lastIndexOf(s.title);
  assert.ok(at !== -1, `the step-3 title is printed:\n${out}`);
  assert.ok(at > out.lastIndexOf(done), 'the block comes after the "done" lines');
  const block = out.slice(at);
  assert.ok(block.split('\n')[0].trim() === s.title || block.startsWith(s.title), 'the title is its own line');
  for (const word of [s.once, s.session, s.approved, s.draft, s.anyMessage, s.checkFirst, s.oneApproval, s.direct, s.conditional, s.greets]) assert.ok(block.includes(word), `${lang}: ${word}`);
  assert.equal(block.includes(s.claude), agents.includes('claude'), `${lang}: the Claude line only when Claude is selected`);
  assert.equal(block.includes(s.codex), agents.includes('codex'), `${lang}: the Codex sentence only when Codex is selected`);
}

for (const lang of ['en', 'ar'] as const) for (const [choice, agents] of Object.entries(choices)) {
  const done = lang === 'en' ? 'Done. burhan is set up in this project.' : 'خلاص. burhan جاهز في المشروع ده.';
  test(`${lang}/${choice}: the wizard ends with the step-3 block`, async () => {
    const t = fresh();
    const r = capture(t);
    const script = ['choose', choice, 'step', 'private', 'beside', ...(choice === 'both' ? ['same'] : []), 'apply'];
    assert.equal(await runWizard(t, r.io, scriptedPrompter(script), lang, home), 0, r.o.err);
    checkBlock(r.o.out, lang, agents, done);
  });

  test(`${lang}/${choice}: setup --answers --apply ends with the step-3 block`, () => {
    const t = fresh();
    const file = join(tmpDir('burhan-onboard-answers-'), 'a.json');
    writeFileSync(file, JSON.stringify({ agents: choice, mode: 'step', docs: 'private', lang, ...(choice === 'both' ? { reviewer: 'same' } : {}) }));
    const r = capture(t);
    assert.equal(runAnswers(t, file, true, r.io, lang, home), 0, r.o.err);
    checkBlock(r.o.out, lang, agents, done);
  });
}

test('--agent rules: relay the step-3 block as it appears and tell the person to open a new session and type any message', () => {
  const en = agentInstructions(fresh(), 'en', home);
  assert.match(en, /relay the "Step 3" block .*exactly as it appears/iu);
  assert.match(en, /new agent session/iu);
  assert.match(en, /types? any message/iu);
  const ar = agentInstructions(fresh(), 'ar', home);
  assert.ok(ar.includes('الخطوة 3') && ar.includes('جلسة agent جديدة') && ar.includes('أي رسالة'), ar);
});
