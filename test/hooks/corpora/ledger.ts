import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseEvent } from '../../../src/hooks/core/lib.mjs';
import { projectKey } from '../../../src/hooks/core/store.mjs';
import { evidenceRecord } from '../../../src/hooks/core/ledger.mjs';
import { tmpDir } from '../../helpers.js';
import type { Driver } from '../drivers.js';

type GoldenCase = {
  name: string;
  state: string | null;
  events: Record<string, unknown>[];
  files: Record<string, string[]>;
};

export const fixture = JSON.parse(readFileSync(new URL('../../../../test/hooks/fixtures/ledger-golden.json', import.meta.url), 'utf8')) as { cases: GoldenCase[] };
const cfg = { WF_STATE_FILE: '.burhan/local/PROGRESS.md' };

export function project(state: string | null): string {
  const dir = tmpDir('burhan-ledger-project-');
  mkdirSync(join(dir, '.burhan/local'), { recursive: true });
  writeFileSync(join(dir, '.burhan/workflow.config'), '');
  if (state !== null) writeFileSync(join(dir, '.burhan/local/PROGRESS.md'), state);
  return dir;
}

export function record(dir: string, root: string, event: Record<string, unknown>, more: NodeJS.ProcessEnv = {}): void {
  const raw = JSON.parse(JSON.stringify(event).replaceAll('@P', dir)) as Record<string, unknown>;
  raw.project_dir = dir;
  evidenceRecord({ ev: parseEvent(JSON.stringify(raw))!, cfg, project: dir, env: { WF_EVIDENCE_DIR: root, ...more } });
}

function jsonlFiles(dir: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.jsonl')) out[relative(dir, path)] = readFileSync(path, 'utf8').split('\n').filter((line) => line !== '');
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

export async function runCorpus(driver: Driver): Promise<void> {
  const failures: string[] = [];
  for (const c of fixture.cases) {
    try {
      const dir = project(c.state);
      const root = tmpDir('burhan-ledger-root-');
      for (const event of c.events) {
        const raw = JSON.parse(JSON.stringify(event).replaceAll('@P', dir)) as Record<string, unknown>;
        raw.project_dir = dir;
        await driver(['core', 'turn-audit'], JSON.stringify(raw), { WF_EVIDENCE_DIR: root });
      }
      const actual = jsonlFiles(join(root, projectKey(dir)));
      const expected = Object.fromEntries(Object.entries(c.files)
        .filter(([name]) => name.endsWith('.jsonl'))
        .map(([name, lines]) => [name, lines]));
      const normalized = Object.fromEntries(Object.entries(actual).map(([name, lines]) => [name, lines.map((line) =>
        line.replace(/"ts":"[^"]+"/, '"ts":"TS"').replaceAll(dir, '@P'))]));
      assert.deepEqual(normalized, expected, c.name);
    } catch (error) {
      failures.push(`${driver.label}: ${c.name}: ${error instanceof Error ? error.message.split('\n').slice(0, 6).join(' | ') : String(error)}`);
    }
  }
  assert.deepEqual(failures, [], `${failures.length} of ${fixture.cases.length} ledger cases differ:\n${failures.join('\n')}`);
}
