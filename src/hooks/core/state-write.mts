/** Around this session's writes of the state file. Before a write: remember the Now list it is about to change (the baseline gate I compares
 *  with); for a whole-file write, warn when the new content drops a block another live session works on; for an edit-tool write, save the block
 *  hashes of that write (gate J judges it after the write). A shell write saves no hashes: gate J does not judge it. Never blocks (WORKFLOW §7).
 *  Edit tools and patches give the file; a shell command gives it through its redirection. The new content is known only for a Write (its
 *  `content`) and a heredoc `>`/`tee` write; any other write gets the baseline and no warning. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { itemSlugs, nowSection, relPath, type Check, type Ctx } from './lib.mjs';
import { shellWrites } from './shell-writes.mjs';
import { agoText, blockHashes, changedBlocks, liveOwnerAge, slugText } from './state-blocks.mjs';
import { forgetStateBlocks, stateAfterSnapshot, stateBlockLines, stateBlocksSnapshot, stateMineBlocks, stateSnapshot } from './store.mjs';

const storeEnv = (ctx: Ctx): NodeJS.ProcessEnv => ({ ...ctx.env, ...ctx.cfg });
const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function isStateFile(ctx: Ctx, raw: string): boolean {
  const state = ctx.cfg.WF_STATE_FILE ?? '';
  return state !== '' && raw !== '' && relPath(raw, ctx.project).replace(/\\/g, '/') === state;
}

/** The body of the heredoc on the line that writes `target` with `>` or `tee` (not `>>`, not `tee -a`); null when there is none. */
function heredocBody(command: string, target: string): string | null {
  const lines = command.split('\n');
  const t = escapeRe(target);
  const redirect = new RegExp(`(?:^|[^>0-9&])>\\s*["']?${t}["']?(?:[\\s;&|]|$)|\\btee\\s+(?!(?:[^|;&<\\n]*\\s)?(?:-[a-zA-Z]*a[a-zA-Z]*|--append)\\s)(?:-\\S+\\s+)*["']?${t}["']?(?:[\\s;&|]|$)`);
  for (let i = 0; i < lines.length; i++) {
    const here = /(?<!<)<<(-?)\s*(?:'([A-Za-z_]\w*)'|"([A-Za-z_]\w*)"|([A-Za-z_]\w*))/.exec(lines[i]);
    if (here === null || !redirect.test(lines[i])) continue;
    const delimiter = here[2] ?? here[3] ?? here[4];
    const body: string[] = [];
    for (let k = i + 1; k < lines.length; k++) {
      if ((here[1] === '-' ? lines[k].replace(/^\t+/, '') : lines[k]) === delimiter) return body.length === 0 ? '' : `${body.join('\n')}\n`;
      body.push(lines[k]);
    }
    return null;
  }
  return null;
}

export const preStateWrite: Check = (ctx) => {
  const out: string[] = [];
  try {
    const shell = ctx.ev.get('.event') === 'pre_shell';
    const command = ctx.ev.get('.command');
    const target = (shell ? shellWrites([command]) : [ctx.ev.get('.file')]).find((file) => isStateFile(ctx, file));
    if (target === undefined) return [];
    let text = '';
    try { text = readFileSync(join(ctx.project, ctx.cfg.WF_STATE_FILE ?? ''), 'utf8'); } catch { /* a missing file has no blocks */ }
    const before = [...new Set(itemSlugs(nowSection(text)))];
    stateSnapshot(ctx.project, ctx.ev.get('.session'), before, storeEnv(ctx));
    const hashes = blockHashes(nowSection(text));
    // Gate J judges one edit-tool write, with its own post hook. A shell write is not judged, so it drops any older baseline instead of saving one;
    // an edit whose post hook never ran has its baseline replaced here, not judged (QC round 2 #7): the file may have changed since, by another session.
    if (shell) forgetStateBlocks(ctx.project, ctx.ev.get('.session'), storeEnv(ctx));
    else stateBlocksSnapshot(ctx.project, ctx.ev.get('.session'), hashes, storeEnv(ctx));
    const content = shell ? heredocBody(command, target) : typeof ctx.ev.raw.content === 'string' ? ctx.ev.raw.content : null;
    if (content === null) return [];
    const after = new Set(itemSlugs(nowSection(content)));
    for (const slug of before) {
      if (after.has(slug)) continue;
      const age = liveOwnerAge(ctx.project, ctx.ev.get('.session'), slug, storeEnv(ctx));
      if (age !== null) out.push(`⚠ This write drops the \`${slugText(slug)}\` block — another session (active ${agoText(age)}) is working on it. Keep it in the new content (WORKFLOW §5: edit only your own block).`);
    }
  } catch { /* fail open */ }
  return out;
};

/** After this session wrote the state file through an edit tool (Write, Edit, MultiEdit, a Codex patch): judge this one write. The blocks whose
 *  hash differs from the list the pre-write hook saved just before this same write go to this session's `mine-blocks` (gate J reads them); with
 *  no pre-write for it (`now-blocks` absent), nothing is judged. Then save the Now list as it stands (gate I). Never prints. */
export const postStateWrite: Check = (ctx) => {
  try {
    if (!isStateFile(ctx, ctx.ev.get('.file'))) return [];
    const text = readFileSync(join(ctx.project, ctx.cfg.WF_STATE_FILE ?? ''), 'utf8');
    const session = ctx.ev.get('.session');
    const hashes = blockHashes(nowSection(text));
    const before = stateBlockLines(ctx.project, session, storeEnv(ctx));
    if (before !== null) stateMineBlocks(ctx.project, session, changedBlocks(before, hashes), storeEnv(ctx));
    forgetStateBlocks(ctx.project, session, storeEnv(ctx));
    stateAfterSnapshot(ctx.project, session, itemSlugs(nowSection(text)), storeEnv(ctx));
  } catch { /* fail open */ }
  return [];
};
