#!/usr/bin/env node
// Hook latency, end to end through an agent adapter (Claude Code or Codex): median and p90 per case, in ms.
//   node scripts/bench-hooks.mjs [--runtime bash|node] [--adapter claude|codex] [--runs N] [--json]
// Not a test and not a CI gate: run it on one machine, for both runtimes, and compare (spec AC5).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { runtime: { type: 'string', default: 'bash' }, adapter: { type: 'string', default: 'claude' }, runs: { type: 'string', default: '20' }, json: { type: 'boolean', default: false } } });
if (values.adapter !== 'claude' && values.adapter !== 'codex') { console.error('bench: --adapter is claude or codex'); process.exit(2); }
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1) { console.error('bench: --runs needs a positive integer'); process.exit(2); }

const nodeEntry = join(root, 'dist/hooks/main.mjs');
let argv;
if (values.runtime === 'bash') argv = (check) => ['bash', [join(root, `kit/hooks/adapters/${values.adapter}/hook.sh`), check]];
else if (values.runtime === 'node') {
  if (!existsSync(nodeEntry)) { console.error(`bench: ${nodeEntry} not built yet (npm run build)`); process.exit(2); }
  argv = (check) => [process.execPath, [nodeEntry, values.adapter, 'hook', check]];
} else { console.error('bench: --runtime is bash or node'); process.exit(2); }

const fx = join(root, 'tests/adapters/claude/fixtures');
const tmp = mkdtempSync(join(tmpdir(), 'burhan-bench-'));
const proj = join(tmp, 'p');
mkdirSync(join(proj, '.burhan/local'), { recursive: true });
writeFileSync(join(proj, '.burhan/workflow.config'),
  "WF_CODE_REGEX='\\.src$'\nWF_EVIDENCE_REGEX='verify-it'\nWF_CHECK_CMD=\"true\"\n");
writeFileSync(join(proj, '.burhan/local/PROGRESS.md'), '## Now\n### foo\n- **Route:** feature / bounded\n');
const steps = readFileSync(join(fx, 'steps.jsonl'), 'utf8');
writeFileSync(join(tmp, 'big.jsonl'), steps.repeat(300)); // 4,500 lines
const fixture = (f, patch = {}) => JSON.stringify({ ...JSON.parse(readFileSync(join(fx, f), 'utf8')), ...patch });

const cx = join(root, 'tests/adapters/codex/fixtures');
const cxFixture = (f, patch = {}) => JSON.stringify({ ...JSON.parse(readFileSync(join(cx, f), 'utf8')), cwd: proj, ...patch });
const ledgerDir = join(tmp, 'codex-ledger');
// A Codex Stop consumes the turn ledger, so every run gets a fresh one (outside the timing): 60 calls, as a long turn.
const refillLedger = () => {
  mkdirSync(join(ledgerDir, 'S1'), { recursive: true });
  const lines = [];
  for (let i = 0; i < 59; i++) lines.push(JSON.stringify({ tool_name: 'Bash', tool_input: { command: `echo ${i}` }, tool_use_id: `c${i}`, patch_exit: null }));
  lines.push(JSON.stringify({ tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Add File: a.src\n+x\n*** End Patch\n' }, tool_use_id: 'p1', patch_exit: 0 }));
  writeFileSync(join(ledgerDir, 'S1', 'U1.jsonl'), lines.join('\n') + '\n');
};
const codexCases = [
  ['session-gates', 'session-gates', cxFixture('p-session.json')],
  ['prompt-router', 'prompt-router', cxFixture('p-prompt.json')],
  ['post-edit-reminder (patch)', 'post-edit-reminder', cxFixture('p-post-patch-multi.json')],
  ['pre-commit (not a commit)', 'pre-commit-check', cxFixture('p-pre-bash.json', { tool_input: { command: 'ls' } })],
  ['turn-audit (Stop, 60 calls)', 'turn-audit', cxFixture('p-stop.json'), refillLedger],
];
const claudeCases = [
  ['session-gates', 'session-gates', fixture('p-session.json')],
  ['prompt-router', 'prompt-router', fixture('p-prompt.json')],
  ['post-edit-reminder', 'post-edit-reminder', fixture('p-post-edit.json')],
  ['pre-commit (not a commit)', 'pre-commit-check', fixture('p-pre-bash.json', { tool_input: { command: 'ls' } })],
  ['turn-audit (small)', 'turn-audit', fixture('p-stop.json', { transcript_path: join(fx, 'steps.jsonl') })],
  ['turn-audit (4,500 lines)', 'turn-audit', fixture('p-stop.json', { transcript_path: join(tmp, 'big.jsonl') })],
];
const cases = values.adapter === 'codex' ? codexCases : claudeCases;
const env = { ...process.env, CLAUDE_PROJECT_DIR: proj, WF_CODEX_LEDGER_DIR: ledgerDir, WF_PROJECT_ROOT: proj, XDG_STATE_HOME: join(tmp, 'state') };
const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];

const results = [];
if (!values.json) console.log(`runtime: ${values.runtime} · adapter: ${values.adapter} · runs: ${runs} · node ${process.version} · ${process.platform}`);
try {
  for (const [label, check, input, prepare] of cases) {
    const [cmd, args] = argv(check);
    const ms = [];
    let failed = false;
    for (let i = 0; i < runs && !failed; i++) {
      prepare?.();
      const t0 = process.hrtime.bigint();
      const r = spawnSync(cmd, args, { input, env, encoding: 'utf8' });
      ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
      if (r.status !== 0) { console.error(`bench: ${label}: exit ${r.status}`); failed = true; }
    }
    if (failed) { process.exitCode = 1; break; }
    ms.sort((a, b) => a - b);
    results.push({ label, median: pct(ms, 0.5), p90: pct(ms, 0.9) });
    if (!values.json) console.log(`${label.padEnd(28)} median ${pct(ms, 0.5).toFixed(0).padStart(4)} ms   p90 ${pct(ms, 0.9).toFixed(0).padStart(4)} ms`);
  }
  if (values.json && process.exitCode !== 1) console.log(JSON.stringify(results));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
