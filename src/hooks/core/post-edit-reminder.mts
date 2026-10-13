/** After a file write/edit: a phase-specific nudge (port of post-edit-reminder.sh). Worded differently from
 *  the session-start and pre-commit gates on purpose. Silent for files that match no configured pattern. */
import { ereTest } from './ere.mjs';
import { relPath, type Check } from './lib.mjs';

export const postEditReminder: Check = ({ ev, cfg, project }) => {
  const out: string[] = [];
  const raw = ev.get('.file');
  if (raw === '') return out;
  const f = relPath(raw, project);
  if (!ereTest(cfg.WF_TEST_REGEX ?? '', f) && ereTest(cfg.WF_CODE_REGEX ?? '', f)) {
    out.push('Code changed — was the failing test written FIRST? If not, test-first was skipped: say so. Then run only the affected test file and the fast check.');
  }
  if (ereTest(cfg.WF_SENSITIVE_REGEX ?? '', f) && (cfg.WF_SENSITIVE_NOTE ?? '') !== '') out.push(cfg.WF_SENSITIVE_NOTE!);
  return out;
};
