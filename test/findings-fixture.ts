import { join } from 'node:path';
import { cli, itemDir, projectWithItem } from './item-fixture.js';

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
