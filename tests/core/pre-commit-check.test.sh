#!/usr/bin/env bash
. "$(dirname "$0")/../lib.sh"; . "$(dirname "$0")/helpers.sh"
S=pre-commit-check
c() { core $S "$(ev "$(jq -cn --arg c "$1" '{event:"pre_shell",command:$c}')")" | jq -r '.message // empty'; }
echo "pre-commit-check.sh"

P="$(proj 'WF_CHECK_CMD="true"')"
check_eq "non-commit command -> silent" "$(c 'git status')" ""
check_eq "commit-like word in another command -> silent" "$(c 'echo committed')" ""
check "git commit -> fires" "$(c 'git commit -m x')" has "PASS"
check "git -C dir commit -> fires" "$(c 'git -C sub commit -m x')" has "PASS"
check "chained commit -> fires" "$(c 'git add . && git commit -m x')" has "PASS"
check "checkpoint text always present" "$(c 'git commit -m x')" has "(a) commit now"

P="$(proj 'WF_CHECK_CMD="echo boom-detail; false"')"
out="$(c 'git commit -m x')"
check "failing check -> FAIL" "$out" has "FAIL"
check "failing check -> output included" "$out" has "boom-detail"

P="$(proj 'WF_CHECK_CMD="sleep 5"' 'WF_CHECK_TIMEOUT=1')"
check "slow check -> NOT VERIFIED (timed out" "$(c 'git commit -m x')" has "NOT VERIFIED (timed out"

P="$(proj)"
check "no check configured" "$(c 'git commit -m x')" has "NOT VERIFIED (no check configured)"

P="$(proj 'WF_CHECK_CMD="test -f .workflow/workflow.config"')"
check "check sees project-relative files" "$(c 'git commit -m x')" has "PASS"
echo "  -- commit detection (review)"
P="$(proj 'WF_CHECK_CMD="true"')"
check "git -c k=v commit" "$(c 'git -c user.name=x commit -m y')" has "PASS"
check "git --no-pager commit" "$(c 'git --no-pager commit -m y')" has "PASS"
check "git -C \"my dir\" commit" "$(c 'git -C "my dir" commit -m y')" has "PASS"
check "bash -c \"git commit\"" "$(c 'bash -c "git commit -m y"')" has "PASS"
check_eq "git commit-tree is not a commit" "$(c 'git commit-tree abc')" ""
echo "  -- robustness (review)"
# Config values below are literal single-quoted lines: the only forms every runtime reads (docs/configuration.md).
P="$(proj "WF_CHECK_CMD='head -c 600 /dev/zero | tr \"\\0\" Q; false'")"
out="$(c 'git commit -m x')"
check "FAIL output keeps 400 chars" "$out" has "$(printf 'Q%.0s' $(seq 400))"
check "FAIL output trimmed at 400" "$out" lacks "$(printf 'Q%.0s' $(seq 401))"
P="$(proj 'WF_CHECK_CMD="true"' 'WF_CHECK_TIMEOUT=60s5')"
check "non-numeric timeout falls back" "$(c 'git commit -m x')" has "PASS"
P="$(proj 'WF_CHECK_CMD="(sleep 6 &); true"' 'WF_CHECK_TIMEOUT=2')"
s=$(date +%s); c 'git commit -m x' >/dev/null; e=$(( $(date +%s) - s ))
check "background child keeping stdout open does not hang the hook ($e s)" "$([ "$e" -lt 5 ] && echo fast)" has fast
P="$(proj "WF_CHECK_CMD='trap \"\" TERM; sleep 8'" 'WF_CHECK_TIMEOUT=1')"
s=$(date +%s); out="$(c 'git commit -m x')"; e=$(( $(date +%s) - s ))
check "TERM-ignoring check is killed ($e s)" "$([ "$e" -lt 6 ] && echo fast)" has fast
check "...and reported as timed out" "$out" has "timed out"
P="$(proj 'WF_CHECK_CMD="true"')"
t_bash_only WF_IMPL_CORE "no timeout utility (WF_TIMEOUT_BIN=none) — a port has its own timeout" \
  && check "no timeout utility -> NOT VERIFIED, not FAIL" "$(printf '%s' "$(ev '{"event":"pre_shell","command":"git commit -m x"}')" | WF_TIMEOUT_BIN=none bash "$T_ROOT/tests/impl.sh" core pre-commit-check 2>/dev/null | jq -r .message)" has "no timeout utility"
echo "  -- the check runs under the user's own locale (the hooks may switch theirs to UTF-8)"
P="$(proj "WF_CHECK_CMD='echo \"LC=[\${LC_ALL-unset}]\"; false'")"
check "LC_ALL=C stays C for the check" "$( (unset LANG LC_CTYPE; export LC_ALL=C; c 'git commit -m x') )" has "LC=[C]"
check "no LC_ALL stays unset for the check" "$( (unset LANG LC_ALL LC_CTYPE; c 'git commit -m x') )" has "LC=[unset]"
t_summary
