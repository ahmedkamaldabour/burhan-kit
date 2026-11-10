import { join } from 'node:path';
import { cli, itemDir, planFile, projectWithItem, read, write } from './item-fixture.js';

export const BY = 'Claude · Sonnet 5.5 · fresh subagent';
export const OWNER = 'dev-dabour';
export const reviewFile = (dir: string): string => join(itemDir(dir), 'reviews', 'foo-review.md');
export const qcFile = (dir: string, round = 1): string => join(itemDir(dir), 'reviews', round === 1 ? 'foo-qc.md' : `foo-qc-r${round}.md`);

/** Item foo (made by `burhan item new`, two sub-units) with a review section for each sub-unit in `units`, written by `review add`. */
export async function withReviews(units: number[] = [1]): Promise<string> {
  const dir = await projectWithItem();
  for (const n of units) {
    const r = await cli(dir, ['review', 'add', 'foo', '--kind', 'review', '--unit', String(n), '--by', BY]);
    if (r.code !== 0) throw new Error(`review add failed: ${r.err}`);
  }
  return dir;
}

/** `burhan finding add foo --in <spec> --severity <severity> --text <text>`. */
export const addFinding = (dir: string, spec: string, severity: string, text: string) => cli(dir, ['finding', 'add', 'foo', '--in', spec, '--severity', severity, '--text', text]);
export const addQc = (dir: string, verdict = 'PASS', round?: number) => cli(dir, ['review', 'add', 'foo', '--kind', 'qc', '--by', BY, '--verdict', verdict, ...(round === undefined ? [] : ['--round', String(round)])]);

/** Removes the old plan line `- **Findings gate:** on`: a plan made before the gate was always on. Nothing reads that line, so the plan behaves the same with or without it. */
export const stripGateLine = (dir: string): void => write(planFile(dir), read(planFile(dir)).replace(/^- \*\*Findings gate:\*\* on\n/m, ''));
/** Puts the old line under the Contract line (a plan that still carries it); does nothing when it is there. */
export const addGateLine = (dir: string): void => {
  const text = read(planFile(dir));
  if (!/^- \*\*Findings gate:\*\* on$/m.test(text)) write(planFile(dir), text.replace(/^(- \*\*Contract:\*\* 1\n)/m, '$1- **Findings gate:** on\n'));
};

/** Every sub-unit in `units` has a review section (written by `review add`) that says `No findings.`: what a test needs that finishes an item, because the findings of every item are decided before the finish. */
export async function reviewsDecided(dir: string, units: number[] = [1, 2]): Promise<void> {
  for (const n of units) {
    for (const args of [['review', 'add', 'foo', '--kind', 'review', '--unit', String(n), '--by', BY, '--text', 'checked the diff'], ['finding', 'add', 'foo', '--in', `review:${n}`, '--none']]) {
      const r = await cli(dir, args);
      if (r.code !== 0) throw new Error(`${args.slice(0, 2).join(' ')} failed: ${r.err}`);
    }
  }
}

/** The QC report (the latest, or `round`) says `No findings.`: what a test needs that runs `approve qc` for another reason. */
export async function qcDecided(dir: string, spec = 'qc'): Promise<void> {
  const r = await cli(dir, ['finding', 'add', 'foo', '--in', spec, '--none']);
  if (r.code !== 0) throw new Error(`finding add --none failed: ${r.err}`);
}
