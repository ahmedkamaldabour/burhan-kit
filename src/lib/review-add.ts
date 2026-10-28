import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { Io } from '../main.js';
import { performedOk } from '../hooks/core/item-contract.mjs';
import { BurhanError } from './errors.js';
import { putFile, realTarget } from './fs-safe.js';
import { itemFolder, readOr, units } from './item-files.js';
import { assertInside, normalizeLines, oneLine, today } from './item-io.js';
import { docsLocation } from './status.js';

const FORM = '"<agent> · <model> · fresh subagent / other agent / human / same session"';

/** `burhan review add <slug> --kind review|qc|verification --by <who> [--unit N] [--verdict V] [--round N] [--text T]`: writes one section or report with
 *  Performed by in the exact form the checks read. A text line that starts with `#` is refused: it would be read as a heading. */
export function reviewAdd(target: string, slug: string | undefined, o: { kind?: string; unit?: string; by?: string; verdict?: string; round?: string; text?: string; docs?: string }, io: Io): number {
  const project = realTarget(target);
  const { slug: s, dir } = itemFolder(docsLocation(target, o.docs).abs, slug, 'review add');
  if (o.kind !== 'review' && o.kind !== 'qc' && o.kind !== 'verification') throw new BurhanError('--kind must be review, qc or verification');
  const by = oneLine(o.by, '--by');
  if (!performedOk(by)) throw new BurhanError(`--by must be ${FORM}`);
  const text = normalizeLines(o.text ?? '');
  if (text.split('\n').some((l) => /^[ \t]*#/.test(l))) throw new BurhanError('--text may not have a line that starts with # (it would be read as a heading)');
  const body = text === '' ? '' : `\n${text}\n`;
  const head = (title: string): string => `# ${s} — ${title}\n- **Contract:** 1\n`;
  const meta = `- **Performed by:** ${by}\n- **Date:** ${today()}\n`;

  let file: string;
  let append: string;
  let create: string | null = null;
  if (o.verdict !== undefined && o.kind !== 'qc') throw new BurhanError('--verdict is for a QC report only');
  if (o.kind === 'review') {
    const group = /^(\d+)[–-](\d+)$/.exec(o.unit ?? '');
    if (!/^\d+$/.test(o.unit ?? '') && !(group && Number(group[1]) < Number(group[2]))) throw new BurhanError('--unit <N> (or a review group <A>-<B>) is needed for a review');
    const planText = readOr(join(dir, `${s}-implementation-plan.md`));
    const wanted = group ? Array.from({ length: Math.min(Number(group[2]) - Number(group[1]) + 1, 1000) }, (_, i) => Number(group[1]) + i) : [Number(o.unit)];
    const have = planText === null ? [] : units(planText).map((u) => u.n);
    for (const n of wanted) if (!have.includes(n)) throw new BurhanError(`the plan has no Sub-unit ${n}`);
    file = join(dir, 'reviews', `${s}-review.md`);
    create = head('Review');
    append = group ? `\n## Sub-units ${group[1]}–${group[2]} — review (group)\n${meta}${body}` : `\n## Sub-unit ${Number(o.unit)} — review\n${meta}${body}`;
  } else if (o.kind === 'qc') {
    const verdict = oneLine(o.verdict, '--verdict');
    if (verdict === '' || verdict.includes(' | ') || !/^(PASS|FAIL)(?![A-Za-z0-9_])/.test(verdict)) throw new BurhanError('--verdict must start with PASS or FAIL (for example "FAIL — 2 issues")');
    const round = o.round === undefined ? 1 : Number(o.round);
    if (!Number.isInteger(round) || round < 1) throw new BurhanError('--round is a whole number from 1');
    file = join(dir, 'reviews', round === 1 ? `${s}-qc.md` : `${s}-qc-r${round}.md`);
    const before = join(dir, 'reviews', round === 2 ? `${s}-qc.md` : `${s}-qc-r${round - 1}.md`);
    if (round > 1 && !existsSync(before)) throw new BurhanError(`QC round ${round} needs round ${round - 1} first: ${relative(dir, before).split('\\').join('/')} does not exist`);
    if (existsSync(file)) throw new BurhanError(`${relative(dir, file).split('\\').join('/')} exists: a new QC run needs --round <N>`);
    create = head('QC');
    append = `${meta}- **Verdict:** ${verdict}\n${body}`;
  } else {
    file = join(dir, 'reviews', `${s}-verification.md`);
    create = head('Verification');
    append = `\n## Run ${today()}\n${meta}${body}`;
  }
  assertInside(project, file);
  const had = readOr(file);
  if (had === null && existsSync(file)) throw new BurhanError(`${file} is not a plain file`);
  mkdirSync(dirname(file), { recursive: true });
  putFile(file, (had ?? create) + (had === null && o.kind === 'qc' ? '\n' : '') + append);
  io.stdout(`review add: wrote ${relative(target, file).split('\\').join('/')}\n`);
  return 0;
}
