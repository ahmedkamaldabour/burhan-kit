// The same corpora the Node tests use, run against the LIVE bash hooks. Every `expected` is a golden generated once from
// bash on Linux; passing here too means bash == golden on THIS platform (BSD awk/sed/grep on macOS, another jq), and the
// Node tests pass the same goldens — so Node == bash here. Needs bash and jq; skipped (with the reason) otherwise.
import { test } from 'node:test';
import { bashAvailable, bashDriver } from './drivers.js';
import { runCorpus as claudeAdapter } from './corpora/claude-adapter.js';
import { runCorpus as claudeEdge } from './corpora/claude-edge.js';
import { runCorpus as claudeSubagents } from './corpora/claude-subagents.js';
import { runCorpus as codexAdapter } from './corpora/codex-adapter.js';
import { runCorpus as ledger } from './corpora/ledger.js';
import { runCorpus as turnAudit } from './corpora/turn-audit.js';

const available = bashAvailable();
const options = { skip: available.ok ? false : available.reason, timeout: 600_000 };

for (const [name, runCorpus] of [
  ['claude adapter', claudeAdapter],
  ['claude edge', claudeEdge],
  ['claude subagents', claudeSubagents],
  ['codex adapter', codexAdapter],
  ['ledger', ledger],
  ['turn audit', turnAudit],
] as const) {
  test(`bash == golden: ${name}`, options, () => runCorpus(bashDriver));
}
