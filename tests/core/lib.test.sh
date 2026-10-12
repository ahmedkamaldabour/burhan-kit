#!/usr/bin/env bash
. "$(dirname "$0")/../lib.sh"; . "$(dirname "$0")/helpers.sh"
# lib.sh is a bash-internal library (white-box); another implementation is judged by the black-box suites.
[ -n "${WF_IMPL_CORE:-}" ] && { echo "lib.sh — skipped (WF_IMPL_CORE is set)"; exit 0; }

# A throwaway script that exercises lib.sh, so lib behaviour is tested directly.
probe="$(t_tmp)/probe.sh"
cat > "$probe" <<PROBE
. "$CORE/lib.sh"
wf_init
case "\$(wf_get .prompt)" in
  defaults) wf_say "docs=\$WF_DOCS_DIR state=\$WF_STATE_FILE budget=\$WF_STATE_BUDGET skills=\$WF_SKILLS timeout=\$WF_CHECK_TIMEOUT" ;;
  rel)      wf_say "rel1=\$(wf_rel "\$WF_PROJECT/a/b.txt") rel2=\$(wf_rel ./c/d.txt) rel3=\$(wf_rel e.txt)" ;;
  two)      wf_say "first"; wf_say "second" ;;
  crash)    false; nonexistent_command_xyz; wf_say "still-here" ;;
  list)     wf_say "\$(wf_list .turn.files_edited | tr '\n' ',')" ;;
  match)    wf_match '' 'anything' && wf_say "empty-regex-matched"; wf_match 'b+' 'abbc' && wf_say "matched" ;;
  dots)     for x in ../../x a/../../../x ./a/./b/../c a/b/.. "\$WF_PROJECT/s/../AI_SPEC/P.md"; do wf_say "[\$(wf_rel "\$x")]"; done ;;
  config)   wf_say "check=\$WF_CHECK_CMD" ;;
esac
wf_emit
PROBE
run() { printf '%s' "$1" | bash "$probe" 2>/dev/null; echo "rc=$?"; }

echo "lib.sh"
P="$(proj)"
check "empty stdin -> no output, rc 0" "$(printf '' | bash "$probe" 2>/dev/null; echo "rc=$?")" has "rc=0"
check "empty stdin -> no message" "$(printf '' | bash "$probe" 2>/dev/null)" lacks "message"
check "invalid JSON -> rc 0" "$(run 'not json')" has "rc=0"
check "invalid JSON -> no message" "$(run 'not json')" lacks "message"
out="$(run "$(ev '{"prompt":"defaults"}')")"
check "defaults: docs dir" "$out" has "docs=AI_SPEC/docs"
check "defaults: state file" "$out" has "state=.workflow/local/PROGRESS.md"
check "defaults: budget" "$out" has "budget=80"
check "defaults: skills none" "$out" has "skills=none"
check "defaults: timeout" "$out" has "timeout=60"
P="$(proj 'WF_CHECK_CMD="make check"')"
check "config file is read" "$(run "$(ev '{"prompt":"config"}')")" has "check=make check"
P="$(proj)"; rm -f "$P/.workflow/workflow.config"
check "missing config -> defaults" "$(run "$(ev '{"prompt":"defaults"}')")" has "docs=AI_SPEC/docs"
P="$(proj)"
out="$(run "$(ev '{"prompt":"rel"}')")"
check "wf_rel strips project prefix" "$out" has "rel1=a/b.txt"
check "wf_rel strips ./" "$out" has "rel2=c/d.txt"
check "wf_rel keeps relative" "$out" has "rel3=e.txt"
out="$(printf '%s' "$(ev '{"prompt":"two"}')" | bash "$probe" 2>/dev/null | jq -r .message)"
check_eq "two findings -> one message, blank-line separated" "$out" $'first\n\nsecond'
out="$(run "$(ev '{"prompt":"crash"}')")"
check "failing commands inside a script -> rc 0" "$out" has "rc=0"
check "failing commands do not abort the script" "$out" has "still-here"
check "wf_list prints array items" "$(run "$(ev '{"prompt":"list","turn":{"files_edited":["x","y"]}}')")" has "x,y,"
out="$(run "$(ev '{"prompt":"match"}')")"
check "wf_match: empty regex never matches" "$out" lacks "empty-regex-matched"
check "wf_match: regex matches" "$out" has "matched"
out="$(run "$(ev '{"prompt":"dots"}')")"
check "wf_rel keeps leading .. (outside the project)" "$out" has "[../../x]"
check "wf_rel: a/../../../x stays outside" "$out" has "[../../x]"
check "wf_rel collapses ./ and dir/.." "$out" has "[a/c]"
check "wf_rel collapses trailing dir/.." "$out" has "[a]"
check "wf_rel resolves an absolute in-project path with .." "$out" has "[AI_SPEC/P.md]"
echo "lib.sh — local overrides (team use)"
P="$(proj 'WF_CHECK_CMD="team-check"')"; mkdir -p "$P/.workflow/local"
echo 'WF_CHECK_CMD="my-check"' > "$P/.workflow/local/workflow.config"
check "local config overrides the team config" "$(run "$(ev '{"prompt":"config"}')")" has "check=my-check"
rm "$P/.workflow/local/workflow.config"
check "team config alone still applies" "$(run "$(ev '{"prompt":"config"}')")" has "check=team-check"
P="$(proj 'WF_CHECK_TIMEOUT=90')"; mkdir -p "$P/.workflow/local"; echo 'WF_CHECK_TIMEOUT=300' > "$P/.workflow/local/workflow.config"
check "local WF_CHECK_TIMEOUT is ignored (the hook timeout follows the team file)" "$(run "$(ev '{"prompt":"defaults"}')")" has "timeout=90"
P="$(proj 'WF_CONFIG=/nonexistent')"; mkdir -p "$P/.workflow/local"; echo 'WF_CHECK_CMD="my-check"' > "$P/.workflow/local/workflow.config"
check "a team config that sets WF_CONFIG does not switch the local layer off" "$(run "$(ev '{"prompt":"config"}')")" has "check=my-check"
t_summary
