import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ereToJs, evidenceRoot, projectKey, readLedger, summarizeLedger } from '../src/lib/evidence.js';
import { kitDir, nodeHooksDir } from '../src/lib/kit.js';
import { evidenceRoot as hookEvidenceRoot, projectKey as hookProjectKey } from '../src/hooks/core/store.mjs';
import { runCli } from '../src/main.js';
import { capture, tmpDir } from './helpers.js';

const tmp = (p: string) => tmpDir(p);

/** Runs the real Node turn-audit hook on an event (the hooks need no bash; their equality with the bash hooks is the
 *  differential's job), so the CLI is tested against what the hook writes. */
function runTurnAudit(event: string, evdir: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [join(nodeHooksDir(), 'main.mjs'), 'core', 'turn-audit'], { input: event, encoding: 'utf8', env: { ...process.env, WF_EVIDENCE_DIR: evdir } });
}

function audit(project: string, evdir: string, session: string, turn: string, steps: unknown[]): void {
  const ev = JSON.stringify({ event: 'turn_end', agent: 'claude', project_dir: project, session, turn_id: turn, prompt: '', command: '', file: '',
    turn: { files_created: [], files_edited: [], shell_commands: [], skills_used: [], assistant_text: '', steps }, reentrant: false });
  const r = runTurnAudit(ev, evdir);
  assert.equal(r.status, 0, String(r.stderr));
}

function project(): string {
  const p = tmp('burhan-ev-');
  mkdirSync(join(p, '.burhan/local'), { recursive: true });
  writeFileSync(join(p, '.burhan/workflow.config'), "WF_EVIDENCE_REGEX='^verify-it'\nWF_CODE_REGEX='\\.src$'\n");
  writeFileSync(join(p, '.burhan/local/PROGRESS.md'), '## Now\n### add-export\n');
  return p;
}

test('the project key matches the Node hooks\' own project key (not a re-implementation)', () => {
  const p = project();
  assert.equal(hookProjectKey(p).length, 16);
  assert.equal(projectKey(p), hookProjectKey(p));
});

const hasBash = spawnSync('bash', ['-c', 'exit 0']).status === 0;
// Git Bash computes the key from an MSYS path (/d/a/...), not the Windows path the Node hooks hash: only Unix compares them.
test('the project key matches the bash hooks\' wf_project_key', { skip: process.platform === 'win32' ? 'bash paths are MSYS paths on Windows' : hasBash ? false : 'bash is not available' }, () => {
  const p = project();
  const r = spawnSync('bash', ['-c', '. "$1/hooks/core/lib.sh"; WF_PROJECT="$2"; wf_project_key', '_', kitDir(), p], { encoding: 'utf8' });
  assert.equal(projectKey(p), r.stdout.trim());
});

test('stats reads POSIX classes in WF_EVIDENCE_REGEX the way the hook (grep -E) does', () => {
  const recs = [{ ts: 't', agent: 'a', session: 's', turn: 't', seq: 1, kind: 'cmd', cmd: 'npm  test', exit: 0, status: 'ok', item: 'x', project: '/p' }] as never;
  assert.equal(summarizeLedger(recs, '^npm[[:space:]]+test').evidenceRuns, 1);
  assert.equal(summarizeLedger(recs, '^npm[[:space:][:digit:]]+test').evidenceRuns, 1);
});

test('reads what the hook wrote: ordered, with exit codes and the item; summary counts evidence', () => {
  const p = project(); const ev = tmp('burhan-evd-');
  audit(p, ev, 'S1', 'T1', [{ kind: 'edit', file: join(p, 'a.src'), seq: 1 }, { kind: 'cmd', cmd: 'verify-it a', exit: 3, status: 'failed', seq: 2 }, { kind: 'cmd', cmd: 'verify-it a', exit: 0, status: 'ok', seq: 3 }]);
  audit(p, ev, 'S1', 'T2', [{ kind: 'cmd', cmd: 'ls', exit: 0, status: 'ok', seq: 1 }]);
  const recs = readLedger(p, { WF_EVIDENCE_DIR: ev });
  assert.deepEqual(recs.map((r) => [r.turn, r.seq, r.kind, r.exit ?? null]), [['T1', 1, 'edit', null], ['T1', 2, 'cmd', 3], ['T1', 3, 'cmd', 0], ['T2', 1, 'cmd', 0]]);
  assert.equal(recs[0].file, 'a.src');
  assert.equal(recs[1].item, 'add-export');
  assert.deepEqual(summarizeLedger(recs, '^verify-it'), { commands: 3, failed: 1, evidenceRuns: 2, evidencePassed: 1, itemsWithPassingEvidence: ['add-export'] });
});

test('CLI evidence: text, --item, --last, --json; a torn line is skipped', async () => {
  const p = project(); const ev = tmp('burhan-evd-');
  audit(p, ev, 'S1', 'T1', [{ kind: 'cmd', cmd: 'verify-it a', exit: 0, status: 'ok', seq: 1 },
    { kind: 'cmd', cmd: 'verify-it b', exit: 1, status: 'failed', seq: 2, by: 'burhan-builder' }]);
  writeFileSync(join(ev, projectKey(p), 'S1', 'T9.jsonl'), '{"broken\n');
  process.env.WF_EVIDENCE_DIR = ev;
  try {
    const a = capture();
    assert.equal(await runCli(['evidence', p], a.io), 0);
    assert.match(a.o.out, /S1\/T1 #1 {2}cmd {2}exit 0 {2}ok {2}verify-it a {2}\[add-export\]/);
    assert.match(a.o.out, /S1\/T1 #2 {2}cmd {2}exit 1 {2}failed {2}verify-it b {2}\(burhan-builder\) {2}\[add-export\]/, 'a subagent step names its subagent');
    const b = capture();
    assert.equal(await runCli(['evidence', p, '--item', 'other'], b.io), 0);
    assert.match(b.o.out, /no evidence recorded for item "other"/);
    const c = capture();
    assert.equal(await runCli(['evidence', p, '--json', '--last', '1'], c.io), 0);
    assert.equal(JSON.parse(c.o.out).length, 1);
    const d = capture();
    assert.equal(await runCli(['evidence', p, '--last', 'x'], d.io), 2);
  } finally { delete process.env.WF_EVIDENCE_DIR; }
});

test('CLI edge cases: --last 0, a subdirectory, an empty env var, the config value', async () => {
  const p = project(); const ev = tmp('burhan-evd-');
  audit(p, ev, 'S1', 'T1', [{ kind: 'cmd', cmd: 'verify-it a', exit: 0, status: 'ok', seq: 1 }]);
  process.env.WF_EVIDENCE_DIR = ev;
  try {
    const a = capture();
    assert.equal(await runCli(['evidence', p, '--json', '--last', '0'], a.io), 0);
    assert.deepEqual(JSON.parse(a.o.out), []);
    mkdirSync(join(p, 'src/deep'), { recursive: true });
    const b = capture(join(p, 'src/deep'));
    assert.equal(await runCli(['evidence'], b.io), 0);
    assert.match(b.o.out, /verify-it a/, 'run from a subdirectory finds the project root');
  } finally { delete process.env.WF_EVIDENCE_DIR; }
  assert.equal(evidenceRoot({ WF_EVIDENCE_DIR: '', XDG_STATE_HOME: '/x' }), '/x/burhan/evidence', 'empty means unset, like ${VAR:-…} in bash');
  assert.equal(evidenceRoot({ WF_EVIDENCE_DIR: '/env' }, '/conf'), '/conf', 'the config wins, as when bash sources it after the environment');
  assert.equal(evidenceRoot({ WF_EVIDENCE_DIR: 'relative', XDG_STATE_HOME: '/x' }), '/x/burhan/evidence', 'a relative value is ignored, like the hook');
  assert.equal(evidenceRoot({ WF_EVIDENCE_DIR: '/env', XDG_STATE_HOME: '/x' }, ''), '/x/burhan/evidence',
    'a config line WF_EVIDENCE_DIR="" overrides the environment with "unset", as when bash sources it');
  assert.ok(new RegExp(ereToJs('\\<node\\>')).test('run node now') && !new RegExp(ereToJs('\\<node\\>')).test('nodejs'), 'GNU word boundaries');
  assert.ok(new RegExp(ereToJs('^a{,2}$')).test('aa'), '{,n} means {0,n} in ERE');
  writeFileSync(join(p, '.burhan/workflow.config'), `WF_EVIDENCE_DIR='${ev}'\nWF_EVIDENCE_REGEX='^verify-it'\n`);
  const c = capture();
  assert.equal(await runCli(['evidence', p], c.io), 0);
  assert.match(c.o.out, /verify-it a/, 'WF_EVIDENCE_DIR from the config reaches the CLI as it reaches the hooks');
});

test('Codex parts of one turn read in order', () => {
  const p = project(); const ev = tmp('burhan-evd-');
  const run = (steps: unknown[], reentrant: boolean) => {
    const e = JSON.stringify({ event: 'turn_end', agent: 'codex', project_dir: p, session: 'S1', turn_id: 'T1', turn_scope: 'since_last_stop', reentrant,
      turn: { files_created: [], files_edited: [], shell_commands: [], skills_used: [], assistant_text: '', steps } });
    runTurnAudit(e, ev);
  };
  run([{ kind: 'cmd', cmd: 'verify-it a', exit: 1, status: 'failed', seq: 1 }], false);
  run([{ kind: 'cmd', cmd: 'verify-it a', exit: 0, status: 'ok', seq: 1 }], true);
  assert.deepEqual(readLedger(p, { WF_EVIDENCE_DIR: ev }).map((r) => [r.part, r.status]), [[1, 'failed'], [2, 'ok']]);
});

test('no ledger yet -> says so, exit 0', async () => {
  process.env.WF_EVIDENCE_DIR = tmp('burhan-evd-');
  try {
    const { o, io } = capture(project());
    assert.equal(await runCli(['evidence'], io), 0);
    assert.match(o.out, /no evidence recorded/);
  } finally { delete process.env.WF_EVIDENCE_DIR; }
});

test('the CLI and the hooks pick the same evidence root for every kind of override (an absolute path on any OS, a relative one, none)', () => {
  const tmpAbs = tmp('burhan-evroot-'); // absolute in this OS's own form: '/tmp/…' on Unix, 'C:\\…' on Windows
  for (const override of [tmpAbs, '/private/evidence', 'relative/dir', '', undefined]) {
    const env = { XDG_STATE_HOME: join(tmpAbs, 'state'), ...(override === undefined ? {} : { WF_EVIDENCE_DIR: override }) };
    assert.equal(evidenceRoot(env), hookEvidenceRoot(env), `override ${JSON.stringify(override)}`);
  }
  assert.equal(evidenceRoot({ WF_EVIDENCE_DIR: tmpAbs }), tmpAbs, 'an absolute override in the OS\'s own form is honoured');
});
