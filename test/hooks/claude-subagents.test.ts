import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { readRecords, turnFromRecords } from '../../src/hooks/adapters/claude/transcript.mjs';
import { withSubagentSteps } from '../../src/hooks/adapters/claude/subagents.mjs';
import { nodeDriver } from './drivers.js';
import { runCorpus } from './corpora/claude-subagents.js';

type FixtureCase = {
  name: string;
  dir: string;
  expected?: string;
};

type Manifest = {
  cases: FixtureCase[];
};

const fixtureRoot = new URL('../../../test/hooks/fixtures/claude-subagents/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', fixtureRoot), 'utf8')) as Manifest;

for (const fixture of manifest.cases) {
  test(`withSubagentSteps matches the bash golden: ${fixture.name}`, () => {
    assert.ok(
      typeof fixture.expected === 'string',
      `Fixture "${fixture.name}" has no expected golden. Fill manifest.json by running the bash Claude adapter for "${fixture.dir}".`,
    );

    const directory = new URL(`${fixture.dir}/`, fixtureRoot);
    const transcript = fileURLToPath(new URL('transcript.jsonl', directory));
    const subagents = fileURLToPath(new URL('transcript/subagents/', directory));
    const turn = withSubagentSteps(turnFromRecords(readRecords(transcript)), subagents);
    const expected = JSON.parse(fixture.expected) as { turn: Record<string, unknown> };

    assert.equal(
      turn.steps.some((step) => step.kind === 'agent'),
      false,
      `${fixture.name}: no Agent or Task placeholder may survive the splice`,
    );

    const { turn_key: _turnKey, ...actual } = turn;
    assert.deepStrictEqual(actual, expected.turn, fixture.name);
  });
}

test('the Claude normalize output of every subagent case matches the bash golden', () => runCorpus(nodeDriver));
