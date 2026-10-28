import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemDir, cli, projectWithItem, planFile, read, setPlanStatus, unitLine, write } from './item-fixture.js';
import { join } from 'node:path';

const set = (dir: string, ...args: string[]) => cli(dir, ['item', 'set', 'foo', ...args]);

test('a sub-unit moves one rung at a time along the ladder', async () => {
  const dir = await projectWithItem();
  const r = await set(dir, 'unit', '1', 'approved');
  assert.equal(r.code, 0, r.err);
  assert.match(unitLine(dir, 1), /^### Sub-unit 1 — .* · 🟡 Approved$/);
  assert.match(unitLine(dir, 2), /· ⬜ Draft$/); // a neighbour is untouched
});

test('a skip is refused with the next rung named, and the plan is not changed', async () => {
  const dir = await projectWithItem();
  const before = read(planFile(dir));
  const r = await set(dir, 'unit', '1', 'implemented');
  assert.equal(r.code, 2);
  assert.match(r.err, /one step at a time.*Approved/);
  assert.equal(read(planFile(dir)), before);
});

test('a sub-unit cannot start before the plan is Approved, and starting the first one moves the plan to In progress', async () => {
  const dir = await projectWithItem();
  await set(dir, 'unit', '1', 'approved');
  const early = await set(dir, 'unit', '1', 'in-progress');
  assert.equal(early.code, 2);
  assert.match(early.err, /plan is Draft/);
  setPlanStatus(dir, 'Approved');
  const ok = await set(dir, 'unit', '1', 'in-progress');
  assert.equal(ok.code, 0, ok.err);
  assert.match(read(planFile(dir)), /\*\*Overall status:\*\* In progress/);
  assert.match(ok.out, /plan is now In progress/);
});

test('Reviewed needs a review section for that sub-unit', async () => {
  const dir = await projectWithItem();
  setPlanStatus(dir, 'In progress');
  for (const s of ['approved', 'in-progress', 'implemented']) assert.equal((await set(dir, 'unit', '1', s)).code, 0);
  const refused = await set(dir, 'unit', '1', 'reviewed');
  assert.equal(refused.code, 2);
  assert.match(refused.err, /review section/);
  write(join(itemDir(dir), 'reviews', 'foo-review.md'), '# R\n## Sub-unit 1\n- **Performed by:** Claude · Sonnet 5.5 · fresh subagent\n');
  assert.equal((await set(dir, 'unit', '1', 'reviewed')).code, 0);
  assert.match(unitLine(dir, 1), /· ✅ Reviewed$/);
});

test('a failed review sends a sub-unit back to In progress, and only there', async () => {
  const dir = await projectWithItem();
  setPlanStatus(dir, 'In progress');
  write(join(itemDir(dir), 'reviews', 'foo-review.md'), '# R\n## Sub-unit 1\n');
  for (const s of ['approved', 'in-progress', 'implemented', 'reviewed']) assert.equal((await set(dir, 'unit', '1', s)).code, 0, s);
  assert.equal((await set(dir, 'unit', '1', 'implemented')).code, 2);
  assert.equal((await set(dir, 'unit', '1', 'in-progress')).code, 0);
  assert.match(unitLine(dir, 1), /· 🔵 In progress$/);
});

test('the plan status: Approved is not set here, Completed needs every sub-unit Reviewed, In progress needs Approved first', async () => {
  const dir = await projectWithItem();
  const approve = await set(dir, 'plan', 'approved');
  assert.equal(approve.code, 2);
  assert.match(approve.err, /burhan approve plan/);
  assert.equal((await set(dir, 'plan', 'in-progress')).code, 2); // Draft -> In progress skips Approved
  setPlanStatus(dir, 'In progress');
  const done = await set(dir, 'plan', 'completed');
  assert.equal(done.code, 2);
  assert.match(done.err, /item finish/);
  assert.equal((await set(dir, 'plan', 'paused')).code, 0);
  assert.match(read(planFile(dir)), /\*\*Overall status:\*\* Paused/);
});

test('an unknown target, sub-unit number, status or item is refused with the reason', async () => {
  const dir = await projectWithItem();
  for (const [args, why] of [[['thing', 'x'], /plan or unit/], [['unit', '9', 'approved'], /no Sub-unit 9/], [['unit', '1', 'sideways'], /status/], [['unit', 'one', 'approved'], /number/]] as Array<[string[], RegExp]>) {
    const r = await set(dir, ...args);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.err, why, args.join(' '));
  }
  assert.equal((await cli(dir, ['item', 'set', 'nope', 'plan', 'paused'])).code, 2);
  assert.equal((await cli(dir, ['item', 'set', '../x', 'plan', 'paused'])).code, 2);
});

// ---- review round 1 (SU3) ----

test('a status word that is a property of Object is just an unknown status, never written', async () => {
  const dir = await projectWithItem();
  const before = read(planFile(dir));
  for (const args of [['plan', 'constructor'], ['plan', '__proto__'], ['plan', 'toString'], ['unit', '1', 'constructor'], ['unit', '1', '__proto__']]) {
    const r = await set(dir, ...args);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.err, /status/, args.join(' '));
    assert.equal(read(planFile(dir)), before, args.join(' '));
  }
});

test('a plan whose sub-unit headings are not read cannot be Completed', async () => {
  const dir = await projectWithItem();
  setPlanStatus(dir, 'In progress');
  write(planFile(dir), read(planFile(dir)).replace(/### Sub-unit/g, '### Subunit'));
  const r = await set(dir, 'plan', 'completed');
  assert.equal(r.code, 2);
  assert.match(r.err, /item finish/);
});

test('a Completed, Superseded or Paused plan does not move its sub-units, forward or back', async () => {
  for (const status of ['Completed', 'Superseded', 'Paused']) {
    const dir = await projectWithItem();
    setPlanStatus(dir, status);
    const forward = await set(dir, 'unit', '1', 'approved');
    assert.equal(forward.code, 2, status);
    assert.match(forward.err, new RegExp(`plan is ${status}`), status);
    write(planFile(dir), read(planFile(dir)).replace(/(### Sub-unit 1 — .*)⬜ Draft/, '$1✅ Reviewed'));
    const back = await set(dir, 'unit', '1', 'in-progress');
    assert.equal(back.code, 2, status);
    assert.match(unitLine(dir, 1), /✅ Reviewed$/, status);
  }
});

test('a plan with Windows line endings keeps them on the heading it changes', async () => {
  const dir = await projectWithItem();
  write(planFile(dir), read(planFile(dir)).replace(/\n/g, '\r\n'));
  assert.equal((await set(dir, 'unit', '1', 'approved')).code, 0);
  assert.equal(/(^|[^\r])\n/.test(read(planFile(dir))), false, 'a bare \\n in a CRLF plan');
  assert.match(read(planFile(dir)), /### Sub-unit 1 — .* · 🟡 Approved\r\n/);
});

test('a sub-unit heading shown inside a code fence is not a sub-unit', async () => {
  const dir = await projectWithItem();
  write(planFile(dir), read(planFile(dir)) + '\n```\n### Sub-unit 9 — example · ⬜ Draft\n```\n');
  const r = await set(dir, 'unit', '9', 'approved');
  assert.equal(r.code, 2);
  assert.match(r.err, /no Sub-unit 9/);
});
