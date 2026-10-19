import { createHash } from 'node:crypto';

export type Agent = 'claude' | 'codex';
export class BlockError extends Error {}

const BEGIN_RE = /^<!-- burhan:start -->$/;
const END_LINE = '<!-- burhan:end -->';
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export function bootstrapBody(agent: Agent): string {
  return [
    '## Working agreement (burhan)',
    '',
    'This repository follows the burhan working agreement. This block only points to it;',
    'it does not restate it. Project values live in `.burhan/bindings.md` (WORKFLOW §1) and',
    '`.burhan/workflow.config`; personal overrides in `.burhan/local/` (git-ignored).',
    '',
    ...(agent === 'claude'
      ? ['@.burhan/WORKFLOW.md', '@.burhan/bindings.md']
      : ['Read `.burhan/WORKFLOW.md` before any project work. Work-item commands are described in',
         '`.burhan/commands/e2e.md`, `.burhan/commands/qc.md` and `.burhan/commands/onboard.md`; when following one,',
         '`$ARGUMENTS` means the work-item slug (or title) the user names.',
         'If this session\'s context has no line beginning `⚑ WORKFLOW GATES`, burhan\'s hooks may not be running in',
         'Codex: tell the user once to open `/hooks` in Codex and trust the burhan hooks themselves; never trust them for the user.']),
    '',
    'At the start of every session, read the state file named in `.burhan/bindings.md` first.',
  ].join('\n');
}

export function renderBlock(agent: Agent, version: string): string {
  const body = bootstrapBody(agent);
  return [
    '<!-- burhan:start -->',
    `<!-- burhan:metadata version=${version} sha256=${sha256(body + '\n')} — managed by burhan; keep your own instructions outside this block; run \`burhan upgrade\` to update -->`,
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
    const oldHash = /sha256=([0-9a-f]{64})/.exec(lines[b + 1])?.[1];
    const oldBody = lines.slice(b + 2, e).join('\n').replace(/\n+$/, '');
    editedInside = oldHash === undefined || sha256(oldBody + '\n') !== oldHash;
    out = [...lines.slice(0, b), block, ...lines.slice(e + 1)];
  }
  const text = out.join('\n') + '\n';
  return { content: crlf ? text.replace(/\n/g, '\r\n') : text, editedInside };
}

/** The file without the burhan block. `content: null` → the file held only the block (delete it).
 *  A file with no block is returned unchanged; a broken marker pair throws BlockError. */
export function removeBlock(existing: string): { content: string | null } {
  const crlf = /\r\n/.test(existing);
  const lines = existing.split('\n').map((l) => l.replace(/\r$/, ''));
  if (lines[lines.length - 1] === '') lines.pop();
  const begins = lines.flatMap((l, i) => (BEGIN_RE.test(l) ? [i] : []));
  const ends = lines.flatMap((l, i) => (l === END_LINE ? [i] : []));
  if (begins.length === 0 && ends.length === 0) return { content: existing };
  if (begins.length !== 1 || ends.length !== 1)
    throw new BlockError(`found ${begins.length} begin / ${ends.length} end burhan markers — expected exactly one pair. Fix the file by hand, then re-run.`);
  const [b, e] = [begins[0], ends[0]];
  if (b > e) throw new BlockError('the burhan end marker comes before the begin marker. Fix it by hand, then re-run.');
  const before = lines.slice(0, b);
  const after = lines.slice(e + 1);
  // `applyBlock` put one blank line between the user's text and a block it appended: take it back out.
  if (after.length === 0 && before.length > 0 && before[before.length - 1] === '') before.pop();
  const out = [...before, ...after];
  if (out.every((l) => l.trim() === '')) return { content: null };
  const text = out.join('\n') + '\n';
  return { content: crlf ? text.replace(/\n/g, '\r\n') : text };
}
