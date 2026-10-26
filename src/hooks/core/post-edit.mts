/** The after-edit hook entry (`post-edit-reminder`): the phase reminder, and the state-file list after the write. Two independent steps;
 *  each fails open on its own. */
import { postEditReminder } from './post-edit-reminder.mjs';
import { postStateWrite } from './state-write.mjs';
import type { Check } from './lib.mjs';

export const postEdit: Check = async (ctx) => {
  const out: string[] = [];
  try { out.push(...(await postEditReminder(ctx))); } catch { /* fail open */ }
  try { out.push(...(await postStateWrite(ctx))); } catch { /* fail open */ }
  return out;
};
