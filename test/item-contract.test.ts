import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTRACT_VERSION, checkText, crossCheck, hasContractMarker, kindOf } from '../src/hooks/core/item-contract.mjs';
import { routeNeeds, setFieldLine } from '../src/hooks/core/item-model.mjs';
import { checkItem } from '../src/lib/item-check.js';
import { runCli } from '../src/main.js';
import { capture, tmpDir } from './helpers.js';

const codes = (kind: Parameters<typeof checkText>[0], text: string): string[] => checkText(kind, text).map((f) => f.code);

/** A plan that satisfies the contract; `route` and `overall` can be changed, `drop` removes one `## ` section by its title. */
function plan(o: { route?: string; overall?: string; drop?: string[]; unit?: string; boxes?: string; approvedBox?: string } = {}): string {
  const sections: Record<string, string> = {
    'Gate checklist': `## Gate checklist\n${o.boxes ?? `- [x] Story approved\n- ${o.approvedBox ?? '[x]'} Plan approved\n- [ ] Plan re-validated\n`}`,
    'Decisions': '## 1. Decisions\nOptions.\n',
    'AC coverage': '## 2. AC coverage\n| AC | Sub-unit | Test |\n|----|----------|------|\n| AC-01 | 1 | t.test.ts → works |\n',
    'What the story got wrong': '## 3. What the story got wrong\nNone.\n',
    'Rulings': '## 4. Rulings\n| R | why | cost |\n',
    'Sub-unit breakdown': `## 5. Sub-unit breakdown\n${o.unit ?? '### Sub-unit 1 — thing · 🟡 Approved\n- **Covers:** AC-01\n'}`,
    'Security re-read': '## 6. Security re-read\nNone.\n',
    'Verification steps': '## 7. Verification steps\nRun.\n',
    'Limitations': '## 8. Limitations\nSome.\n',
    'Executor rules': '## 9. Executor rules\n1. Follow the plan exactly.\n',
    'Deviations': '## 10. Deviations\n| # | Sub-unit | What | Where | Output | Status | Decision |\n|---|----------|------|-------|--------|--------|----------|\n',
    'Impact log': '## 11. Impact log\n',
    'Knowledge review': '## 12. Knowledge review\nKnowledge review: none\n',
    'Out-of-scope changes': '## 13. Out-of-scope changes\n',
  };
  for (const d of o.drop ?? []) delete sections[d];
  return `# T — Implementation Plan\n- **Route:** ${o.route ?? 'feature / architectural'}\n- **Overall status:** ${o.overall ?? 'In progress'}\n- **Contract:** ${CONTRACT_VERSION}\n\n${Object.values(sections).join('\n')}`;
}

/** A build spec that satisfies the contract: `units` are the sub-unit numbers, `drop` removes parts as "N:Part", `noCode` takes out the code blocks. */
function spec(o: { units?: number[]; drop?: string[]; noCode?: boolean; notVerified?: boolean } = {}): string {
  const block = (lang: string, body: string): string => (o.noCode ? `${body}\n` : '```' + lang + '\n' + body + '\n```\n');
  const unit = (n: number): string => {
    const parts: Record<string, string> = {
      Files: '### Files\n| Path | Create / modify | Lines |\n|------|-----------------|-------|\n| src/a.ts | modify | 10-20 |\n',
      Test: '### Test\n' + block('ts', `test('works', () => {});`),
      RED: '### RED\n- **Command:** `npm test`\n- **Expected output:** FAIL works\n- **Why it fails:** the function is missing\n',
      Implementation: '### Implementation\n' + block('ts', 'export const a = 1;'),
      GREEN: '### GREEN\n- **Command:** `npm test`\n- **Expected output:** pass 1\n',
      Lint: '### Lint\n- **Command:** `npm run lint`\n',
      Interfaces: '### Interfaces\n| Produces | Consumes |\n|----------|----------|\n| a | — |\n',
    };
    for (const d of o.drop ?? []) { const [num, name] = d.split(':'); if (Number(num) === n) delete parts[name!]; }
    return `## Sub-unit ${n} — thing\n${Object.values(parts).join('')}`;
  };
  const head = `# T — Build spec\n- **Plan:** ./t-implementation-plan.md\n- **Contract:** ${CONTRACT_VERSION}\n\n`;
  return head + (o.notVerified === false ? '' : '## Not verified\nNone.\n\n') + (o.units ?? [1]).map(unit).join('\n');
}

const story = (status = 'Approved — dev · 2026-10-27', rows = '| AC-01 | does a thing | request |\n'): string =>
  `# S\n- **Route:** feature / architectural\n- **Status:** ${status}\n\n## Acceptance criteria\n| ID | Criterion | Provenance |\n|----|----|----|\n${rows}`;

test('a plan that follows the contract has no faults', () => {
  assert.deepEqual(checkText('plan', plan()), []);
});

test('a plan that writes Status instead of Overall status is named, with both labels', () => {
  const text = plan().replace('**Overall status:**', '**Status:**');
  const found = checkText('plan', text).find((f) => f.code === 'plan-overall-status-missing');
  assert.ok(found, 'expected plan-overall-status-missing');
  assert.match(found.message, /found `\*\*Status:\*\*`, expected `\*\*Overall status:\*\*`/);
});

test('an overall status that is not on the ladder is refused', () => {
  assert.deepEqual(codes('plan', plan({ overall: 'Done' })), ['plan-overall-status-invalid']);
});

test('an architectural plan needs the security re-read, verification steps, limitations and knowledge review', () => {
  const faults = checkText('plan', plan({ drop: ['Security re-read', 'Verification steps', 'Limitations', 'Knowledge review'] }));
  assert.deepEqual(faults.map((f) => f.code), ['plan-section-missing', 'plan-section-missing', 'plan-section-missing', 'plan-section-missing']);
  assert.match(faults.map((f) => f.message).join('\n'), /Security re-read[\s\S]*Verification steps[\s\S]*Limitations[\s\S]*Knowledge review/);
});

test('a bounded plan does not need those sections', () => {
  assert.deepEqual(checkText('plan', plan({ route: 'change / bounded', drop: ['Security re-read', 'Verification steps', 'Limitations', 'Knowledge review'] })), []);
});

test('the gate checklist and the sub-unit breakdown are needed on every route', () => {
  assert.deepEqual(codes('plan', plan({ route: 'change / bounded', drop: ['Gate checklist', 'Sub-unit breakdown'] })), ['plan-section-missing', 'plan-section-missing']);
});

test('a sub-unit heading without a status from the ladder is named', () => {
  const faults = checkText('plan', plan({ unit: '### Sub-unit 1 — thing\n- **Covers:** AC-01\n### Sub-unit 2 — other · 🟢 Implemented\n- **Covers:** AC-01\n' }));
  assert.deepEqual(faults.map((f) => f.code), ['plan-subunit-status']);
  assert.match(faults[0]!.message, /Sub-unit 1/);
});

test('a breakdown with no sub-unit is refused', () => {
  assert.deepEqual(codes('plan', plan({ unit: 'Some prose.\n' })), ['plan-no-subunits']);
});

test('a gate checklist with no box is refused', () => {
  assert.deepEqual(codes('plan', plan({ boxes: 'Nothing to tick.\n' })), ['plan-gate-checklist-empty']);
});

test('a plan that is Approved or later with the "Plan approved" box open contradicts itself', () => {
  assert.deepEqual(codes('plan', plan({ approvedBox: '[ ]' })), ['plan-gate-unticked']);
  assert.deepEqual(codes('plan', plan({ overall: 'Draft', approvedBox: '[ ]' })), []);
});

test('a route that is not exactly "<type> / <scope>" is refused', () => {
  assert.deepEqual(codes('plan', plan({ route: 'big thing' })), ['route-invalid']);
});

test('a story that follows the contract has no faults, Draft or Approved', () => {
  assert.deepEqual(checkText('story', story()), []);
  assert.deepEqual(checkText('story', story('Draft')), []);
});

test('an approved story must say who and when, in the exact form', () => {
  assert.deepEqual(codes('story', story('Approved')), ['story-approval-form']);
  assert.deepEqual(codes('story', story('Approved (owner)')), ['story-approval-form']);
});

test('a story with no status line, or no acceptance criterion row, is named', () => {
  assert.deepEqual(codes('story', story().replace('**Status:**', '**State:**')), ['story-status-missing']);
  assert.deepEqual(codes('story', story('Draft', '')), ['story-no-acceptance-criteria']);
});

test('a review says who performed it, in the exact form', () => {
  assert.deepEqual(checkText('review', '# R\n- **Performed by:** Claude · Sonnet 5.5 · fresh subagent\n'), []);
  assert.deepEqual(codes('review', '# R\nno line\n'), ['performed-by-missing']);
  assert.deepEqual(codes('review', '# R\n- **Performed by:** me\n'), ['performed-by-form']);
});

test('a QC report also needs a verdict', () => {
  const by = '- **Performed by:** Claude · Sonnet 5.5 · fresh subagent\n';
  assert.deepEqual(codes('qc', `# Q\n${by}`), ['qc-verdict-missing']);
  assert.deepEqual(codes('qc', `# Q\n${by}- **Verdict:** PASS\n`), []);
});

test('a file is known by its name', () => {
  assert.equal(kindOf('x/foo-story.md'), 'story');
  assert.equal(kindOf('x/foo-implementation-plan.md'), 'plan');
  assert.equal(kindOf('x/reviews/foo-review.md'), 'review');
  assert.equal(kindOf('x/reviews/foo-qc-r2.md'), 'qc');
  assert.equal(kindOf('x/reviews/foo-verification.md'), 'verification');
  assert.equal(kindOf('x/foo-findings.md'), 'findings');
  assert.equal(kindOf('x/sources/notes.md'), null);
});

test('the contract marker is the line "**Contract:** 1"', () => {
  assert.equal(hasContractMarker(plan()), true);
  assert.equal(hasContractMarker('# T\n- **Route:** feature / bounded\n'), false);
});

/** A project with one item `foo` under the default docs folder. */
function project(files: Record<string, string>): string {
  const dir = tmpDir('burhan-contract-');
  const item = join(dir, '.burhan', 'work', 'foo');
  mkdirSync(join(item, 'reviews'), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(item, name), text);
  return dir;
}

test('checkItem reads the item folder and labels a file without the marker as legacy', () => {
  const dir = project({ 'foo-story.md': story(), 'foo-implementation-plan.md': plan().replace('- **Contract:** 1\n', '').replace('**Overall status:**', '**Status:**') });
  const results = checkItem(join(dir, '.burhan', 'work'), 'foo');
  const found = Object.fromEntries(results.map((r) => [r.kind, r]));
  assert.equal(found.story!.legacy, true); // a story with no marker is legacy too
  assert.equal(found.plan!.legacy, true);
  assert.deepEqual(found.plan!.faults.map((f) => f.code), ['plan-overall-status-missing']);
});

test('burhan item check: ok, a fault in a marked file fails, a fault in a legacy file only reports', async () => {
  const good = project({ 'foo-implementation-plan.md': plan(), 'foo-build-spec.md': spec() });
  let c = capture(good);
  assert.equal(await runCli(['item', 'check', 'foo'], c.io), 0);
  assert.match(c.o.out, /ok/);

  const bad = project({ 'foo-implementation-plan.md': plan({ overall: 'Done' }), 'foo-build-spec.md': spec() });
  c = capture(bad);
  assert.equal(await runCli(['item', 'check', 'foo'], c.io), 1);
  assert.match(c.o.out, /plan-overall-status-invalid/);

  const legacy = project({ 'foo-implementation-plan.md': plan({ overall: 'Done' }).replace('- **Contract:** 1\n', '') });
  c = capture(legacy);
  assert.equal(await runCli(['item', 'check', 'foo'], c.io), 0);
  assert.match(c.o.out, /legacy/);
});

test('burhan item check refuses a slug that is not a plain name and an item that does not exist', async () => {
  const dir = project({});
  let c = capture(dir);
  assert.equal(await runCli(['item', 'check', '../x'], c.io), 2);
  c = capture(dir);
  assert.equal(await runCli(['item', 'check', 'nope'], c.io), 2);
  assert.match(c.o.err, /nope/);
});

// ---- review round 1 (SU1): the faults the independent review found ----

test('a very long line cannot make the contract slow (no backtracking on a status or a Performed by line)', () => {
  const long = 'a'.repeat(200_000);
  for (const [kind, text] of [['story', story(`Approved — ${long}`)], ['review', `# R\n- **Performed by:** ${long}\n`]] as const) {
    const start = Date.now();
    checkText(kind, text);
    assert.ok(Date.now() - start < 500, `${kind} took ${Date.now() - start} ms on a 200 000 character line`);
  }
});

test('the QC verdict is exact: the unfilled template value and PASSWORD are not a verdict', () => {
  const by = '- **Performed by:** Claude · Sonnet 5.5 · fresh subagent\n';
  for (const bad of ['PASS | FAIL — N issues', 'PASSWORD', 'FAILURE', 'maybe']) assert.deepEqual(codes('qc', `# Q\n${by}- **Verdict:** ${bad}\n`), ['qc-verdict-missing'], bad);
  for (const good of ['PASS', 'FAIL — 2 issues', 'PASS — no Critical or Important']) assert.deepEqual(codes('qc', `# Q\n${by}- **Verdict:** ${good}\n`), [], good);
});

test('the marker is exactly "1": 1.5 and 1-x are not the contract', () => {
  assert.equal(hasContractMarker('- **Contract:** 1.5\n'), false);
  assert.equal(hasContractMarker('- **Contract:** 1-x\n'), false);
  assert.equal(hasContractMarker('- **Contract:** 1\n'), true);
});

test('a heading or a Route line inside a code fence is not read', () => {
  const fenced = plan({ unit: '### Sub-unit 1 — real · 🟡 Approved\n- **Covers:** AC-01\n```\n### Sub-unit 2 — shown as an example\n```\n' }).replace('- **Route:**', '```\n- **Route:** bug / patch\n```\n- **Route:**');
  assert.deepEqual(checkText('plan', fenced), []);
});

test('findings and verification files have a contract too', () => {
  const findings = '# F\n- **Status:** Concluded\n- **Route:** investigation / architectural · **Read-only:** yes\n';
  assert.deepEqual(checkText('findings', findings), []);
  assert.deepEqual(codes('findings', findings.replace('Concluded', 'maybe')), ['findings-status-invalid']);
  assert.deepEqual(codes('verification', '# V\nno line\n'), ['performed-by-missing']);
});

test('a file with Windows line endings follows the contract the same way', () => {
  assert.deepEqual(checkText('plan', plan().replace(/\n/g, '\r\n')), []);
  assert.deepEqual(checkText('story', story().replace(/\n/g, '\r\n')), []);
});

test('checkItem skips a folder named like an item file and reports an unreadable one instead of throwing', () => {
  const dir = project({});
  mkdirSync(join(dir, '.burhan', 'work', 'foo', 'foo-story.md'));
  assert.deepEqual(checkItem(join(dir, '.burhan', 'work'), 'foo'), []);
});

test('burhan item check --docs reads another folder, and refuses one outside the project', async () => {
  const dir = project({});
  mkdirSync(join(dir, 'elsewhere', 'foo'), { recursive: true });
  writeFileSync(join(dir, 'elsewhere', 'foo', 'foo-implementation-plan.md'), plan());
  writeFileSync(join(dir, 'elsewhere', 'foo', 'foo-build-spec.md'), spec());
  let c = capture(dir);
  assert.equal(await runCli(['item', 'check', 'foo', '--docs', 'elsewhere'], c.io), 0);
  c = capture(dir);
  assert.equal(await runCli(['item', 'check', 'foo', '--docs', '..'], c.io), 2);
  assert.match(c.o.err, /inside the project/);
});

test('a field line is set in the real line, not in a fenced example, and a $ in the value is kept', () => {
  const text = '# S\n```\n- **Status:** Draft\n```\n- **Status:** Draft\n';
  assert.equal(setFieldLine(text, 'Status', "Approved — A$'x · 2026-10-27"), "# S\n```\n- **Status:** Draft\n```\n- **Status:** Approved — A$'x · 2026-10-27\n");
  assert.equal(setFieldLine('# S\n', 'Status', 'x'), null);
  assert.equal(setFieldLine('- **Status:** Draft\r\n', 'Status', 'Approved'), '- **Status:** Approved\r\n');
});

test('an unknown route needs everything, never nothing', () => {
  assert.deepEqual(routeNeeds(''), { story: true, qc: true, knowledge: true });
  assert.deepEqual(routeNeeds('feature architectural'), { story: true, qc: true, knowledge: true });
});

// ---- plan shape (sub-unit 10): executor rules, deviations, AC coverage, Covers; the build spec; the cross-file checks ----
test('every plan needs Executor rules and Deviations; a story route also needs AC coverage, a route without a story does not', () => {
  assert.deepEqual(codes('plan', plan({ route: 'change / bounded', drop: ['Executor rules', 'Deviations'] })), ['plan-section-missing', 'plan-section-missing']);
  assert.match(checkText('plan', plan({ route: 'change / bounded', drop: ['Executor rules'] }))[0]!.message, /Executor rules/);
  assert.deepEqual(codes('plan', plan({ route: 'change / bounded', drop: ['AC coverage'] })), ['plan-section-missing']);
  assert.match(checkText('plan', plan({ route: 'change / bounded', drop: ['AC coverage'] }))[0]!.message, /AC coverage/);
  assert.deepEqual(codes('plan', plan({ route: 'refactor / bounded', drop: ['AC coverage'] })), []);
});

test('on a story route every sub-unit says which ACs it covers; a route without a story does not need it', () => {
  const bare = '### Sub-unit 1 — thing · 🟡 Approved\n- **Review group:** —\n';
  const faults = checkText('plan', plan({ route: 'change / bounded', unit: bare }));
  assert.deepEqual(faults.map((f) => f.code), ['plan-subunit-covers']);
  assert.match(faults[0]!.message, /Sub-unit 1/);
  assert.deepEqual(codes('plan', plan({ route: 'refactor / bounded', unit: bare })), []);
});

test('a build spec that follows the contract has no faults, and a spec file is known by its name', () => {
  assert.deepEqual(checkText('build-spec', spec()), []);
  assert.deepEqual(checkText('build-spec', spec({ units: [1, 2, 3] })), []);
  assert.equal(kindOf('x/foo-build-spec.md'), 'build-spec');
  assert.equal(kindOf('x/reviews/foo-build-spec.md'), null);
});

test('a build spec names what is missing: the not-verified list, a sub-unit, a part, the code', () => {
  assert.deepEqual(codes('build-spec', spec({ notVerified: false })), ['spec-section-missing']);
  assert.deepEqual(codes('build-spec', '# T\n- **Contract:** 1\n\n## Not verified\nNone.\n'), ['spec-no-subunits']);
  const part = checkText('build-spec', spec({ drop: ['1:GREEN', '1:Interfaces'] }));
  assert.deepEqual(part.map((f) => f.code), ['spec-part-missing', 'spec-part-missing']);
  assert.match(part.map((f) => f.message).join('\n'), /Sub-unit 1[\s\S]*GREEN[\s\S]*Interfaces/);
  const code = checkText('build-spec', spec({ noCode: true }));
  assert.deepEqual(code.map((f) => f.code), ['spec-code-missing', 'spec-code-missing']);
  assert.match(code.map((f) => f.message).join('\n'), /Test[\s\S]*Implementation/);
});

test('RED and GREEN need their command and expected output; Lint needs its command', () => {
  const text = spec().replace('- **Expected output:** FAIL works\n', '').replace('### Lint\n- **Command:** `npm run lint`\n', '### Lint\nrun lint\n');
  const faults = checkText('build-spec', text);
  assert.deepEqual(faults.map((f) => f.code), ['spec-part-incomplete', 'spec-part-incomplete']);
  assert.match(faults.map((f) => f.message).join('\n'), /RED[\s\S]*Lint/);
});

test('a heading inside a code block of the spec is not a section', () => {
  const text = spec().replace('export const a = 1;', '## Sub-unit 9 — in code\n### GREEN\nexport const a = 1;');
  assert.deepEqual(checkText('build-spec', text), []);
});

test('the cross-file check: a story AC missing from the coverage table, a row with no test, a row for an unknown sub-unit', () => {
  const s = story('Approved — dev · 2026-10-27', '| AC-01 | a | request |\n| AC-02 | b | request |\n');
  const missing = crossCheck({ story: s, plan: plan(), spec: spec() });
  assert.deepEqual(missing.map((f) => f.code), ['cover-ac-missing']);
  assert.match(missing[0]!.message, /AC-02/);
  const noTest = crossCheck({ story: story(), plan: plan().replace('t.test.ts → works', ''), spec: spec() });
  assert.deepEqual(noTest.map((f) => f.code), ['cover-no-test']);
  const unknown = crossCheck({ story: story(), plan: plan().replace('| AC-01 | 1 |', '| AC-01 | 7 |'), spec: spec() });
  assert.deepEqual(unknown.map((f) => f.code), ['cover-unit-unknown']);
});

test('the cross-file check: a plan sub-unit with no spec section, and a spec section with no plan sub-unit', () => {
  const two = plan({ unit: '### Sub-unit 1 — a · 🟡 Approved\n- **Covers:** AC-01\n### Sub-unit 2 — b · 🟡 Approved\n- **Covers:** AC-01\n' });
  const noSpec = crossCheck({ story: story(), plan: two, spec: spec() });
  assert.deepEqual(noSpec.map((f) => f.code), ['cross-unit-no-spec']);
  assert.match(noSpec[0]!.message, /Sub-unit 2/);
  const noUnit = crossCheck({ story: story(), plan: plan(), spec: spec({ units: [1, 3] }) });
  assert.deepEqual(noUnit.map((f) => f.code), ['cross-spec-no-unit']);
  assert.match(noUnit[0]!.message, /Sub-unit 3/);
  assert.deepEqual(crossCheck({ story: story(), plan: plan(), spec: spec() }), []);
  assert.deepEqual(crossCheck({ story: null, plan: plan({ route: 'refactor / bounded' }), spec: spec() }), []); // no story: nothing to cover
});

// ---- review round 1 (SU10) ----
/** A one-sub-unit spec whose Test part holds `code` inside a fence of the given kind. */
function specWithTest(code: string, fence: string): string {
  return `# T\n- **Plan:** ./t.md\n- **Contract:** 1\n\n## Not verified\nNone.\n\n## Sub-unit 1 — x\n### Files\n| a | b | c |\n### Test\n${fence}ts\n${code}\n${fence}\n### RED\n- **Command:** \`c\`\n- **Expected output:** o\n### Implementation\n\`\`\`ts\nx\n\`\`\`\n### GREEN\n- **Command:** \`c\`\n- **Expected output:** o\n### Lint\n- **Command:** \`l\`\n### Interfaces\n| a | b |\n`;
}

test('a code fence is closed by a fence of the same kind and at least the same length: a 4-backtick block may hold a 3-backtick block, and a lone ``` line inside it', () => {
  assert.deepEqual(checkText('build-spec', specWithTest('const md = `\n```ts\nx\n```\n`;', '````')), []);
  assert.deepEqual(checkText('build-spec', specWithTest('```\n## Sub-unit 9 — in a string', '````')), []);
  assert.deepEqual(checkText('build-spec', specWithTest('test(1);', '~~~')), []);
  assert.deepEqual(checkText('build-spec', specWithTest('const s = "~~~";', '```')), []); // a tilde line inside a backtick block is code
});

test('the AC coverage table is read tolerantly: several ACs or a range in one row, AC-1 for AC-01, bold ids, "Sub-unit 1" or "1, 2" as the sub-unit', () => {
  const s = story('Approved — dev · 2026-10-27', '| AC-01 | a | r |\n| AC-02 | b | r |\n| AC-03 | c | r |\n| AC-04 | d | r |\n');
  const unit2 = '### Sub-unit 1 — a · 🟡 Approved\n- **Covers:** AC-01\n### Sub-unit 2 — b · 🟡 Approved\n- **Covers:** AC-03\n';
  const table = '| AC | Sub-unit | Test |\n|----|----------|------|\n| **AC-1**, AC-02 | Sub-unit 1 | a.test.ts → a |\n| AC-03 to AC-04 | 1, 2 | b.test.ts → b |\n';
  const text = plan({ unit: unit2 }).replace(/\| AC \| Sub-unit \| Test \|[\s\S]*?\| AC-01 \| 1 \| t\.test\.ts → works \|\n/, table);
  assert.deepEqual(crossCheck({ story: s, plan: text, spec: spec({ units: [1, 2] }) }), []);
});

test('the coverage faults say what shape the table has', () => {
  const missing = crossCheck({ story: story('Approved — dev · 2026-10-27', '| AC-01 | a | r |\n| AC-02 | b | r |\n'), plan: plan(), spec: spec() });
  assert.match(missing[0]!.message, /AC \| Sub-unit \| Test/);
});

test('the contract marker is a line of its own that starts "- **Contract:** 1": a mention in prose or inside a code block is not the marker', () => {
  assert.equal(hasContractMarker('# T\n- **Contract:** 1\n'), true);
  assert.equal(hasContractMarker('# T\nThe marker is `**Contract:** 1` (written by item new).\n'), false);
  assert.equal(hasContractMarker('# T\n```\n- **Contract:** 1\n```\n'), false);
  assert.equal(hasContractMarker('# T\n- **Contract:** 1\r\n'), true);
});

test('a sub-unit with no Covers line is named once each, even in a plan with many sub-units, and fast', () => {
  const many = Array.from({ length: 5000 }, (_, i) => `### Sub-unit ${i + 1} — u · 🟡 Approved\n- **Covers:** AC-01\n`).join('');
  const start = Date.now();
  assert.deepEqual(checkText('plan', plan({ unit: many })), []);
  assert.ok(Date.now() - start < 1500, `took ${Date.now() - start} ms`);
});
