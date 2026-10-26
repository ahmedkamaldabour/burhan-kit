/** Before this session writes the state file: remember the Now list it is about to change (the baseline gate I compares with), and for a
 *  whole-file write warn when the new content drops a block another live session works on. Never blocks (WORKFLOW §7). Edit tools and patches
 *  give the file; a shell command gives it through its redirection. The new content is known only for a Write (its `content`) and a heredoc
 *  `>`/`tee` write; any other write gets the baseline and no warning. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { itemSlugs, nowSection, relPath, type Check, type Ctx } from './lib.mjs';
import { shellWrites } from './shell-writes.mjs';
import { agoText, liveOwnerAge, slugText } from './state-blocks.mjs';
import { stateAfterSnapshot, stateSnapshot } from './store.mjs';

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

/** After this session wrote the state file (Write, Edit, MultiEdit, a Codex patch): save the Now list as it stands. Never prints. */
export const postStateWrite: Check = (ctx) => {
  try {
    if (!isStateFile(ctx, ctx.ev.get('.file'))) return [];
    const text = readFileSync(join(ctx.project, ctx.cfg.WF_STATE_FILE ?? ''), 'utf8');
    stateAfterSnapshot(ctx.project, ctx.ev.get('.session'), itemSlugs(nowSection(text)), storeEnv(ctx));
  } catch { /* fail open */ }
  return [];
};
