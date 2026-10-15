import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Driver } from '../drivers.js';

type NormalizeGolden = { name: string; payload: string; transcript?: string; expected: string };
type EmitGolden = { event: string; input: string; expected: string };

export const fixtureDir = fileURLToPath(new URL('../../../../tests/adapters/claude/fixtures/', import.meta.url));
const golden = <T,>(name: string): { cases: T[] } => JSON.parse(readFileSync(new URL(`../../../../test/hooks/fixtures/${name}`, import.meta.url), 'utf8')) as { cases: T[] };
export const payload = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(fixtureDir, name), 'utf8')) as Record<string, unknown>;

export async function runCorpus(driver: Driver): Promise<void> {
  for (const item of golden<NormalizeGolden>('claude-normalize-golden.json').cases) {
    const input = { ...payload(item.payload), transcript_path: item.transcript ? join(fixtureDir, item.transcript) : '/nonexistent' };
    assert.equal(await driver(['claude', 'normalize'], JSON.stringify(input), { CLAUDE_PROJECT_DIR: '/proj' }), item.expected, `${driver.label}: ${item.name}`);
  }

  for (const item of golden<EmitGolden>('claude-emit-golden.json').cases) {
    assert.equal(await driver(['claude', 'emit', item.event], item.input, {}), item.expected, `${driver.label}: ${item.event}: ${item.input}`);
  }
}
