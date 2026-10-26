/** Before a shell `git commit`: RUN the project's fast check and report the measured result (port of
 *  pre-commit-check.sh). Never blocks; runs only WF_CHECK_CMD, under a timeout. */
import { ereTest } from './ere.mjs';
import type { Check } from './lib.mjs';
import { runCheck } from './run-check.mjs';

// `git [global options] commit` where git starts a command: at the start of a line, after `;`, `&`, `|`, `(`
// (also `$(`) or a backtick, or as the first word of a shell's `-c` string (`bash -c "..."`, `sh -lc '...'`); after shell
// keywords (`then`, `do`, `else`, `{`, `!`…), `sudo`-like prefix words with their options, or `NAME=value`
// assignments; with or without a path. Text that only mentions the words (`grep "git commit"`, `echo git commit`)
// does not count, nor does `git commit-tree`. Read by the same ERE translator as the users' regexes, so both see
// the same commands.
const GIT_OPTS = `([[:space:]]+(-c[[:space:]]+[^[:space:]"']*("[^"]*"|'[^']*')?[^[:space:]]*|-C[[:space:]]+("[^"]*"|'[^']*'|[^[:space:]]+)|--[a-z-]+(=[^[:space:]]+)?))*`;
const PREFIX_WORD = `(then|do|else|elif|[{!]|sudo|command|exec|env|time|nohup|nice)([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*`;
const ASSIGNMENT = `[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|[^[:space:]]*)`;
// `-c "…"` counts only as a shell's option (bash, sh, zsh…, with a path and other options), never another tool's
// (`grep -c "git commit"`).
const SHELL_C = `([[:space:];&|(\`]|^)([^[:space:];&|()"'\`]*/)?(bash|sh|zsh|dash|ksh)([[:space:]]+-[A-Za-z]+)*[[:space:]]+-[A-Za-z]*c[[:space:]]+["']`;
const COMMAND_START = `(^|[;&|(\`]|${SHELL_C})[[:space:]]*((${PREFIX_WORD}|${ASSIGNMENT})[[:space:]]+)*`;
const COMMIT_RE = `${COMMAND_START}([^[:space:];&|()"'\`]*/)?git${GIT_OPTS}[[:space:]]+commit([[:space:]]|$|["';&|)\`])`;

/** The output on one line, its LAST 400 characters (a failing check prints its error last), `…` first when cut.
 *  NUL bytes dropped. */
const oneLine = (s: string): string => {
  const chars = Array.from(s.replace(/\0/g, '').replace(/\n+$/, '').replace(/\n/g, ' '));
  return chars.length > 400 ? `…${chars.slice(-400).join('')}` : chars.join('');
};

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
