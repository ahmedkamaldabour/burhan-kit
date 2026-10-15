import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Driver } from '../drivers.js';

type FixtureCase = { name: string; dir: string; expected?: string };
type Manifest = { cases: FixtureCase[] };

const fixtureRoot = new URL('../../../../test/hooks/fixtures/claude-subagents/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', fixtureRoot), 'utf8')) as Manifest;
const stopPayload = JSON.parse(readFileSync(new URL('../../../../tests/adapters/claude/fixtures/p-stop.json', import.meta.url), 'utf8')) as Record<string, unknown>;

export async function runCorpus(driver: Driver): Promise<void> {
  const failures: string[] = [];
  for (const fixture of manifest.cases) {
    try {
      assert.ok(typeof fixture.expected === 'string', `Fixture "${fixture.name}" has no expected golden.`);
      const directory = new URL(`${fixture.dir}/`, fixtureRoot);
      const transcript = fileURLToPath(new URL('transcript.jsonl', directory));
      const actual = await driver(['claude', 'normalize'], JSON.stringify({ ...stopPayload, transcript_path: transcript }), { CLAUDE_PROJECT_DIR: '/proj' });
      assert.equal(actual, fixture.expected, fixture.name);
    } catch (error) {
      failures.push(`${driver.label}: ${fixture.name}: ${error instanceof Error ? error.message.split('\n').slice(0, 6).join(' | ') : String(error)}`);
    }
  }
  assert.deepEqual(failures, [], `${failures.length} of ${manifest.cases.length} subagent cases differ:\n${failures.join('\n')}`);
}
