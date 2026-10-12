import { createHash } from 'node:crypto';

export type Agent = 'claude' | 'codex';
export class BlockError extends Error {}

const BEGIN_RE = /^<!-- burhan:begin /;
const END_LINE = '<!-- burhan:end -->';
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export function bootstrapBody(agent: Agent): string {
  return [
    '## Working agreement (burhan)',
    '',
    'This repository follows the burhan working agreement. This block only points to it;',
    'it does not restate it. Project values live in `.workflow/bindings.md` (WORKFLOW §1) and',
    '`.workflow/workflow.config`; personal overrides in `.workflow/local/` (git-ignored).',
    '',
    ...(agent === 'claude'
      ? ['@.workflow/WORKFLOW.md', '@.workflow/bindings.md']
      : ['Read `.workflow/WORKFLOW.md` before any project work. Work-item commands are described in',
         '`.workflow/commands/e2e.md` and `.workflow/commands/qc.md`; when following one,',
         '`$ARGUMENTS` means the work-item slug (or title) the user names.']),
    '',
    'At the start of every session, read the state file named in `.workflow/bindings.md` first.',
  ].join('\n');
}

export function renderBlock(agent: Agent, version: string): string {
  const body = bootstrapBody(agent);
  return [
    `<!-- burhan:begin version=${version} sha256=${sha256(body + '\n')} — managed by burhan; keep your own instructions outside this block; run \`burhan upgrade\` to update -->`,
    body,
    END_LINE,
  ].join('\n');
}

/** New file content with exactly one up-to-date block. Never touches text outside the block. */
export function applyBlock(existing: string | null, agent: Agent, version: string): { content: string; editedInside: boolean } {
  const block = renderBlock(agent, version);
  if (existing === null) return { content: block + '\n', editedInside: false };
  const crlf = /\r\n/.test(existing);
  const lines = existing.split('\n').map((l) => l.replace(/\r$/, ''));
  if (lines[lines.length - 1] === '') lines.pop();
  const begins = lines.flatMap((l, i) => (BEGIN_RE.test(l) ? [i] : []));
  const ends = lines.flatMap((l, i) => (l === END_LINE ? [i] : []));
  let out: string[];
  let editedInside = false;
  if (begins.length === 0 && ends.length === 0) {
    out = lines.length ? [...lines, '', block] : [block];
  } else {
    if (begins.length !== 1 || ends.length !== 1)
      throw new BlockError(`found ${begins.length} begin / ${ends.length} end burhan markers — expected exactly one pair. Fix the file by hand, then re-run.`);
    const [b, e] = [begins[0], ends[0]];
    if (b > e) throw new BlockError('the burhan end marker comes before the begin marker. Fix it by hand, then re-run.');
    const oldHash = /sha256=([0-9a-f]{64})/.exec(lines[b])?.[1];
    const oldBody = lines.slice(b + 1, e).join('\n').replace(/\n+$/, '');
    editedInside = oldHash !== undefined && sha256(oldBody + '\n') !== oldHash;
    out = [...lines.slice(0, b), block, ...lines.slice(e + 1)];
  }
  const text = out.join('\n') + '\n';
  return { content: crlf ? text.replace(/\n/g, '\r\n') : text, editedInside };
}
