#!/usr/bin/env bash
. "$(dirname "$0")/../lib.sh"; . "$(dirname "$0")/helpers.sh"
S=post-edit-reminder
e() { core $S "$(ev "$(jq -cn --arg f "$1" '{event:"post_edit",file:$f}')")" | jq -r '.message // empty'; }
echo "post-edit-reminder.sh"

P="$(proj "WF_CODE_REGEX='\\.src\$'" "WF_TEST_REGEX='\\.check\\.src\$'" \
  "WF_SENSITIVE_REGEX='access'" "WF_SENSITIVE_NOTE='SENSITIVE: re-read visibility'" \
  "WF_SINGLE_TEST_HINT='runner {{FILE}}'")"
out="$(e "$P/lib/a.check.src")"
check_eq "test file -> no single-file reminder" "$out" ""
check "legacy WF_SINGLE_TEST_HINT is ignored" "$out" lacks "runner lib/a.check.src"
check "test file -> not the code reminder" "$out" lacks "failing test written FIRST"
check "code file -> test-first reminder" "$(e "$P/lib/a.src")" has "failing test written FIRST"
out="$(e "$P/lib/access/a.src")"
check "sensitive code -> note appended" "$out" has "SENSITIVE: re-read visibility"
check "sensitive code -> still test-first" "$out" has "failing test written FIRST"
check_eq "other files -> silent" "$(e "$P/README.md")" ""

P="$(proj)"
check_eq "no regexes configured -> silent" "$(e "$P/lib/a.src")" ""
P="$(proj "WF_TEST_REGEX='check'" "WF_SINGLE_TEST_HINT='runner {{FILE}}'")"
mkdir -p "$P/.burhan/local"
printf '%s\n' "WF_SINGLE_TEST_HINT='local runner {{FILE}}'" > "$P/.burhan/local/workflow.config"
check_eq "legacy local hint is ignored, including special paths" "$(e "$P/a&b.check")" ""
t_summary
