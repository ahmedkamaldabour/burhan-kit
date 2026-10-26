/** The edit-tool hook entry (`pre-edit-skill`): the skill line for a story, plan, review or code file, and the state-file baseline.
 *  Two independent steps; each fails open on its own. */
import { preEditSkill } from './pre-edit-skill.mjs';
import { preStateWrite } from './state-write.mjs';
import type { Check } from './lib.mjs';

export const preEdit: Check = async (ctx) => {
  const out: string[] = [];
  try { out.push(...(await preEditSkill(ctx))); } catch { /* fail open */ }
  try { out.push(...(await preStateWrite(ctx))); } catch { /* fail open */ }
  return out;
};
