import type { Io } from '../main.js';
import { skillFor, type Stage } from '../hooks/core/item-stage.mjs';
import { loadHookConfig } from '../hooks/core/config.mjs';
import { readLedger, type LedgerRecord } from './evidence.js';
import { realTarget } from './fs-safe.js';
import { readItemStage } from './stage-read.js';

/** What the evidence ledger says about the skill. It cannot see the current turn (written at turn end) and the CLI has no session id, so "recorded" is read in the latest session of the project. */
export type SkillSeen = { state: 'recorded'; at: string; session: string } | { state: 'not recorded' } | { state: 'unknown'; why: string };
export interface SkillAdvice { skill: string; why: string; seen: SkillSeen }

/** The advice exists only for the skill set the project names: today `superpowers`, the same gate as both hooks (skill-line.mts, pre-edit-skill.mts), read the way the hooks read it (the shell environment, then the config files over it). */
export const wantsSkills = (project: string, env: NodeJS.ProcessEnv = process.env): boolean => loadHookConfig(project, env).WF_SKILLS === 'superpowers';

/** `recs` is the project's ledger, oldest first. A record of this item or of no item (a skill run before the item was linked) counts. */
export function skillSeen(recs: LedgerRecord[], slug: string, skill: string): SkillSeen {
  if (recs.length === 0) return { state: 'unknown', why: 'the evidence ledger has no record for this project yet' };
  const latest = recs[recs.length - 1]!.session;
  const hits = recs.filter((r) => r.kind === 'skill' && r.skill === skill && r.session === latest && (r.item === slug || !r.item || r.item === '-'));
  const last = hits[hits.length - 1];
  return last === undefined ? { state: 'not recorded' } : { state: 'recorded', at: last.ts, session: last.session.slice(0, 8) };
}

/** The skill to run before the next write at this stage, with what the ledger says about it, or null (no skill set, or a stage that has none). */
export function skillAdvice(project: string, slug: string, st: Stage, route: string): SkillAdvice | null {
  if (!wantsSkills(project)) return null;
  const choice = skillFor(st, route);
  if (choice === null) return null;
  let seen: SkillSeen;
  try { seen = skillSeen(readLedger(project), slug, choice.skill); } catch { seen = { state: 'unknown', why: 'the evidence ledger could not be read' }; }
  return { ...choice, seen };
}

const seenText = (s: SkillSeen): string =>
  s.state === 'recorded' ? `recorded at ${s.at}, session ${s.session}; the ledger is written at the end of a turn`
    : s.state === 'not recorded' ? 'not recorded for this item in the latest session'
      : `cannot tell: ${s.why}`;

export const skillAdviceLine = (a: SkillAdvice): string => `skill: ${a.skill} — run it ${a.why} (${seenText(a.seen)})`;

/** The line after a command that opened a stage. It is advice: any failure prints nothing and never changes the command's result. */
export function printAdvice(target: string, slug: string | undefined, io: Io, docs?: string): void {
  try {
    const project = realTarget(target);
    if (!wantsSkills(project)) return;
    const { slug: s, route, st } = readItemStage(target, slug, docs, 'skill advice');
    const advice = skillAdvice(project, s, st, route);
    if (advice !== null) io.stdout(`${skillAdviceLine(advice)}\n`);
  } catch { /* advice only */ }
}
