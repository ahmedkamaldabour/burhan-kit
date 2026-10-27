import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { applySetup, planSetup, renderSummary, type SetupAnswers } from '../src/lib/setup/engine.js';
import { tmpDir } from './helpers.js';

const home = tmpDir('burhan-symlink-target-home-');

const settingsFiles = [
  { agent: 'claude' as const, rel: '.claude/settings.json' },
  { agent: 'codex' as const, rel: '.codex/hooks.json' },
];

function answers(agent: 'claude' | 'codex'): SetupAnswers {
  return { agents: [agent], mode: 'step', docs: { kind: 'private' }, lang: 'en' };
}

function project(): string {
  return tmpDir('burhan-symlink-target-project-');
}

function linkSettings(target: string, rel: string, realFile: string): string {
  const link = join(target, rel);
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(realFile, link);
  return link;
}

// Catches removing the boundary check or omitting either language's pre-approval warning.
test('AC-21: summaries name an outside settings symlink target and say it is outside the project in English and Egyptian Arabic', () => {
  for (const { agent, rel } of settingsFiles) {
    const target = project();
    const outside = tmpDir('burhan-symlink-target-outside-');
    const realFile = join(outside, `${agent}.json`);
    writeFileSync(realFile, '{"hooks":{}}\n');
    linkSettings(target, rel, realFile);

    const plan = planSetup(target, answers(agent), home);
    const real = realpathSync(realFile);
    const en = renderSummary(plan, 'en');
    const ar = renderSummary(plan, 'ar');

    assert.match(en, new RegExp(real.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(en, /outside (?:this |the )?project/i);
    assert.match(ar, new RegExp(`[^\\n]*${real.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*[\\u0600-\\u06ff]`));
  }
});

test('AC-21: summaries do not name a plain settings file or a symlink whose real file stays inside the project', () => {
  for (const { agent, rel } of settingsFiles) {
    const plain = project();
    const plainFile = join(plain, rel);
    mkdirSync(dirname(plainFile), { recursive: true });
    writeFileSync(plainFile, '{"hooks":{}}\n');
    assert.doesNotMatch(renderSummary(planSetup(plain, answers(agent), home), 'en'), new RegExp(realpathSync(plainFile).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    const linked = project();
    const realFile = join(linked, `${agent}-settings.json`);
    writeFileSync(realFile, '{"hooks":{}}\n');
    linkSettings(linked, rel, realFile);
    assert.doesNotMatch(renderSummary(planSetup(linked, answers(agent), home), 'en'), new RegExp(realpathSync(realFile).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

// outside-writes-guard (AC-07): setup now refuses an outside settings link unless allowed; with the flag the old behaviour holds.
test('AC-21: apply refuses an outside settings symlink; with the allow flag it writes through without replacing it', () => {
  for (const { agent, rel } of settingsFiles) {
    const target = project();
    const outside = tmpDir('burhan-symlink-target-outside-');
    const realFile = join(outside, `${agent}.json`);
    writeFileSync(realFile, '{"hooks":{}}\n');
    const link = linkSettings(target, rel, realFile);

    assert.throws(() => applySetup(planSetup(target, answers(agent), home)), /resolves outside the project/u);
    assert.equal(readFileSync(realFile, 'utf8'), '{"hooks":{}}\n', 'refused: the outside file is untouched');

    applySetup(planSetup(target, answers(agent), home), undefined, { allowOutside: true });

    assert.ok(lstatSync(link).isSymbolicLink(), `${rel} remains a symlink`);
    assert.match(readFileSync(realFile, 'utf8'), /"hooks"/);
  }
});
