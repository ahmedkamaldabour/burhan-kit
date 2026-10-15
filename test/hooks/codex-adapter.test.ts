import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpDir } from '../helpers.js';
import { run } from '../../src/hooks/main.mjs';

// The Codex adapter against the real bash adapter (kit/hooks/adapters/codex), case by case: `expected` is the exact
// stdout of normalize.sh / emit.sh, or — for `record` — the ledger files and modes `hook.sh record` wrote.
interface Case {
  name: string; sub: 'normalize' | 'emit' | 'record'; arg: string | null; stdin: string;
  ledger: string[] | null; rollout: string[] | null; session: string; turn: string;
  expected: string; files?: Record<string, string>; mode?: Record<string, string>;
}
const golden = JSON.parse(readFileSync(new URL('../../../test/hooks/fixtures/codex-golden.json', import.meta.url), 'utf8')) as { cases: Case[] };

const tree = (root: string, dir = root): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [relative(root, join(dir, e.name)), ...tree(root, join(dir, e.name))] : [relative(root, join(dir, e.name))]));

test('Codex adapter: every golden case equals the bash adapter', async () => {
  const failures: string[] = [];
  for (const c of golden.cases) {
    const tmp = tmpDir('burhan-codex-golden-');
    const ledger = join(tmp, 'ledger');
    mkdirSync(ledger, { recursive: true });
    let rollout: string | null = null;
    if (c.rollout !== null) { rollout = join(tmp, 'rollout.jsonl'); writeFileSync(rollout, c.rollout.map((l) => `${l}\n`).join('')); }
    const stdin = c.stdin.replaceAll('@DIR', tmp).replaceAll('@ROLLOUT', rollout ?? '/nonexistent');
    if (c.ledger !== null) {
      const file = join(ledger, c.session, `${c.turn}.jsonl`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, c.ledger.map((l) => `${l}\n`).join(''));
    }
    const env = { WF_CODEX_LEDGER_DIR: ledger };
    const argv = c.sub === 'normalize' ? ['codex', 'normalize'] : c.sub === 'emit' ? ['codex', 'emit', c.arg ?? ''] : ['codex', 'hook', 'record'];
    const actual = (await run(argv, stdin, env)).stdout.replaceAll(tmp, '@DIR');
    if (actual !== c.expected) failures.push(`${c.name}\n   bash: ${JSON.stringify(c.expected).slice(0, 260)}\n   node: ${JSON.stringify(actual).slice(0, 260)}`);
    if (c.sub === 'record') {
      const files: Record<string, string> = {};
      for (const entry of tree(ledger)) if (statSync(join(ledger, entry)).isFile()) files[entry] = readFileSync(join(ledger, entry), 'utf8');
      if (JSON.stringify(files) !== JSON.stringify(c.files)) failures.push(`${c.name}: ledger files\n   bash: ${JSON.stringify(c.files).slice(0, 260)}\n   node: ${JSON.stringify(files).slice(0, 260)}`);
      if (process.platform !== 'win32') {
        // Directories are 0700 in both. A ledger FILE is 0600 here; bash leaves it at the umask (0664 under 002): the one
        // deliberate difference — the port is stricter, the directory above it is private in both.
        const modes = Object.fromEntries(tree(ledger).map((entry) => [entry, '0o' + (statSync(join(ledger, entry)).mode & 0o777).toString(8)]));
        const wanted = Object.fromEntries(Object.entries(c.mode ?? {}).map(([entry, mode]) => [entry, entry.endsWith('.jsonl') ? '0o600' : mode]));
        if (JSON.stringify(modes) !== JSON.stringify(wanted)) failures.push(`${c.name}: modes\n   bash: ${JSON.stringify(c.mode)}\n   node: ${JSON.stringify(modes)}`);
      }
    }
  }
  assert.deepEqual(failures, [], `${failures.length} of ${golden.cases.length} golden cases differ:\n${failures.join('\n')}`);
});
