import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers.js';
import { run } from '../../src/hooks/main.mjs';

// Enforcement (project-scan-and-memory AC-09): a reminder every turn and a turn-end warning while a brownfield project
// has no Approved or Waived baseline. They inform; they never block. Exempt: greenfield, patch, read-only, onboarding.
const REMIND = '⚑ PROJECT NOT UNDERSTOOD YET';
const DRAFT = '⚑ BASELINE IS A DRAFT';
const GATE = '⚠ BASELINE GATE';
const evidence = tmpDir('burhan-und-ev-');

function project(o: { sources?: number; baseline?: string | null; state?: string } = {}): string {
  const p = tmpDir('burhan-und-');
  mkdirSync(join(p, 'src'), { recursive: true });
  for (let i = 0; i < (o.sources ?? 12); i++) writeFileSync(join(p, 'src', `f${i}.ts`), 'x');
  mkdirSync(join(p, '.burhan/local'), { recursive: true });
  writeFileSync(join(p, '.burhan/workflow.config'), `WF_DOCS_DIR='.burhan/work'\nWF_CODE_REGEX='^src/'\nWF_SKILLS='none'\nWF_EVIDENCE_DIR='${evidence}'\n`);
  if (o.baseline !== null) writeFileSync(join(p, '.burhan/PROJECT.md'), `# P\n${o.baseline ?? '- **Baseline:** Draft'}\n`);
  if (o.state !== undefined) writeFileSync(join(p, '.burhan/local/PROGRESS.md'), o.state);
  return p;
}
async function prompt(p: string, text = 'add a login page'): Promise<string> {
  const r = await run(['core', 'prompt-router'], JSON.stringify({ event: 'prompt', prompt: text, project_dir: p, session: 'S1' }), { WF_EVIDENCE_DIR: evidence });
  assert.equal(r.debug, '');
  return r.stdout;
}
async function turnEnd(p: string, turn: { files_created?: string[]; files_edited?: string[]; assistant_text?: string }): Promise<string> {
  const event = { event: 'turn_end', session: 'S1', turn_id: 'T1', project_dir: p, turn: { files_created: [], files_edited: [], shell_commands: [], skills_used: [], assistant_text: '', steps: [], ...turn } };
  const r = await run(['core', 'turn-audit'], JSON.stringify(event), { WF_EVIDENCE_DIR: evidence });
  assert.equal(r.debug, '');
  return r.stdout;
}

test('reminder: every prompt while there is no baseline, a malformed one, or a Draft (shorter); silent once decided', async () => {
  const none = await prompt(project({ baseline: null }));
  assert.ok(none.includes(REMIND) && none.includes('/burhan:onboard') && none.includes('.burhan/commands/onboard.md'), none);
  const bad = await prompt(project({ baseline: '- **Baseline:** Approved' }));
  assert.ok(bad.includes(REMIND) && bad.includes('memory check'), bad);
  const draft = await prompt(project({ baseline: '- **Baseline:** Draft' }));
  assert.ok(draft.includes(DRAFT) && !draft.includes(REMIND), draft);
  const lineOf = (s: string, k: string): string => (JSON.parse(s).message as string).split('\n').find((l) => l.startsWith(k)) ?? '';
  assert.ok(lineOf(draft, DRAFT).length < lineOf(none, REMIND).length, 'the Draft line is shorter');
  for (const b of ['- **Baseline:** Approved — Ahmed · 2026-10-19', '- **Baseline:** Waived — Ahmed · 2026-10-19', '- **Memory status:** Approved 2026-10-15']) {
    const out = await prompt(project({ baseline: b }));
    assert.ok(!out.includes(REMIND) && !out.includes(DRAFT), `${b}: ${out}`);
  }
});

test('reminder: does not take one of the router\'s two phase lines', async () => {
  const out = JSON.parse(await prompt(project({ baseline: null }), 'fix the bug in the login permissions')).message as string;
  assert.match(out, /Access\/visibility work/);
  assert.match(out, /Bug →/);
  assert.ok(out.includes(REMIND));
});

test('reminder: exempt on greenfield, on a patch or read-only item, and while onboarding', async () => {
  assert.ok(!(await prompt(project({ sources: 3, baseline: null }))).includes(REMIND), 'greenfield');
  for (const route of ['change / patch', 'investigation / bounded']) {
    const out = await prompt(project({ baseline: null, state: `## Now\n### x\n- **Route:** ${route}\n` }));
    assert.ok(!out.includes(REMIND), `${route}: ${out}`);
  }
  for (const text of ['/burhan:onboard', 'Follow .burhan/commands/onboard.md', 'understand this project']) {
    assert.ok(!(await prompt(project({ baseline: null }), text)).includes(REMIND), text);
  }
});

test('turn-end gate: a story written or code edited on a brownfield with no decided baseline warns', async () => {
  const p = project({ baseline: '- **Baseline:** Draft' });
  mkdirSync(join(p, '.burhan/work/x'), { recursive: true }); writeFileSync(join(p, '.burhan/work/x/x-story.md'), 'x');
  const story = await turnEnd(p, { files_created: ['.burhan/work/x/x-story.md'] });
  assert.ok(story.includes(GATE) && story.includes('story'), story);
  const code = await turnEnd(project({ baseline: null }), { files_edited: ['src/f1.ts'] });
  assert.ok(code.includes(GATE) && code.includes('code'), code);
  assert.match(code, /never write Approved or Waived yourself/);
});

test('turn-end gate: silent for an approved or waived baseline, greenfield, patch, read-only, the onboarding turn, other files', async () => {
  for (const b of ['- **Baseline:** Approved — Ahmed · 2026-10-19', '- **Baseline:** Waived — Ahmed · 2026-10-19']) {
    assert.ok(!(await turnEnd(project({ baseline: b }), { files_edited: ['src/f1.ts'] })).includes(GATE), b);
  }
  assert.ok(!(await turnEnd(project({ sources: 2, baseline: null }), { files_edited: ['src/f1.ts'] })).includes(GATE), 'greenfield');
  assert.ok(!(await turnEnd(project({ baseline: null, state: '## Now\n### x\n- **Route:** bug / patch\n' }), { files_edited: ['src/f1.ts'] })).includes(GATE), 'patch');
  assert.ok(!(await turnEnd(project({ baseline: null, state: '## Now\n### x\n- **Route:** investigation / bounded\n' }), { files_edited: ['src/f1.ts'] })).includes(GATE), 'read-only');
  assert.ok(!(await turnEnd(project({ baseline: null }), { files_edited: ['.burhan/PROJECT.md', '.burhan/context/stack.md'] })).includes(GATE), 'the onboarding turn writes memory, not code');
  assert.ok(!(await turnEnd(project({ baseline: null }), { files_edited: ['README.md'] })).includes(GATE), 'not code, not a story');
});

test('fail open: an unreadable PROJECT.md or tree never breaks the hooks', async (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0) { t.skip('needs chmod (not Windows, not root)'); return; }
  const p = project({ baseline: '- **Baseline:** Approved — Ahmed · 2026-10-19' });
  chmodSync(join(p, '.burhan/PROJECT.md'), 0o000);
  const out = await prompt(p);
  chmodSync(join(p, '.burhan/PROJECT.md'), 0o644);
  assert.ok(out.includes(REMIND), 'an unreadable PROJECT.md counts as no baseline, and nothing throws');
});

test('per-turn cost: an approved project is not walked; an undecided large one stays under the hook time limit', async () => {
  const big = project({ sources: 0, baseline: '- **Baseline:** Approved — Ahmed · 2026-10-19' });
  for (let d = 0; d < 20; d++) { mkdirSync(join(big, `docs${d}`)); for (let i = 0; i < 300; i++) writeFileSync(join(big, `docs${d}`, `n${i}.md`), 'x'); }
  let t0 = performance.now(); await prompt(big); const approved = performance.now() - t0;
  writeFileSync(join(big, '.burhan/PROJECT.md'), '# P\n');
  t0 = performance.now(); await prompt(big); const undecided = performance.now() - t0;
  assert.ok(approved < 100, `approved: ${approved.toFixed(0)} ms`);
  assert.ok(undecided < 1500, `undecided: ${undecided.toFixed(0)} ms`);
});

// Review fix round (SU6 review I-1, M-1…M-6).
test('I-1: the patch lane declared in the turn text (no item in the state file) is exempt; a sensitive path is not', async () => {
  const p = project({ baseline: '- **Baseline:** Draft' });
  assert.ok(!(await turnEnd(p, { files_edited: ['src/f1.ts'], assistant_text: 'patch — typo in a message' })).includes(GATE));
  const q = project({ baseline: '- **Baseline:** Draft' });
  writeFileSync(join(q, '.burhan/workflow.config'), `WF_DOCS_DIR='.burhan/work'\nWF_CODE_REGEX='^src/'\nWF_SKILLS='none'\nWF_EVIDENCE_DIR='${evidence}'\nWF_SENSITIVE_REGEX='^src/f1'\nWF_SENSITIVE_NOTE='money'\n`);
  assert.ok((await turnEnd(q, { files_edited: ['src/f1.ts'], assistant_text: 'patch — typo' })).includes(GATE), 'a sensitive path is never a patch');
});

test('M-2: touching PROJECT.md in the same turn as code does not silence the gate', async () => {
  const out = await turnEnd(project({ baseline: null }), { files_edited: ['src/f1.ts', '.burhan/PROJECT.md'] });
  assert.ok(out.includes(GATE), out);
});

test('M-1/M-3: the Arabic onboarding phrases silence the reminder; a word that only contains them does not', async () => {
  for (const text of ['افهم المشروع', 'عايز فهم المشروع']) assert.ok(!(await prompt(project({ baseline: null }), text)).includes(REMIND), text);
  assert.ok((await prompt(project({ baseline: null }), 'I misunderstand the project')).includes(REMIND));
});

test('M-6: an approved project is never walked — a tree that takes about a second to walk costs nothing', async () => {
  const p = project({ sources: 0, baseline: '- **Baseline:** Approved — Ahmed · 2026-10-19' });
  writeFileSync(join(p, '.burhan/workflow.config'), `WF_DOCS_DIR='.burhan/work'\nWF_CODE_REGEX='.{1000}~'\nWF_SKILLS='none'\nWF_EVIDENCE_DIR='${evidence}'\n`);
  for (let d = 0; d < 20; d++) { mkdirSync(join(p, `d${d}`)); for (let i = 0; i < 150; i++) writeFileSync(join(p, `d${d}`, `${'n'.repeat(200)}${i}.txt`), 'x'); }
  let t0 = performance.now(); await prompt(p); const approved = performance.now() - t0;
  writeFileSync(join(p, '.burhan/PROJECT.md'), '# P\n');
  t0 = performance.now(); await prompt(p); const undecidedMs = performance.now() - t0;
  assert.ok(undecidedMs > 4 * approved, `undecided ${undecidedMs.toFixed(0)} ms vs approved ${approved.toFixed(0)} ms`);
  assert.ok(undecidedMs < 1500, `the hook time limit holds: ${undecidedMs.toFixed(0)} ms`);
});

test('N-1: patch text with an item whose route is not a patch still warns', async () => {
  const p = project({ baseline: '- **Baseline:** Draft', state: '## Now\n### x\n- **Route:** feature / bounded\n' });
  assert.ok((await turnEnd(p, { files_edited: ['src/f1.ts'], assistant_text: 'patch — typo' })).includes(GATE));
});
