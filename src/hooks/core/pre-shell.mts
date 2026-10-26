/** The Bash hook entry (`pre-commit-check`): the pre-commit measurement for a `git commit`, and the skill line for a shell write of a story, plan or
 *  review, and the state-file baseline. Independent checks; each fails open on its own. */
import { preShellSkill } from './pre-edit-skill.mjs';
import { preCommitCheck } from './pre-commit-check.mjs';
import { preStateWrite } from './state-write.mjs';
import type { Check } from './lib.mjs';

export const preShell: Check = async (ctx) => {
  const out: string[] = [];
  try { out.push(...(await preCommitCheck(ctx))); } catch { /* fail open */ }
  try { out.push(...(await preShellSkill(ctx))); } catch { /* fail open */ }
  try { out.push(...(await preStateWrite(ctx))); } catch { /* fail open */ }
  return out;
};
