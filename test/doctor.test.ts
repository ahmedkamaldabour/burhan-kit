import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runChecks, type Check, type Probe } from '../src/lib/doctor.js';
import { install } from '../src/lib/install.js';
import { readVersion } from '../src/lib/kit.js';
import { runCli } from '../src/main.js';
import { capture, tmpDir } from './helpers.js';

const home = tmpDir('burhan-doctor-home-');
const good: Probe = { bashMajor: () => 5, has: () => true, jqVersion: () => 'jq-1.8.1', claudeVersion: () => '2.1.296', home: () => home };
const probe = (o: Partial<Probe> = {}): Probe => ({ ...good, ...o });

function project(agents: ('claude' | 'codex')[] = ['claude']): string {
  const p = tmpDir('burhan-doctor-');
  install({ mode: 'init', target: p, agents, apply: true, bootstrap: false }, capture(p).io);
  return p;
}
const cfg = (p: string) => join(p, '.workflow/workflow.config');
const edit = (f: string, fn: (s: string) => string) => writeFileSync(f, fn(readFileSync(f, 'utf8')));
const find = (cs: Check[], status: Check['status'], text: string) => cs.find((c) => c.status === status && c.text.includes(text));
const bad = (cs: Check[]) => cs.filter((c) => c.status === 'fail' || c.status === 'warn').map((c) => `${c.status} ${c.text}`);

test('a fresh init is healthy: no fail, no warn', () => {
  const cs = runChecks(project(), probe());
  assert.deepEqual(bad(cs), []);
  for (const t of ['bash 5', 'jq', 'sha256', 'kit', 'workflow.config', '.claude/settings.json: all 5 hooks wired', 'burhan-reviewer', 'local/']) assert.ok(find(cs, 'ok', t), t);
  assert.ok(find(cs, 'skip', 'codex'), 'an agent init did not install is skipped');
});

test('legacy config keys are silently ignored in team and local config; upgrade preserves both verbatim', () => {
  const target = project();
  const legacy = "WF_FORBIDDEN_REGEX='^true'\nWF_FORBIDDEN_REASON='legacy reason'\nWF_SINGLE_TEST_HINT='legacy runner {{FILE}}'\n";
  edit(cfg(target), (text) => text + '# legacy settings stay untouched\n' + legacy);
  const local = join(target, '.workflow/local/workflow.config');
  mkdirSync(join(target, '.workflow/local'), { recursive: true });
  writeFileSync(local, '# personal settings\n' + legacy.replace('legacy reason', 'local reason'));
  const before = readFileSync(cfg(target), 'utf8');
  const localBefore = readFileSync(local, 'utf8');
  assert.deepEqual(bad(runChecks(target, probe())), []);
  assert.equal(readFileSync(cfg(target), 'utf8'), before);
  assert.equal(readFileSync(local, 'utf8'), localBefore);
  install({ mode: 'upgrade', target, agents: null, apply: true, bootstrap: false }, capture(target).io);
  assert.equal(readFileSync(cfg(target), 'utf8'), before);
  assert.equal(readFileSync(local, 'utf8'), localBefore);
  assert.deepEqual(bad(runChecks(target, probe())), []);
  writeFileSync(local, localBefore + 'WF_FORBIDDEN_REGX=typo\nWF_SINGLE_TEST_HNT=typo\n');
  const warning = find(runChecks(target, probe()), 'warn', 'unknown config keys');
  assert.ok(warning?.text.includes('WF_FORBIDDEN_REGX'));
  assert.ok(warning?.text.includes('WF_SINGLE_TEST_HNT'));
  for (const key of ['WF_FORBIDDEN_REGEX', 'WF_FORBIDDEN_REASON', 'WF_SINGLE_TEST_HINT']) assert.ok(!warning?.text.includes(key), key);
});

test('runtime: bash 3 and a missing jq or sha256 tool fail, with the fix', () => {
  const p = project();
  assert.ok(find(runChecks(p, probe({ bashMajor: () => 3 })), 'fail', 'brew install bash'));
  assert.ok(find(runChecks(p, probe({ bashMajor: () => null })), 'fail', 'bash'));
  assert.ok(find(runChecks(p, probe({ has: (c) => c !== 'jq' })), 'fail', 'jq'));
  assert.ok(find(runChecks(p, probe({ has: (c) => c !== 'sha256sum' && c !== 'shasum' })), 'fail', 'sha256'));
  assert.ok(!find(runChecks(p, probe({ has: (c) => c !== 'sha256sum' })), 'fail', 'sha256'), 'shasum alone is enough');
  const t = find(runChecks(p, probe({ has: (c) => c !== 'timeout' && c !== 'gtimeout' })), 'warn', 'timeout');
  assert.ok(t && t.text.includes('coreutils'), 'no timeout utility → the pre-commit check cannot run');
  assert.ok(!find(runChecks(p, probe({ has: (c) => c !== 'timeout' })), 'warn', 'timeout'), 'gtimeout alone is enough');
});

test('runtime: jq below the minimum the hooks are tested on fails; an unreadable version warns', () => {
  const p = project();
  for (const v of ['jq-1.6', 'jq-1.7.1', 'jq-1.8.1', 'jq-1.7', 'jq-1.6-dirty', 'jq-1.6-159-gcff5336']) {
    const c = runChecks(p, probe({ jqVersion: () => v }));
    assert.ok(find(c, 'ok', 'jq'), `${v} is supported`);
    assert.ok(!find(c, 'fail', 'jq') && !find(c, 'warn', 'jq'), v);
  }
  for (const v of ['jq-1.5', 'jq-1.4', 'jq-1.5rc2']) {
    const f = find(runChecks(p, probe({ jqVersion: () => v })), 'fail', 'jq');
    assert.ok(f && f.text.includes('1.6'), `${v}: names the minimum`);
  }
  assert.ok(find(runChecks(p, probe({ jqVersion: () => 'jq-master' })), 'warn', 'jq'), 'unparseable → warn, never a guess');
  assert.ok(find(runChecks(p, probe({ jqVersion: () => null })), 'warn', 'jq'));
  assert.ok(find(runChecks(p, probe({ has: (c) => c !== 'jq', jqVersion: () => null })), 'fail', 'jq'), 'missing jq still fails');
});

test('install: not installed fails; an older kit stamp says run upgrade', () => {
  const empty = tmpDir('burhan-doctor-empty-');
  assert.ok(find(runChecks(empty, probe()), 'fail', 'burhan init'));
  const p = project();
  writeFileSync(join(p, '.workflow/VERSION'), '0.0.9\n');
  const c = find(runChecks(p, probe()), 'warn', '0.0.9');
  assert.ok(c && c.text.includes('burhan upgrade --apply') && c.text.includes(readVersion()), c?.text);
});

test('install: kit files that differ from this CLI\'s kit (same version, edited or another build) warn', () => {
  const p = project();
  assert.ok(find(runChecks(p, probe()), 'ok', 'kit files match'));
  writeFileSync(join(p, '.workflow/hooks/core/turn-audit.sh'), '# edited\n');
  const c = find(runChecks(p, probe()), 'warn', 'hooks/core/turn-audit.sh');
  assert.ok(c && c.text.includes('burhan upgrade --apply'), c?.text);
});

test('config: missing keys (vs the shipped example), unknown keys, unreadable lines, a non-absolute evidence dir', () => {
  const p = project();
  edit(cfg(p), (s) => s.replace(/^WF_REVIEWER_AGENT=.*\n/m, '').replace(/^WF_EVIDENCE_LEDGER=.*\n/m, ''));
  const missing = find(runChecks(p, probe()), 'warn', 'missing');
  assert.ok(missing && missing.text.includes('WF_REVIEWER_AGENT') && missing.text.includes('WF_EVIDENCE_LEDGER'), missing?.text);
  edit(cfg(p), (s) => s + 'WF_REVIEWR_AGENT=codex\n');
  assert.ok(find(runChecks(p, probe()), 'warn', 'WF_REVIEWR_AGENT'), 'a typo key is reported');
  edit(cfg(p), (s) => s + 'WF_CHECK_CMD=$(make check)\n');
  assert.ok(find(runChecks(p, probe()), 'warn', 'workflow.config:'), 'a line the hooks cannot read is reported with its line');
  for (const v of ['"ledger"', "'~/ledger'", '""']) {
    const q = project();
    edit(cfg(q), (s) => s.replace(/^WF_EVIDENCE_DIR=.*$/m, `WF_EVIDENCE_DIR=${v}`));
    const w = find(runChecks(q, probe()), 'warn', 'WF_EVIDENCE_DIR');
    assert.equal(Boolean(w), v !== '""', `WF_EVIDENCE_DIR=${v}`);
  }
  const crlf = project();
  edit(cfg(crlf), (s) => s.replace(/\n/g, '\r\n'));
  const crlfWarn = runChecks(crlf, probe()).filter((c) => c.text.includes('CRLF'));
  assert.equal(crlfWarn.length, 1, 'CRLF is reported once per file');
  const l = project();
  mkdirSync(join(l, '.workflow/local'), { recursive: true });
  writeFileSync(join(l, '.workflow/local/workflow.config'), 'WF_EVIDENCE_DIR="rel"\n');
  assert.ok(find(runChecks(l, probe()), 'warn', 'WF_EVIDENCE_DIR'), 'the local override is read too');
});

test('config: a sensitive regex without its note warns (AC-19)', () => {
  const p = project();
  edit(cfg(p), (s) => s.replace(/^WF_SENSITIVE_REGEX=.*$/m, "WF_SENSITIVE_REGEX='^src/auth(/|$)'").replace(/^WF_SENSITIVE_NOTE=.*$/m, "WF_SENSITIVE_NOTE=''"));
  const warning = find(runChecks(p, probe()), 'warn', 'WF_SENSITIVE_NOTE');
  assert.ok(warning && warning.text.includes('WF_SENSITIVE_REGEX'), warning?.text);
});

test('claude: an unwired hook fails; missing commands or reviewer fail; an old claude warns only with the verify skill', () => {
  const p = project();
  const sf = join(p, '.claude/settings.json');
  const s = JSON.parse(readFileSync(sf, 'utf8')) as { hooks: Record<string, unknown> };
  delete s.hooks.Stop;
  writeFileSync(sf, JSON.stringify(s));
  const c = find(runChecks(p, probe()), 'fail', 'Stop');
  assert.ok(c && c.text.includes('turn-audit'), c?.text);
  writeFileSync(sf, '{ not json');
  assert.ok(find(runChecks(p, probe()), 'fail', 'settings.json'));
  for (const odd of ['{"hooks":{"Stop":"x","SessionStart":[null]}}', '{"hooks":{"Stop":[{"hooks":"x"}]}}', '{"hooks":[1]}', '[]']) {
    writeFileSync(sf, odd);
    assert.ok(find(runChecks(p, probe()), 'fail', 'settings.json'), `odd but valid JSON is reported, never a crash: ${odd}`);
  }

  const q = project();
  writeFileSync(join(q, '.claude/commands/burhan/qc.md'), 'x');
  writeFileSync(join(q, '.claude/agents/burhan-reviewer.md'), 'mine');
  const cs = runChecks(q, probe());
  assert.ok(find(cs, 'warn', 'qc.md'), 'a command not managed by burhan is reported');
  assert.ok(find(cs, 'warn', 'burhan-reviewer'), 'a reviewer not managed by burhan is reported');

  assert.ok(!find(runChecks(project(), probe({ claudeVersion: () => '2.1.200' })), 'warn', 'verify'), 'no verify skill → no version warning');
  const v = project();
  edit(cfg(v), (s2) => s2.replace(/^WF_CHECK_CMD=.*$/m, 'WF_CHECK_CMD="npm test"'));
  install({ mode: 'upgrade', target: v, agents: null, apply: true, bootstrap: false }, capture(v).io);
  assert.ok(find(runChecks(v, probe({ claudeVersion: () => '2.1.200' })), 'warn', '2.1.286'));
  assert.ok(!find(runChecks(v, probe({ claudeVersion: () => '2.1.296' })), 'warn', '2.1.286'));
  assert.ok(find(runChecks(v, probe({ claudeVersion: () => null })), 'skip', 'claude'), 'no claude CLI → skip, not fail');
});

test('codex: wiring checked; hook trust is read only, and an unreadable config is skipped', () => {
  const p = project(['codex']);
  assert.ok(find(runChecks(p, probe()), 'ok', '.codex/hooks.json: all 5 hooks wired'));
  const hf = join(p, '.codex/hooks.json');
  const j = JSON.parse(readFileSync(hf, 'utf8')) as { hooks: Record<string, unknown> };
  delete j.hooks.PreToolUse;
  writeFileSync(hf, JSON.stringify(j));
  assert.ok(find(runChecks(p, probe()), 'fail', 'PreToolUse (pre-commit-check)'));
  install({ mode: 'upgrade', target: p, agents: null, apply: true, bootstrap: false }, capture(p).io);
  assert.ok(find(runChecks(p, probe()), 'skip', 'trust'), 'no ~/.codex/config.toml → skip');
  const h = tmpDir('burhan-doctor-h-');
  mkdirSync(join(h, '.codex'));
  writeFileSync(join(h, '.codex/config.toml'), '[hooks.state."elsewhere/.codex/hooks.json:stop:0:0"]\ntrusted_hash = "x"\n');
  assert.ok(find(runChecks(p, probe({ home: () => h })), 'warn', 'trust'));
  const entry = (e: string) => `[hooks.state."${p}/.codex/hooks.json:${e}:0:0"]\ntrusted_hash = "x"\n`;
  writeFileSync(join(h, '.codex/config.toml'), entry('stop'));
  const part = find(runChecks(p, probe({ home: () => h })), 'warn', 'trust');
  assert.ok(part && part.text.includes('SessionStart') && !part.text.includes('Stop'), part?.text);
  for (const step of ['Hooks need review', 'Review hooks', '/hooks', 'press t', 'Project config', '#codex-trust-the-hooks', 'Trusted in Codex'])
    assert.ok(part!.text.includes(step), `the warning says how to trust: ${step}`);
  writeFileSync(join(h, '.codex/config.toml'), ['session_start', 'user_prompt_submit', 'pre_tool_use', 'post_tool_use', 'stop'].map(entry).join(''));
  assert.ok(find(runChecks(p, probe({ home: () => h })), 'ok', 'trust'));
});

test('codex trust: the key is matched under the project path as given and as resolved (a symlinked dir; macOS /var → /private/var)', () => {
  const real = project(['codex']);
  const parent = tmpDir('burhan-doctor-l-');
  const link = join(parent, 'proj');
  symlinkSync(real, link);
  const resolved = realpathSync(real);
  const h = tmpDir('burhan-doctor-h-');
  mkdirSync(join(h, '.codex'));
  const events = ['session_start', 'user_prompt_submit', 'pre_tool_use', 'post_tool_use', 'stop'];
  const entries = (dir: string) => events.map((e) => `[hooks.state."${dir}/.codex/hooks.json:${e}:0:0"]\ntrusted_hash = "x"\n`).join('');
  for (const [keyDir, asked, why] of [[link, link, 'trusted through the symlink, checked through it'],
    [resolved, link, 'trusted at the real path, checked through the symlink'],
    [link, resolved, 'trusted through the symlink, checked at the real path'],
    [real, real, 'mkdtemp path as written (macOS: /var/…, resolved /private/var/…)']] as const) {
    writeFileSync(join(h, '.codex/config.toml'), entries(keyDir));
    assert.ok(find(runChecks(asked, probe({ home: () => h })), 'ok', 'trust'), why);
  }
  writeFileSync(join(h, '.codex/config.toml'), entries(join(parent, 'other')));
  assert.ok(find(runChecks(link, probe({ home: () => h })), 'warn', 'trust'), 'another project\'s entries never count');
});

test('unreadable files are reported, never a crash', { skip: process.getuid?.() === 0 }, () => {
  for (const f of ['.workflow/workflow.config', '.workflow/VERSION', '.workflow/.gitignore', '.workflow/WORKFLOW.md']) {
    const p = project();
    chmodSync(join(p, f), 0o000);
    const c = runChecks(p, probe()).find((x) => x.text.includes('unreadable'));
    assert.ok(c && c.status !== 'ok' && c.text.includes(f), `${f}: ${c?.text}`);
  }
  const q = project();
  mkdirSync(join(q, '.workflow/local'), { recursive: true });
  writeFileSync(join(q, '.workflow/local/PROGRESS.md'), 'x\n');
  chmodSync(join(q, '.workflow/local/PROGRESS.md'), 0o000);
  assert.ok(find(runChecks(q, probe()), 'warn', 'unreadable'));
});

test('state: local/ not git-ignored and a state file over budget warn', () => {
  const p = project();
  writeFileSync(join(p, '.workflow/.gitignore'), '# nothing\n');
  assert.ok(find(runChecks(p, probe()), 'warn', 'local/'));
  const q = project();
  mkdirSync(join(q, '.workflow/local'), { recursive: true });
  writeFileSync(join(q, '.workflow/local/PROGRESS.md'), 'x\n'.repeat(81));
  assert.ok(find(runChecks(q, probe()), 'warn', '81 lines'));
});

test('CLI: doctor never writes, prints one line per check, exit 1 only on fail', async () => {
  const p = project();
  const snap = (d: string): string[] => readdirSync(d, { recursive: true }).map(String).sort()
    .map((f) => `${f}:${statSync(join(d, f)).mtimeMs}`);
  const before = snap(p);
  const { o, io } = capture(p);
  const rc = await runCli(['doctor'], io);
  assert.deepEqual(snap(p), before, 'nothing written');
  assert.match(o.out, /^ok +/m);
  assert.equal(rc, /^fail /m.test(o.out) ? 1 : 0, 'exit 1 exactly when a check fails');
  const empty = tmpDir('burhan-doctor-empty-');
  const e = capture(empty);
  assert.equal(await runCli(['doctor', empty], e.io), 1);
  assert.match(e.o.out, /^fail +/m);
});
