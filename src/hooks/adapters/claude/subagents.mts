import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readRecords, stepsOfRecords, type Step, type TurnData } from './transcript.mjs';

type MetaLookup = Map<string, string>;

const SAFE_AGENT_ID = /^[A-Za-z0-9_-]+$/u;
const META_FILE = /^agent-.*\.meta\.json$/u;

const regularFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const withoutAgents = (steps: Step[]): Step[] =>
  steps.filter((step) => step.kind !== 'agent');

const renumber = (steps: Step[]): Step[] =>
  steps.map((step, index) => {
    const { _ts: _timestamp, ...rest } = step;
    return { ...rest, seq: index + 1 } as Step;
  });

const stripped = (turn: TurnData): TurnData => ({
  ...turn,
  steps: renumber(withoutAgents(turn.steps)),
});

/** Reads every eligible meta file once; malformed files cannot hide valid neighbours. */
const metaLookup = (dir: string): MetaLookup => {
  const matches = new Map<string, string>();
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => META_FILE.test(name)).sort();
  } catch {
    return matches;
  }
  for (const name of names) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const toolUseId = (parsed as Record<string, unknown>).toolUseId;
      if (typeof toolUseId !== 'string' || matches.has(toolUseId)) continue;
      matches.set(toolUseId, join(dir, `${name.slice(0, -'.meta.json'.length)}.jsonl`));
    } catch {
      // A truncated meta file must not prevent the remaining files from being used.
    }
  }
  return matches;
};

const transcriptFor = (step: Extract<Step, { kind: 'agent' }>, dir: string, metas: MetaLookup): string | undefined => {
  if (step.tool_id === '') return undefined; // bash: `[ -n "$tid" ] || continue`
  if (SAFE_AGENT_ID.test(step.agent_id ?? '')) {
    const direct = join(dir, `agent-${step.agent_id}.jsonl`);
    if (regularFile(direct)) return direct;
  }
  const fallback = step.tool_id === '' ? undefined : metas.get(step.tool_id);
  return fallback && regularFile(fallback) ? fallback : undefined;
};

const timestamped = (step: Step): boolean => step._ts !== null && step._ts !== undefined;

const byTimestamp = (steps: Step[]): Step[] =>
  steps
    .map((step, index) => ({ step, index }))
    .sort((left, right) => {
      const a = String(left.step._ts);
      const b = String(right.step._ts);
      return a < b ? -1 : a > b ? 1 : left.index - right.index;
    })
    .map(({ step }) => step);

/**
 * Replaces Agent/Task placeholders with one level of their subagent evidence.
 * Transcript and metadata failures deliberately fail open to the stripped turn.
 */
export function withSubagentSteps(turn: TurnData, dir: string): TurnData {
  try {
    const placeholders = turn.steps.filter((step): step is Extract<Step, { kind: 'agent' }> => step.kind === 'agent');
    if (placeholders.length === 0) return stripped(turn);

    const metas = metaLookup(dir);
    const expanded = new Map<Extract<Step, { kind: 'agent' }>, Step[]>();
    for (const placeholder of placeholders) {
      const path = transcriptFor(placeholder, dir, metas);
      if (!path) continue;
      const steps = withoutAgents(stepsOfRecords(readRecords(path))).map((step) => ({ ...step, by: placeholder.by } as Step));
      expanded.set(placeholder, steps);
    }

    const synchronous: Step[] = [];
    const asynchronous: Step[] = [];
    for (const step of turn.steps) {
      if (step.kind !== 'agent') {
        synchronous.push(step);
        continue;
      }
      const replacement = expanded.get(step) ?? [];
      if (step.async) asynchronous.push(...replacement);
      else synchronous.push(...replacement);
    }
    const all = [...synchronous, ...asynchronous];
    return { ...turn, steps: renumber(all.every(timestamped) ? byTimestamp(all) : all) };
  } catch {
    return stripped(turn);
  }
}
