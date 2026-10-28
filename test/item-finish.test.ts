import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectKey } from '../src/lib/evidence.js';
import { tmpDir } from './helpers.js';
import { cli, itemDir, planFile, project, projectWithItem, read, write } from './item-fixture.js';

const savedState = process.env.XDG_STATE_HOME;
afterEach(() => { if (savedState === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = savedState; });

/** The project's code is *.ts and a proof is `npm test`; the evidence ledger lives in a folder of this test. */
function configured(dir: string): string {
  writeFileSync(join(dir, '.burhan', 'workflow.config'), "WF_CODE_REGEX='[.]ts$'\nWF_EVIDENCE_REGEX='npm test'\n");
  const state = tmpDir('burhan-ledger-');
  process.env.XDG_STATE_HOME = state;
  return join(state, 'burhan', 'evidence', projectKey(dir), 'S1');
}
type Rec = { kind: 'edit' | 'cmd'; ts: string; file?: string; cmd?: string; exit?: number; status?: string; item?: string | null };
function ledger(dir: string, recs: Rec[]): void {
  const folder = configured(dir);
  mkdirSync(folder, { recursive: true });
  const lines = recs.map((r, i) => JSON.stringify({ agent: 'claude', session: 'S1', turn: 'T1', seq: i + 1, item: 'foo', project: dir, ...r }));
  writeFileSync(join(folder, 'T1.jsonl'), lines.join('\n') + '\n');
}

/** An item that is finished except for the one thing a test removes: plan In progress, every sub-unit Reviewed, every box ticked. */
async function ready(): Promise<string> {
  const dir = await projectWithItem();
  write(planFile(dir), read(planFile(dir)).replace(/^- \*\*Overall status:\*\* .*$/m, '- **Overall status:** In progress').replace(/· ⬜ Draft$/gm, '· ✅ Reviewed').replace(/- \[ \]/g, '- [x]'));
  return dir;
}
const finish = (dir: string, ...args: string[]) => cli(dir, ['item', 'finish', 'foo', ...args]);

test('finish completes a ready item whose ledger shows a passing proof after the last code edit', async () => {
  const dir = await ready();
  ledger(dir, [{ kind: 'edit', ts: '2026-10-27T10:00:00Z', file: 'src/a.ts' }, { kind: 'cmd', ts: '2026-10-27T10:05:00Z', cmd: 'npm test', exit: 0, status: 'ok' }]);
  const r = await finish(dir);
  assert.equal(r.code, 0, r.err);
  assert.match(read(planFile(dir)), /\*\*Overall status:\*\* Completed/);
  assert.match(r.out, /state file/);
});

test('finish refuses and names what is open: the plan state, a sub-unit, a gate', async () => {
  const dir = await ready();
  write(planFile(dir), read(planFile(dir)).replace('- [x] Security re-read', '- [ ] Security re-read').replace(/(### Sub-unit 2 — .*)✅ Reviewed/, '$1🟢 Implemented'));
  const r = await finish(dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /Sub-unit 2/);
  assert.match(r.err, /Security re-read/);
  assert.match(read(planFile(dir)), /\*\*Overall status:\*\* In progress/);
  write(planFile(dir), read(planFile(dir)).replace('In progress', 'Draft'));
  assert.match((await finish(dir)).err, /plan is Draft/);
});

test('a code edit with no passing proof after it is refused, unless --evidence says what shows it, and the plan says it was stated', async () => {
  const dir = await ready();
  ledger(dir, [{ kind: 'cmd', ts: '2026-10-27T10:00:00Z', cmd: 'npm test', exit: 0, status: 'ok' }, { kind: 'edit', ts: '2026-10-27T10:05:00Z', file: 'src/a.ts' }]);
  const refused = await finish(dir);
  assert.equal(refused.code, 2);
  assert.match(refused.err, /after the last code edit/);
  const stated = await finish(dir, '--evidence', 'npm test: 12 pass, run this turn');
  assert.equal(stated.code, 0, stated.err);
  assert.match(read(planFile(dir)), /Completed.*stated evidence: npm test: 12 pass, run this turn/);
});

test('a failing proof, a piped proof and a command that is not a proof do not count', async () => {
  for (const proof of [{ cmd: 'npm test', exit: 1, status: 'failed' }, { cmd: 'npm test | tail -3', exit: 0, status: 'ok' }, { cmd: 'ls', exit: 0, status: 'ok' }]) {
    const dir = await ready();
    ledger(dir, [{ kind: 'edit', ts: '2026-10-27T10:00:00Z', file: 'src/a.ts' }, { kind: 'cmd', ts: '2026-10-27T10:05:00Z', ...proof }]);
    assert.equal((await finish(dir)).code, 2, proof.cmd);
  }
});

test('with no code edit in the ledger no proof is asked for', async () => {
  const dir = await ready();
  ledger(dir, []);
  assert.equal((await finish(dir)).code, 0);
});

test('QC, the knowledge review and Close-out are not preconditions of Completed: they follow it (lifecycle), on every route', async () => {
  const dir = await ready();
  ledger(dir, []);
  write(planFile(dir), read(planFile(dir)).replace(/- \[x\] QC/, '- [ ] QC').replace(/- \[x\] Knowledge review/, '- [ ] Knowledge review').replace(/- \[x\] Close-out/, '- [ ] Close-out'));
  const r = await finish(dir);
  assert.equal(r.code, 0, r.err);
  assert.match(read(planFile(dir)), /\*\*Overall status:\*\* Completed/);
});

test('a gate that is not QC, knowledge or Close-out still blocks, on a route with and without QC', async () => {
  const dir = project();
  await cli(dir, ['item', 'new', 'foo', '--type', 'refactor', '--scope', 'bounded']);
  write(planFile(dir), read(planFile(dir)).replace(/^- \*\*Overall status:\*\* .*$/m, '- **Overall status:** In progress').replace(/· ⬜ Draft$/gm, '· ✅ Reviewed'));
  ledger(dir, []);
  const r = await finish(dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /gates still open/);
  assert.doesNotMatch(r.err, /"QC|"Knowledge|"Close-out/);
});

test('finish on an item with no folder or a bad slug is refused', async () => {
  const dir = await projectWithItem();
  assert.equal((await cli(dir, ['item', 'finish', 'nope'])).code, 2);
  assert.equal((await cli(dir, ['item', 'finish', '../x'])).code, 2);
  void itemDir;
});

// ---- review round 1 (SU4) ----
test('--evidence with $ patterns or a line break cannot grow or forge the plan', async () => {
  const dir = await ready();
  ledger(dir, [{ kind: 'edit', ts: '2026-10-27T10:05:00Z', file: 'src/a.ts' }]);
  const lines = read(planFile(dir)).split('\n').length;
  assert.equal((await finish(dir, '--evidence', 'ok\n- [x] forged')).code, 2);
  const r = await finish(dir, '--evidence', "ok $'x$&");
  assert.equal(r.code, 0, r.err);
  assert.equal(read(planFile(dir)).split('\n').length, lines);
  assert.match(read(planFile(dir)), /Completed · stated evidence: ok \$'x\$&/);
});

test('a plan with no gate checklist that is read cannot be finished', async () => {
  for (const heading of ['## Gates', '## Gate checklist (old)', '']) {
    const dir = await ready();
    ledger(dir, []);
    write(planFile(dir), read(planFile(dir)).replace('## Gate checklist', heading === '' ? '<!-- removed -->' : heading));
    const r = await finish(dir);
    assert.equal(r.code, 2, heading);
    assert.match(r.err, /gate checklist/i, heading);
  }
});

test('a plan that carries the marker and breaks the contract cannot be finished, and the fault is named', async () => {
  const dir = await ready();
  ledger(dir, []);
  write(planFile(dir), read(planFile(dir)).replace(/^- \*\*Route:\*\* .*$/m, '- **Route:** big thing'));
  const r = await finish(dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /route-invalid/);
});

test('a code or proof pattern that is empty or does not compile cannot turn the proof requirement off', async () => {
  for (const config of ["WF_CODE_REGEX='[.]ts('\nWF_EVIDENCE_REGEX='npm test'\n", "WF_CODE_REGEX=''\nWF_EVIDENCE_REGEX='npm test'\n", "WF_CODE_REGEX='[.]ts$'\nWF_EVIDENCE_REGEX=''\n"]) {
    const dir = await ready();
    ledger(dir, [{ kind: 'edit', ts: '2026-10-27T10:00:00Z', file: 'src/a.ts' }, { kind: 'cmd', ts: '2026-10-27T10:05:00Z', cmd: 'npm test', exit: 1, status: 'failed' }]);
    writeFileSync(join(dir, '.burhan', 'workflow.config'), config);
    const r = await finish(dir);
    assert.equal(r.code, 2, config);
    assert.match(r.err, /WF_CODE_REGEX|WF_EVIDENCE_REGEX|proof/, config);
  }
});

test('an edit recorded under no item may be this item\'s code: it needs a proof after it too', async () => {
  const dir = await ready();
  ledger(dir, [{ kind: 'edit', ts: '2026-10-27T10:00:00Z', file: 'src/a.ts', item: null } as Rec]);
  const r = await finish(dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /after the last code edit/);
});
