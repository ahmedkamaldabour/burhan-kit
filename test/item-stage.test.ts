import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageOf } from '../src/hooks/core/item-stage.mjs';
import { cli, planFile, project, projectWithItem, read, STATE, storyFile, write } from './item-fixture.js';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';

const FEATURE = 'feature / architectural';
const plan = (status: string, rungs: string[] = ['🟡 Approved'], route = FEATURE): string =>
  `# P\n- **Route:** ${route}\n- **Overall status:** ${status}\n\n## Gate checklist\n- [ ] Story approved\n\n## 4. Sub-unit breakdown\n${rungs.map((r, i) => `### Sub-unit ${i + 1} — u${i + 1} · ${r}\n`).join('')}`;
const story = (status: string): string => `# S\n- **Route:** ${FEATURE}\n- **Status:** ${status}\n\n| AC-01 | x | request |\n`;
const APPROVED = 'Approved — dev · 2026-10-27';
const qc = (verdict: string, accepted = false): string => `# Q\n- **Performed by:** Claude · Sonnet 5.5 · fresh subagent\n- **Verdict:** ${verdict}\n${accepted ? '- **Accepted by:** dev · 2026-10-27\n' : ''}`;
const at = (o: { route?: string; story?: string | null; plan?: string | null; findings?: string | null; qc?: string | null }) =>
  stageOf({ route: o.route ?? FEATURE, story: o.story ?? null, plan: o.plan ?? null, findings: o.findings ?? null, qc: o.qc ?? null });

test('nothing yet: make the item', () => {
  const s = at({});
  assert.equal(s.authorized, false);
  assert.match(s.next, /burhan item new/);
});

test('a Draft story waits for approval; an approved story with no plan needs the plan written', () => {
  assert.match(at({ story: story('Draft') }).next, /approve story/);
  const planless = at({ story: story(APPROVED) });
  assert.equal(planless.authorized, false);
  assert.match(planless.next, /plan/);
});

test('a Draft plan waits for approval, and code is not authorized', () => {
  const s = at({ story: story(APPROVED), plan: plan('Draft', ['⬜ Draft']) });
  assert.equal(s.authorized, false);
  assert.match(s.next, /approve plan/);
});

test('an approved plan authorizes code and names the first sub-unit to start', () => {
  const s = at({ story: story(APPROVED), plan: plan('Approved', ['🟡 Approved', '🟡 Approved']) });
  assert.equal(s.authorized, true);
  assert.match(s.next, /Sub-unit 1.*in-progress/);
});

test('the next step follows the rung of the first sub-unit that is not Reviewed', () => {
  const base = { story: story(APPROVED) };
  assert.match(at({ ...base, plan: plan('In progress', ['✅ Reviewed', '🔵 In progress']) }).next, /Sub-unit 2.*test first.*implemented/s);
  assert.match(at({ ...base, plan: plan('In progress', ['🟢 Implemented']) }).next, /review add.*reviewed/s);
  const done = at({ ...base, plan: plan('In progress', ['✅ Reviewed', '✅ Reviewed']) });
  assert.match(done.next, /item finish/);
  assert.equal(done.authorized, true);
});

test('a Completed plan: QC is next on a route with QC, then its acceptance; code is no longer authorized', () => {
  const base = { story: story(APPROVED), plan: plan('Completed', ['✅ Reviewed']) };
  const none = at(base);
  assert.equal(none.authorized, false);
  assert.match(none.next, /review add.*qc/s);
  assert.match(at({ ...base, qc: qc('PASS') }).next, /approve qc/);
  assert.match(at({ ...base, qc: qc('FAIL — 1 issue') }).next, /plan in-progress.*unit N in-progress/s);
  assert.match(at({ ...base, qc: qc('PASS', true) }).next, /close-out|state file/i);
});

test('a read-only route never authorizes code: an investigation and a bug spike', () => {
  for (const route of ['investigation / architectural', 'bug / spike']) {
    const s = at({ route, findings: `# F\n- **Status:** In progress\n- **Route:** ${route} · **Read-only:** yes\n` });
    assert.equal(s.authorized, false, route);
    assert.match(s.why, /read-only/i, route);
  }
});

test('a patch has no item to wait for: code is authorized', () => {
  const s = at({ route: 'change / patch' });
  assert.equal(s.authorized, true);
  assert.match(s.why, /patch/);
});

test('a route without a story goes straight to the plan', () => {
  const s = at({ route: 'refactor / bounded', plan: plan('Draft', ['⬜ Draft'], 'refactor / bounded') });
  assert.match(s.next, /approve plan/);
  assert.doesNotMatch(s.next, /story/);
});

test('a Paused or Superseded plan authorizes nothing', () => {
  for (const status of ['Paused', 'Superseded']) assert.equal(at({ story: story(APPROVED), plan: plan(status) }).authorized, false, status);
});

// ---- burhan guide ----
const guide = (dir: string, ...args: string[]) => cli(dir, ['guide', ...args]);

test('burhan guide prints the stage, whether code is authorized and the next step', async () => {
  const dir = await projectWithItem();
  const early = await guide(dir, 'foo');
  assert.equal(early.code, 0, early.err);
  assert.match(early.out, /guide: foo — feature \/ architectural/);
  assert.match(early.out, /code edits: NOT authorized/);
  assert.match(early.out, /next: .*approve story/);
  await cli(dir, ['approve', 'story', 'foo', '--by', 'dev-dabour']);
  await cli(dir, ['approve', 'plan', 'foo', '--by', 'dev-dabour']);
  const built = await guide(dir, 'foo');
  assert.match(built.out, /code edits: AUTHORIZED/);
});

test('burhan guide --json is machine-readable', async () => {
  const dir = await projectWithItem();
  const r = await guide(dir, 'foo', '--json');
  const j = JSON.parse(r.out) as { item: string; authorized: boolean; next: string };
  assert.equal(j.item, 'foo');
  assert.equal(j.authorized, false);
  assert.match(j.next, /approve story/);
});

test('burhan guide without a slug uses the only item in Now, and asks when there are none or several', async () => {
  const dir = await projectWithItem(); // item new put "### foo" in Now
  assert.match((await guide(dir)).out, /guide: foo/);
  write(join(dir, STATE), '## Now\n\n### foo\n- x\n\n### bar\n- y\n\n## Waiting on you\n');
  const two = await guide(dir);
  assert.equal(two.code, 2);
  assert.match(two.err, /foo, bar/);
  const empty = project();
  const none = await guide(empty);
  assert.equal(none.code, 2);
});

test('burhan guide on an unknown item, and on an item that is a read-only investigation', async () => {
  const dir = await projectWithItem();
  assert.equal((await guide(dir, 'nope')).code, 2);
  const r = project();
  await cli(r, ['item', 'new', 'inv', '--type', 'investigation', '--scope', 'bounded']);
  const out = await guide(r, 'inv');
  assert.match(out.out, /NOT authorized — .*read-only/i);
});

// ---- review round 1 (SU5) ----
test('a plan status that is not exactly one of the known ones authorizes nothing', () => {
  for (const status of ['draft', 'Draft (waiting)', 'Draft → Approved → In progress → Completed', 'Completed (all done)', 'Superseded by x', 'Paused until Monday', '', 'approved', 'In Progress']) {
    const s = at({ story: story(APPROVED), plan: plan(status, ['✅ Reviewed']) });
    assert.equal(s.authorized, false, JSON.stringify(status));
    assert.match(s.stage, /not recognised/, JSON.stringify(status));
    assert.match(s.next, /item check/, JSON.stringify(status));
  }
});

test('an Overall status line shown inside a code fence does not decide the status', () => {
  const text = plan('Draft', ['⬜ Draft']).replace('# P\n', '# P\n```\n- **Overall status:** Approved\n```\n');
  assert.equal(at({ story: story(APPROVED), plan: text }).authorized, false);
});

test('a route the matrix does not allow authorizes nothing', () => {
  for (const route of ['feature / spike', 'change / spike', 'refactor / spike', 'release / spike', 'investigation / patch', 'feature / patch', 'release / patch']) {
    const s = at({ route, story: story(APPROVED), plan: plan('Approved', ['🟡 Approved'], route) });
    assert.equal(s.authorized, false, route);
    assert.match(s.why, /not allowed/, route);
  }
  for (const route of ['change / patch', 'bug / patch', 'refactor / patch']) assert.equal(at({ route }).authorized, true, route);
});

// ---- a failed QC: reopen the plan ----
test('item set plan in-progress reopens a Completed plan only when the latest QC failed, and the sub-units can then go back', async () => {
  const dir = await projectWithItem();
  write(planFile(dir), read(planFile(dir)).replace(/^- \*\*Overall status:\*\* .*$/m, '- **Overall status:** Completed').replace(/· ⬜ Draft$/gm, '· ✅ Reviewed'));
  const none = await cli(dir, ['item', 'set', 'foo', 'plan', 'in-progress']);
  assert.equal(none.code, 2); // no QC report
  const by = 'Claude · Sonnet 5.5 · fresh subagent';
  await cli(dir, ['review', 'add', 'foo', '--kind', 'qc', '--by', by, '--verdict', 'PASS']);
  assert.equal((await cli(dir, ['item', 'set', 'foo', 'plan', 'in-progress'])).code, 2); // a PASS is not reopened here
  await cli(dir, ['review', 'add', 'foo', '--kind', 'qc', '--by', by, '--verdict', 'FAIL — 1 issue', '--round', '2']);
  const ok = await cli(dir, ['item', 'set', 'foo', 'plan', 'in-progress']);
  assert.equal(ok.code, 0, ok.err);
  assert.match(read(planFile(dir)), /\*\*Overall status:\*\* In progress/);
  assert.equal((await cli(dir, ['item', 'set', 'foo', 'unit', '1', 'in-progress'])).code, 0);
});

test('burhan guide shows the mode only from its own line, and a state file that is a folder is not a crash', async () => {
  const dir = await projectWithItem();
  write(storyFile(dir), read(storyFile(dir)).replace(/^- \*\*Mode:\*\* .*$/m, '- **Mode:** steps'));
  assert.doesNotMatch((await cli(dir, ['guide', 'foo'])).out, /mode step\)/);
  const bad = project();
  rmSync(join(bad, STATE));
  mkdirSync(join(bad, STATE));
  const r = await cli(bad, ['guide']);
  assert.equal(r.code, 2);
});
