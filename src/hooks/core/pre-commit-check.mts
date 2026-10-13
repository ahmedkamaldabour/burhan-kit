/** Before a shell `git commit`: RUN the project's fast check and report the measured result (port of
 *  pre-commit-check.sh). Never blocks; runs only WF_CHECK_CMD, under a timeout. */
import { ereTest } from './ere.mjs';
import type { Check } from './lib.mjs';
import { runCheck } from './run-check.mjs';

// `git [global options] commit`, also inside `bash -c "..."`; not `git commit-tree`. The ERE of the bash
// kit, read by the same translator as the users' regexes, so both see the same commands.
const GIT_OPTS = `([[:space:]]+(-c[[:space:]]+[^[:space:]]+|-C[[:space:]]+("[^"]*"|'[^']*'|[^[:space:]]+)|--[a-z-]+(=[^[:space:]]+)?))*`;
const COMMIT_RE = `(^|[;&|("'[:space:]])git${GIT_OPTS}[[:space:]]+commit([[:space:]]|$|["';&|)])`;

/** `printf '%s' "$out" | tr '\n' ' ' | cut -c1-400` — by characters (macOS and uutils; GNU cut counts bytes).
 *  $(…) drops NUL bytes. */
const oneLine = (s: string): string => Array.from(s.replace(/\0/g, '').replace(/\n+$/, '').replace(/\n/g, ' ')).slice(0, 400).join('');

export const preCommitCheck: Check = async ({ ev, cfg, project, env }) => {
  if (!ereTest(COMMIT_RE, ev.get('.command'))) return [];
  const cmd = cfg.WF_CHECK_CMD ?? '';
  const t = cfg.WF_CHECK_TIMEOUT ?? '60';
  let res: string;
  if (cmd === '') res = 'NOT VERIFIED (no check configured). Set WF_CHECK_CMD in .burhan/workflow.config.';
  else {
    const r = await runCheck(cmd, project, Number(t), env);
    if (r.kind === 'pass') res = `PASS — \`${cmd}\` run by this hook just now.`;
    else if (r.kind === 'timeout') res = `NOT VERIFIED (timed out after ${t}s) — run \`${cmd}\` yourself before committing.`;
    else res = `FAIL (exit ${r.code}) — \`${cmd}\`: ${oneLine(r.output)}`;
  }
  return [`Pre-commit gate — measured: ${res}
CONTROL CHECKPOINT: have you shown the human \`git status\`/diff of exactly these files IN THIS CONVERSATION and received an explicit choice — (a) commit now, (b) keep going, commit later, (c) they commit manually? If not, cancel this command, show the files and ask. Also state the test output this commit rests on and that the diff was reviewed.`];
};
