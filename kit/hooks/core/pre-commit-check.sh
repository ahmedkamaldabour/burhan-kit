#!/usr/bin/env bash
# Before a shell `git commit`: RUN the project's fast check and report the measured result,
# instead of asking the agent to remember to. "A hook that reports a fact cannot be forgotten;
# one that asks nicely can." Never blocks; does not run tests or anything that mutates files —
# only WF_CHECK_CMD, under a timeout.
. "$(dirname "$0")/lib.sh"
wf_init

cmd="$(wf_get .command)"
# `git [global options] commit`, also inside `bash -c "..."`; not `git commit-tree`.
GIT_OPTS='([[:space:]]+(-c[[:space:]]+[^[:space:]]+|-C[[:space:]]+("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:]]+)|--[a-z-]+(=[^[:space:]]+)?))*'
COMMIT_RE="(^|[;&|(\"'[:space:]])git${GIT_OPTS}[[:space:]]+commit([[:space:]]|\$|[\"';&|)])"
printf '%s' "$cmd" | grep -qE -- "$COMMIT_RE" || wf_emit

# timeout(1) is not on every system (stock macOS has none; Homebrew installs gtimeout).
tbin="${WF_TIMEOUT_BIN:-}"
[ -n "$tbin" ] || tbin="$(command -v timeout || command -v gtimeout)"
[ "$tbin" = none ] && tbin=""

if [ -z "$WF_CHECK_CMD" ]; then
  res="NOT VERIFIED (no check configured). Set WF_CHECK_CMD in .workflow/workflow.config."
elif [ -z "$tbin" ]; then
  res="NOT VERIFIED (no timeout utility found — install coreutils). Run \`$WF_CHECK_CMD\` yourself before committing."
else
  # Output goes to a file, not $(...): a background child that keeps stdout open must not make the
  # hook wait. -k: a check that ignores TERM is killed 2 s later.
  tmp="$(mktemp)"
  { (cd "$WF_PROJECT" 2>/dev/null && wf_user_locale "$tbin" -k 2 "$WF_CHECK_TIMEOUT" bash -c "$WF_CHECK_CMD" >"$tmp" 2>&1 </dev/null); } 2>/dev/null; rc=$?
  out="$(head -c 4000 "$tmp")"; rm -f "$tmp"
  case "$rc" in
    0)   res="PASS — \`$WF_CHECK_CMD\` run by this hook just now." ;;
    124|137) res="NOT VERIFIED (timed out after ${WF_CHECK_TIMEOUT}s) — run \`$WF_CHECK_CMD\` yourself before committing." ;;
    *)   res="FAIL (exit $rc) — \`$WF_CHECK_CMD\`: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-400)" ;;
  esac
fi

wf_say "Pre-commit gate — measured: $res
CONTROL CHECKPOINT: have you shown the human \`git status\`/diff of exactly these files IN THIS CONVERSATION and received an explicit choice — (a) commit now, (b) keep going, commit later, (c) they commit manually? If not, cancel this command, show the files and ask. Also state the test output this commit rests on and that the diff was reviewed."
wf_emit
