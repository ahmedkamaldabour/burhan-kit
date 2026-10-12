#!/usr/bin/env node
// Hook latency, end to end through the Claude Code adapter: median and p90 per case, in ms.
//   node scripts/bench-hooks.mjs [--runtime bash|node] [--runs N]
// Not a test and not a CI gate: run it on one machine, for both runtimes, and compare (spec AC5).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { runtime: { type: 'string', default: 'bash' }, runs: { type: 'string', default: '20' } } });
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1) { console.error('bench: --runs needs a positive integer'); process.exit(2); }

const nodeEntry = join(root, 'dist/hooks/main.mjs');
let argv;
if (values.runtime === 'bash') argv = (check) => ['bash', [join(root, 'kit/hooks/adapters/claude/hook.sh'), check]];
else if (values.runtime === 'node') {
  if (!existsSync(nodeEntry)) { console.error(`bench: ${nodeEntry} not built yet (npm run build)`); process.exit(2); }
  argv = (check) => [process.execPath, [nodeEntry, 'claude', 'hook', check]];
} else { console.error('bench: --runtime is bash or node'); process.exit(2); }

const fx = join(root, 'tests/adapters/claude/fixtures');
const tmp = mkdtempSync(join(tmpdir(), 'burhan-bench-'));
const proj = join(tmp, 'p');
mkdirSync(join(proj, '.workflow/local'), { recursive: true });
writeFileSync(join(proj, '.workflow/workflow.config'),
  "WF_CODE_REGEX='\\.src$'\nWF_EVIDENCE_REGEX='verify-it'\nWF_CHECK_CMD=\"true\"\n");
writeFileSync(join(proj, '.workflow/local/PROGRESS.md'), '## Now\n### foo\n- **Route:** feature / bounded\n');
const steps = readFileSync(join(fx, 'steps.jsonl'), 'utf8');
writeFileSync(join(tmp, 'big.jsonl'), steps.repeat(300)); // 4,500 lines
const fixture = (f, patch = {}) => JSON.stringify({ ...JSON.parse(readFileSync(join(fx, f), 'utf8')), ...patch });

const cases = [
  ['session-gates', 'session-gates', fixture('p-session.json')],
  ['prompt-router', 'prompt-router', fixture('p-prompt.json')],
  ['post-edit-reminder', 'post-edit-reminder', fixture('p-post-edit.json')],
  ['pre-commit (not a commit)', 'pre-commit-check', fixture('p-pre-bash.json', { tool_input: { command: 'ls' } })],
  ['turn-audit (small)', 'turn-audit', fixture('p-stop.json', { transcript_path: join(fx, 'steps.jsonl') })],
  ['turn-audit (4,500 lines)', 'turn-audit', fixture('p-stop.json', { transcript_path: join(tmp, 'big.jsonl') })],
];
const env = { ...process.env, CLAUDE_PROJECT_DIR: proj, XDG_STATE_HOME: join(tmp, 'state') };
const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];

console.log(`runtime: ${values.runtime} · runs: ${runs} · node ${process.version} · ${process.platform}`);
try {
  for (const [label, check, input] of cases) {
    const [cmd, args] = argv(check);
    const ms = [];
    for (let i = 0; i < runs; i++) {
      const t0 = process.hrtime.bigint();
      const r = spawnSync(cmd, args, { input, env, encoding: 'utf8' });
      ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
      if (r.status !== 0) { console.error(`bench: ${label}: exit ${r.status}`); process.exit(1); }
    }
    ms.sort((a, b) => a - b);
    console.log(`${label.padEnd(28)} median ${pct(ms, 0.5).toFixed(0).padStart(4)} ms   p90 ${pct(ms, 0.9).toFixed(0).padStart(4)} ms`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
