import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { jsonText, maskPath, tmpDir } from '../../helpers.js';
import type { Driver } from '../drivers.js';

interface EdgeCase { name: string; sub: 'normalize' | 'emit'; arg: string | null; stdin: string; transcript: string[] | null; expected: string }
const golden = JSON.parse(readFileSync(new URL('../../../../test/hooks/fixtures/claude-edge-golden.json', import.meta.url), 'utf8')) as { cases: EdgeCase[] };

export async function runCorpus(driver: Driver): Promise<void> {
  const failures: string[] = [];
  for (const c of golden.cases) {
    const dir = tmpDir('burhan-claude-edge-');
    let stdin = c.stdin.replaceAll('@DIR', jsonText(dir));
    if (c.transcript !== null) {
      const path = join(dir, 't.jsonl');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, c.transcript.join('\n') + '\n');
      if (c.sub === 'normalize' && !stdin.includes('"transcript_path"')) stdin = JSON.stringify({ ...JSON.parse(stdin), transcript_path: path });
    }
    const env = c.arg === 'noenv' ? {} : { CLAUDE_PROJECT_DIR: '/proj' };
    const argv = c.sub === 'normalize' ? ['claude', 'normalize'] : ['claude', 'emit', c.arg ?? ''];
    const actual = maskPath(await driver(argv, stdin, env), dir, '@DIR');
    if (actual !== c.expected) failures.push(`${driver.label}: ${c.name}\n   golden: ${JSON.stringify(c.expected).slice(0, 240)}\n   actual: ${JSON.stringify(actual).slice(0, 240)}`);
  }
  assert.deepEqual(failures, [], `${failures.length} of ${golden.cases.length} edge cases differ:\n${failures.join('\n')}`);
}
