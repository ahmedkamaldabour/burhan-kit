#!/usr/bin/env node
// Node hooks against the bash hooks, case by case: median and p90 per runtime and the ratio.
//   node scripts/bench-compare.mjs [--adapter claude|codex|all] [--runs N] [--gate] [--margin 1.0]
// --gate exits 1 when any case's Node median is greater than margin × the bash median (spec AC5).
// Not a CI test: timings on a shared runner are noisy. Run it on a quiet machine, build first (npm run build).
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { adapter: { type: 'string', default: 'all' }, runs: { type: 'string', default: '20' }, gate: { type: 'boolean', default: false }, margin: { type: 'string', default: '1' } } });
const margin = Number(values.margin);
if (!(margin > 0)) { console.error('bench-compare: --margin needs a positive number'); process.exit(2); }
const adapters = values.adapter === 'all' ? ['claude', 'codex'] : [values.adapter];

const bench = (runtime, adapter) => {
  const r = spawnSync(process.execPath, [join(here, 'bench-hooks.mjs'), '--runtime', runtime, '--adapter', adapter, '--runs', values.runs, '--json'], { encoding: 'utf8', maxBuffer: 1 << 24 });
  if (r.status !== 0) { console.error(r.stderr || r.stdout); process.exit(r.status ?? 1); }
  return JSON.parse(r.stdout);
};

let slower = 0;
console.log(`runs: ${values.runs} · node ${process.version} · ${process.platform}${values.gate ? ` · gate: node ≤ ${margin}× bash` : ''}`);
for (const adapter of adapters) {
  const bash = bench('bash', adapter);
  const node = bench('node', adapter);
  console.log(`\n${adapter} adapter — hook end to end`);
  console.log(`${'case'.padEnd(30)}${'bash ms'.padStart(10)}${'node ms'.padStart(10)}${'ratio'.padStart(8)}   p90 bash/node`);
  bash.forEach((b, i) => {
    const n = node[i];
    const ratio = n.median / b.median;
    const bad = n.median > b.median * margin;
    if (bad) slower++;
    console.log(`${b.label.padEnd(30)}${b.median.toFixed(0).padStart(10)}${n.median.toFixed(0).padStart(10)}${ratio.toFixed(2).padStart(8)}${bad ? '  SLOWER' : ''}   ${b.p90.toFixed(0)}/${n.p90.toFixed(0)}`);
  });
}
if (values.gate && slower > 0) { console.error(`\nbench-compare: ${slower} case(s) slower on Node than on bash`); process.exit(1); }
