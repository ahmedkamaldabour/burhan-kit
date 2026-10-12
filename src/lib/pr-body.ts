import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Io } from '../main.js';
import { BurhanError } from './errors.js';
import { performedBy, qcVerdict, reviewFiles } from './facts.js';
import { realTarget } from './fs-safe.js';
import { accepted, fieldLine, filled, given, itemRoute, latestQcFile, read } from './items.js';
import { docsLocation } from './status.js';

/** `burhan pr-body`: a pull-request description built only from the item's files. Read-only — the
 *  agent passes it to `gh pr create --body-file`. A value still a template placeholder, or missing,
 *  is said to be missing; nothing is inferred. */

/** The body of a `## <heading>` section (up to the next `## `), matched by its title words. */
function section(text: string, title: RegExp): string {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => /^##\s/.test(l) && title.test(l));
  if (i < 0) return '';
  const end = lines.findIndex((l, j) => j > i && /^##?\s/.test(l));
  return lines.slice(i + 1, end < 0 ? undefined : end).join('\n');
}

/** Table rows as trimmed cells (split on unescaped pipes; `\|` stays as written, so it stays valid in
 *  the output table). Separator rows are dropped, and a row whose cell count differs from its table's
 *  header is malformed — skipped, never read. */
function rows(text: string): string[][] {
  const out: string[][] = [];
  let width = 0;
  for (const l of text.split('\n')) {
    if (!/^\s*\|/.test(l)) { width = 0; continue; }
    if (/^\s*\|[\s|:-]+\|\s*$/.test(l)) continue;
    const cells = l.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
    if (width === 0) width = cells.length; // the header row
    if (cells.length === width) out.push(cells);
  }
  return out;
}

const real = (v: string | null | undefined): string | null => (v ? filled(v.replace(/\*/g, '').trim()) : null);
/** "Performed by" only in its exact fixed form (phases/files.md · Fields). */
const by = (raw: string | null): string => {
  const v = raw?.replace(/\*/g, '').trim() ?? '';
  return v && performedBy(v) !== 'unknown' ? v : 'not recorded';
};
const bullets = (text: string): string[] => text.split('\n')
  .map((l) => /^\s*[-*]\s+(.*)$/.exec(l)?.[1]?.trim() ?? '')
  .filter((l) => l && real(l) !== null);

export function prBody(o: { target: string; item?: string; docs?: string }, io: Io): number {
  if (!o.item) throw new BurhanError('pr-body needs --item <slug>');
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(o.item) || o.item.includes('..')) throw new BurhanError(`not a work-item slug: ${o.item}`);
  const target = realTarget(o.target);
  const { abs: docs } = docsLocation(target, o.docs);
  const slug = o.item;
  const dir = join(docs, slug);
  if (!existsSync(dir)) throw new BurhanError(`no work item ${slug} under ${relative(target, docs) || '.'}/`);
  const realDir = realTarget(dir);
  if (realDir !== target && !realDir.startsWith(target + sep)) throw new BurhanError(`the work item ${slug} resolves outside the project: ${realDir}`);
  const rel = (p: string) => relative(target, p);

  const story = read(join(dir, `${slug}-story.md`));
  const plan = read(join(dir, `${slug}-implementation-plan.md`));
  const findings = read(join(dir, `${slug}-findings.md`));
  const verification = read(join(dir, 'reviews', `${slug}-verification.md`));
  const qcPath = latestQcFile(dir, slug);
  const qc = read(qcPath);

  const out: string[] = [];
  const title = real(/^#\s+(.+)$/m.exec(story || findings)?.[1]) ?? slug;
  out.push(`# ${title}`, '');
  const what = real(given(fieldLine(story, 'What changes')));
  if (what) out.push(what, '');
  out.push(`- **Route:** ${itemRoute(story, plan, findings) ?? 'not recorded'}`, `- **Item:** \`${rel(dir)}/\``, '');

  // Acceptance criteria, each with its recorded outcome (verification), never a guessed one.
  const outcome = new Map(rows(verification)
    .filter((r) => /^AC-\d+$/.test(r[0]) && real(r[1])).map((r) => [r[0], r[1]]));
  const acs = rows(section(story, /acceptance criteria/i)).filter((r) => /^AC-\d+$/.test(r[0]) && real(r[1]));
  if (acs.length) {
    out.push('## Acceptance criteria', '| AC | Criterion | Outcome |', '|----|-----------|---------|');
    for (const r of acs) out.push(`| ${r[0]} | ${real(r[1])} | ${outcome.get(r[0]) ?? 'not verified'} |`);
    out.push('');
  }
  const unread = section(story, /acceptance criteria/i).split('\n').filter((l) => /^\s*\|\s*AC-\d+\s*\|/.test(l)).length
    - rows(section(story, /acceptance criteria/i)).filter((r) => /^AC-\d+$/.test(r[0])).length;
  if (unread > 0) {
    out.push(`${unread} criterion row${unread === 1 ? '' : 's'} could not be read (a cell count other than the header's — escape a pipe as \\|); see the story.`, '');
  }

  out.push('## Review and QC');
  const reviews = reviewFiles(dir, slug);
  const reviewers = reviews.flatMap((n) => [...read(join(dir, 'reviews', n)).matchAll(/\*\*Performed by:\*\*[ \t]*([^\n]*)/g)].map((m) => by(m[1])));
  out.push(reviews.length ? `- Review: ${reviewers.length ? [...new Set(reviewers)].join('; ') : 'not recorded'} (${reviews.map((n) => `\`${rel(join(dir, 'reviews', n))}\``).join(', ')})` : '- Review: not recorded');
  if (!qc) out.push('- QC: not run');
  else {
    const v = qcVerdict(qc);
    const acc = fieldLine(qc, 'Accepted by');
    const performed = `performed by ${by(fieldLine(qc, 'Performed by'))}`;
    const line = v === 'unrecorded' ? `verdict not recorded · ${performed}`
      : accepted(acc) ? `${v} · ${performed} · Accepted by ${acc!.replace(/\*/g, '').trim()}`
      : `${v} (proposed — not accepted) · ${performed}`;
    out.push(`- QC: ${line} (\`${rel(qcPath)}\`)`);
  }
  out.push('');

  out.push('## Verification');
  if (!verification) out.push('- Verification: not recorded');
  else {
    const file = `\`${rel(join(dir, 'reviews', `${slug}-verification.md`))}\``;
    // Counted by the run number in the first cell: a command may hold an unescaped shell pipe.
    const runs = /^##\s+runs/im.test(verification) ? section(verification, /^##\s+runs/i).split('\n').filter((l) => /^\s*\|\s*\d+\s*\|/.test(l)).length : null;
    out.push(runs === null ? `- runs not listed (${file})` : `- ${runs} recorded run${runs === 1 ? '' : 's'} (${file})`);
  }
  const limits = [...bullets(section(verification, /limitations/i)), ...bullets(section(qc, /limitations/i))];
  if (limits.length) out.push('', '## Limitations', ...[...new Set(limits)].map((l) => `- ${l}`));
  out.push('', '## Evidence', `Every command with its exit code, in order: \`burhan evidence --item ${slug}\` (the ledger is local to the developer's machine).`, '');

  io.stdout(out.join('\n'));
  return 0;
}
