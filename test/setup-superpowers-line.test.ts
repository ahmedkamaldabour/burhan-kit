import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { agentInstructions, runAnswers } from '../src/lib/setup/agent.js';
import { planSetup } from '../src/lib/setup/engine.js';
import { messages } from '../src/lib/setup/messages.js';
import { capture, tmpDir } from './helpers.js';

// The Superpowers line: strongly recommended, optional, never installed by burhan; the Claude Code command when Claude
// is selected, and the official Codex route, worded conditionally, whenever Codex is selected (Codex is never detected).
const LINE = {
  en: { strong: 'strongly recommended', optional: 'optional', never: 'burhan never installs it', codex: 'if it is not installed yet: in Codex CLI run /plugins, search superpowers, choose Install Plugin' },
  ar: { strong: 'موصى به بقوة', optional: 'اختياري', never: 'burhan مش بيسطّبه', codex: 'لو لسه مش متسطّب: في Codex CLI شغّل /plugins، دوّر على superpowers، واختار Install Plugin' },
} as const;
const CLAUDE = '/plugin install superpowers@claude-plugins-official';

for (const lang of ['en', 'ar'] as const) {
  const m = messages(lang);
  const s = LINE[lang];

  test(`${lang}: not found — strongly recommended, optional, never installed, the Claude command`, () => {
    const line = m.superpowers(false, false, ['claude']);
    for (const word of [s.strong, s.optional, s.never, CLAUDE]) assert.ok(line.toLowerCase().includes(word.toLowerCase()), `${word}:\n${line}`);
    assert.ok(!line.includes(s.codex), 'no Codex route without Codex');
  });

  test(`${lang}: Codex selected — the conditional Codex route is printed, found or not`, () => {
    for (const available of [false, true]) {
      assert.ok(m.superpowers(available, false, ['codex']).includes(s.codex), `available=${available}`);
      assert.ok(m.superpowers(available, false, ['claude', 'codex']).includes(s.codex), `both, available=${available}`);
    }
    assert.ok(!m.superpowers(false, false, ['codex']).includes(CLAUDE), 'no Claude command without Claude');
    assert.ok(m.superpowers(false, false, ['claude', 'codex']).includes(CLAUDE));
  });

  test(`${lang}: found — strongly recommended; turned off — no install route`, () => {
    assert.ok(m.superpowers(true, false, ['claude']).toLowerCase().includes(s.strong.toLowerCase()));
    const off = m.superpowers(true, true, ['claude', 'codex']);
    assert.ok(!off.includes(s.codex) && !off.includes(CLAUDE), off);
  });

  test(`${lang}: the line stays one line (the summary indents it)`, () => {
    for (const available of [false, true]) assert.ok(!m.superpowers(available, false, ['claude', 'codex']).includes('\n'));
  });
}

test('detection reads only ~/.claude/plugins: an installed and enabled Codex plugin is not detected', () => {
  const home = tmpDir('burhan-sp-codex-home-');
  mkdirSync(join(home, '.codex/plugins/cache/openai-plugins/superpowers/6.1.1'), { recursive: true });
  writeFileSync(join(home, '.codex/config.toml'), '[plugins."superpowers@claude-plugins-official"]\nenabled = true\n');
  const t = tmpDir('burhan-sp-codex-'); spawnSync('git', ['init', '-q'], { cwd: t });
  const plan = planSetup(t, { agents: ['codex'], mode: 'step', lang: 'en', docs: { kind: 'private' } }, home);
  assert.equal(plan.superpowersAvailable, false);
  mkdirSync(join(home, '.claude/plugins/superpowers'), { recursive: true });
  assert.equal(planSetup(t, { agents: ['codex'], mode: 'step', lang: 'en', docs: { kind: 'private' } }, home).superpowersAvailable, true);
});

// F-1 (verification): `setup --agent` runs before the agents are answered, so its Superpowers line carries the Codex
// route even in a fresh project with no Codex files; the `--apply` output stays per the chosen agents.
for (const lang of ['en', 'ar'] as const) for (const hooks of [false, true]) {
  test(`${lang}: --agent shows the Codex route and the Claude command before the agents are answered${hooks ? ' (existing hooks)' : ''}`, () => {
    const t = tmpDir('burhan-sp-agent-'); spawnSync('git', ['init', '-q'], { cwd: t });
    if (hooks) {
      mkdirSync(join(t, '.claude'));
      writeFileSync(join(t, '.claude/settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'echo mine' }] }] } }));
    }
    const out = agentInstructions(t, lang, tmpDir('burhan-sp-agent-home-'));
    assert.ok(out.includes(LINE[lang].codex), out);
    assert.ok(out.includes(CLAUDE), out);
  });

  test(`${lang}: --apply with Claude only prints no Codex route${hooks ? ' (existing hooks)' : ''}`, () => {
    const t = tmpDir('burhan-sp-apply-'); spawnSync('git', ['init', '-q'], { cwd: t });
    if (hooks) {
      mkdirSync(join(t, '.claude'));
      writeFileSync(join(t, '.claude/settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'echo mine' }] }] } }));
    }
    const file = join(tmpDir('burhan-sp-answers-'), 'a.json');
    writeFileSync(file, JSON.stringify({ agents: 'claude', mode: 'step', docs: 'private', lang }));
    const r = capture(t);
    assert.equal(runAnswers(t, file, true, r.io, lang, tmpDir('burhan-sp-apply-home-')), 0, r.o.err);
    assert.ok(!r.o.out.includes(LINE[lang].codex), r.o.out);
    assert.ok(r.o.out.includes(CLAUDE));
  });
}

test('--agent with Superpowers found but turned off: no install route in either language', () => {
  const t = tmpDir('burhan-sp-off-'); spawnSync('git', ['init', '-q'], { cwd: t });
  mkdirSync(join(t, '.burhan'));
  writeFileSync(join(t, '.burhan/workflow.config'), "WF_SKILLS='none'\n");
  const home = tmpDir('burhan-sp-off-home-');
  mkdirSync(join(home, '.claude/plugins/superpowers'), { recursive: true });
  for (const lang of ['en', 'ar'] as const) {
    const out = agentInstructions(t, lang, home);
    assert.ok(!out.includes(LINE[lang].codex) && !out.includes(CLAUDE), out);
  }
});
