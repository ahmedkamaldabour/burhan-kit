/** The one shape of a closed item's line in the state file (phases/close-out.md):
 *  `- <slug> · <type> / <scope> · <outcome> · <commit id or "uncommitted"> · <folder>`. One split, no backtracking: a long line costs its length. */
export const OUTCOMES = ['QC PASS', 'Done (no QC)', 'Paused', 'Superseded'];
export interface ClosedLine { slug: string; route: string; outcome: string; commit: string; folder: string }

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ROUTE = /^(feature|bug|investigation|change|refactor|release) \/ (spike|bounded|architectural|patch)$/;
const COMMIT = /^(?:[0-9a-f]{7,40}|uncommitted)$/;

export function formatClosedLine(c: ClosedLine): string {
  return `- ${c.slug} · ${c.route} · ${c.outcome} · ${c.commit} · ${c.folder}`;
}

/** The parts of a closed line, or null when the line is not exactly the shape. */
export function parseClosedLine(line: string): ClosedLine | null {
  const text = line.replace(/\r$/, '');
  if (!text.startsWith('- ')) return null;
  const parts = text.slice(2).split(' · ');
  if (parts.length !== 5) return null;
  const [slug, route, outcome, commit, folder] = parts as [string, string, string, string, string];
  if (!SLUG.test(slug) || !ROUTE.test(route) || !OUTCOMES.includes(outcome) || !COMMIT.test(commit) || folder === '' || folder !== folder.trim()) return null;
  return { slug, route, outcome, commit, folder };
}
