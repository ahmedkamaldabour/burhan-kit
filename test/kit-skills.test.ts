import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Tests run from .test-build/test, so the repository root is two levels up.
const root = fileURLToPath(new URL('../../', import.meta.url));
const NAMES = ['burhan-story', 'burhan-plan', 'burhan-build', 'burhan-debug', 'burhan-review', 'burhan-done'];
const NOTICE = 'THIRD-PARTY-NOTICES.md';
const SHARED = join(root, 'kit/skills/shared');
const text = (name: string): string => readFileSync(join(SHARED, name, 'SKILL.md'), 'utf8');
const norm = (s: string): string => s.replace(/[`*]/g, '').replace(/\s+/g, ' ').trim();
// The same split as test/stage-split.test.ts: a sentence ends at . ! ? or :
const SPLIT = /(?<=[.!?:])\s+|\s*│\s*/;
const sentences = (t: string): string[] => norm(t).split(SPLIT).filter((s) => s.split(' ').length >= 9);
const section = (t: string, heading: string): string => {
  const part = t.split(/^## /m).find((p) => p.startsWith(`${heading}\n`));
  return part === undefined ? '' : part.slice(heading.length + 1);
};
const kitMarkdown = (): string[] => ['kit/commands', 'kit/phases', 'kit/templates', 'kit', 'kit/agents/claude']
  .flatMap((d) => readdirSync(join(root, d), { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => `${d}/${e.name}`));

test('the six skills exist, one folder each with a SKILL.md, and no notice beside them', () => {
  assert.deepEqual(readdirSync(SHARED).sort(), [...NAMES].sort());
  for (const n of NAMES) {
    assert.deepEqual(readdirSync(join(SHARED, n)), ['SKILL.md'], n);
    const m = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(text(n));
    assert.ok(m, `${n}: front matter with name and description`);
    assert.equal(m[1], n);
    assert.ok(m[2]!.startsWith('Use when '), `${n}: the description starts with "Use when "`);
    assert.ok(m[2]!.length <= 300, `${n}: the description is one short line`);
  }
});

test('every skill has the four parts, a phase file that exists and one-line answers', () => {
  for (const n of NAMES) {
    const t = text(n);
    assert.match(t, new RegExp(`^# ${n}$`, 'm'), `${n}: its title`);
    for (const h of ['When', 'Rules', 'Shortcuts you will tell yourself', 'Where the rules are']) assert.match(t, new RegExp(`^## ${h}$`, 'm'), `${n}: ## ${h}`);
    const files = [...section(t, 'Where the rules are').matchAll(/`\.burhan\/phases\/([a-z-]+\.md)`/g)].map((m) => m[1]!);
    assert.ok(files.length > 0, `${n}: names a phase file`);
    for (const f of files) assert.ok(existsSync(join(root, 'kit/phases', f)), `${n}: kit/phases/${f} exists`);
    const rules = section(t, 'Rules').split('\n').filter((l) => /^\d+\. /.test(l));
    assert.ok(rules.length >= 5, `${n}: a numbered rule list`);
    const rows = section(t, 'Shortcuts you will tell yourself').split('\n').filter((l) => l.startsWith('|')).slice(2);
    assert.ok(rows.length >= 3, `${n}: at least three shortcuts, each answered`);
    for (const r of rows) {
      const cells = r.split('|').slice(1, -1).map((c) => c.trim());
      assert.equal(cells.length, 2, `${n}: a shortcut and its answer: ${r}`);
      assert.ok(cells[1]!.split(/\s+/).length <= 30, `${n}: the answer is one line: ${r}`);
    }
  }
});

test('no sentence of nine or more words of a skill appears in another skill or a kit file', () => {
  const others = [...kitMarkdown(), 'kit/skills/claude/burhan-verify/SKILL.md'].map((f) => ({ f, s: new Set(sentences(readFileSync(join(root, f), 'utf8'))) }));
  const seen = new Map<string, string>();
  const dup: string[] = [];
  for (const n of NAMES) {
    for (const s of new Set(sentences(text(n)))) {
      for (const o of others) if (o.s.has(s)) dup.push(`${n}: ${s.slice(0, 70)} → ${o.f}`);
      const first = seen.get(s);
      if (first !== undefined) dup.push(`${n}: ${s.slice(0, 70)} → ${first}`);
      else seen.set(s, n);
    }
  }
  assert.deepEqual(dup, []);
});

const FORBIDDEN: Array<[string, RegExp]> = [
  ['a git commit, add or push', /\bgit (commit|add|push)\b/i],
  ['questions one at a time', /one (question )?(at a time|per message)|question by question|one by one|next question/i],
  ['a path outside the item folder', /docs\/superpowers|\.superpowers|docs\/plans|docs\/specs|~\/|\/tmp\//i],
  ['a Superpowers skill or the removed key', /superpowers:|WF_SKILLS/i],
  ["approval on the owner's behalf", /approve (it|this|(the )?(story|plan|qc))[^.|;]*\b(yourself|for them|on their behalf)\b/i],
  ['a second question round', /\b(second|another|more) (set of |round of |round )?questions?\b|\b(second|another|more) rounds?\b/i],
];

// Mutants: sentences a skill must never carry. The list above must catch each one.
const MUTANTS = [
  'Run burhan approve plan yourself once the card is shown.',
  'Then run `burhan approve story` for them once the card is shown.',
  'If the answer is unclear, ask a second set of questions before the card.',
  'If the answer is unclear, ask another round of questions.',
];

test('the forbidden list catches an agent approval and a second question round', () => {
  for (const m of MUTANTS) assert.ok(FORBIDDEN.some(([, re]) => re.test(m)), `not caught: ${m}`);
});

test('no skill holds a forbidden instruction', () => {
  for (const n of NAMES) {
    const t = text(n);
    for (const [label, re] of FORBIDDEN) assert.doesNotMatch(t, re, `${n}: ${label}`);
    for (const s of norm(t).split(/(?<=[.!?])\s+/)) {
      if (/\bcommit\b(?! sha)/i.test(s)) assert.match(s, /a\/b\/c|checkpoint/i, `${n}: a commit instruction without the checkpoint: ${s.slice(0, 80)}`);
    }
  }
});

const REQUIRED: Record<string, RegExp[]> = {
  'burhan-story': [/one round/, /decision card/, /burhan approve story/, /\bsha\b/, /combined gate/, /already satisfied/, /owner's/, /still-empty plan/, /no agent runs `?burhan approve/, /full id/, /public API/, /confirm that it fails/, /with burhan-plan open/, /lighter route provisionally/],
  'burhan-plan': [/build spec/, /Why separate/, /burhan item check/, /burhan approve plan/, /stop/i, /combined gate/, /needs no change/, /only A1, A2, A3/, /paragraph under the sub-unit heading/, /no agent runs `burhan approve`; see burhan-story/],
  'burhan-build': [/failing test|RED/, /burhan guide/, /a\/b\/c/, /sub-unit/, /burhan item set <slug> unit/, /burhan deviation add <slug> --unit/, /burhan state set <slug>/, /passes at once/, /does not match the real file/],
  'burhan-debug': [/root cause/, /three/i, /read-only/i],
  'burhan-review': [/fresh context/, /burhan finding add/, /burhan review add/, /owner decides/, /--in review:/, /--severity/, /--none/, /by hand/, /not marked reviewed/, /plan defect/, /Critical, Important or Minor/, /fresh subagent \| other agent \| human \| same session/, /by hand/, /handback/, /Re-review after findings/],
  'burhan-done': [/not to be run at the story or plan stage/, /burhan verify/, /a\/b\/c/, /exit code/, /acceptance criteri/],
};

test('each skill holds the rules it must carry', () => {
  for (const n of NAMES) for (const re of REQUIRED[n]!) assert.match(text(n), re, `${n}: ${re}`);
});

// Wording of the Superpowers skills that the kit must not carry (lower-cased compare).
const OLD_WORDING = [
  'no production code without a failing test first',
  'you never saw it catch the bug',
  'if you did not watch the test fail, you do not know that it tests the right thing',
  'simple bugs have root causes too',
  'i see the problem, let me fix it',
];

test('no skill names Superpowers or holds its wording, and no third-party notice is shipped', () => {
  for (const n of NAMES) {
    const t = norm(text(n)).toLowerCase();
    assert.doesNotMatch(t, /superpowers|adapted from|third-party/, `${n}: names no source and carries no Adapted line`);
    for (const o of OLD_WORDING) assert.ok(!t.includes(o), `${n}: holds the wording "${o}"`);
  }
  assert.ok(!existsSync(join(SHARED, NOTICE)), 'no notice in kit/skills/shared');
  assert.ok(!existsSync(join(root, NOTICE)), 'no notice at the repository root');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { files: string[] };
  assert.ok(!pkg.files.includes(NOTICE), 'the notice is not in the package files');
});
