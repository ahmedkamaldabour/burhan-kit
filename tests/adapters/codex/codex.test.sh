#!/usr/bin/env bash
# Codex adapter — fixtures are sanitized payloads captured from a real Codex 0.150.1 session
# (2026-10-11, tests/adapters/codex/capture-hook.sh), plus synthetic variants of the same shapes.
. "$(dirname "$0")/../../lib.sh"
A="$T_KIT/hooks/adapters/codex"
IMPL=(bash "$T_ROOT/tests/impl.sh" codex)
FX="$(cd "$(dirname "$0")/fixtures" && pwd)"
export WF_CODEX_LEDGER_DIR; WF_CODEX_LEDGER_DIR="$(t_tmp)"

norm() { "${IMPL[@]}" normalize < "$1" 2>/dev/null; }
rec()  { "${IMPL[@]}" hook record < "$1" >/dev/null 2>&1; }   # what every PostToolUse does first

echo "codex normalize — events"
check_eq "SessionStart" "$(norm "$FX/p-session.json" | jq -r .event)" "session_start"
check_eq "agent is codex" "$(norm "$FX/p-session.json" | jq -r .agent)" "codex"
check_eq "project_dir from cwd" "$(norm "$FX/p-session.json" | jq -r .project_dir)" "/proj"
check "UserPromptSubmit -> prompt" "$(norm "$FX/p-prompt.json" | jq -c '[.event,.prompt]')" has '["prompt","Do exactly'
check_eq "PreToolUse Bash -> pre_shell" "$(norm "$FX/p-pre-bash.json" | jq -c '[.event,.command]')" '["pre_shell","echo capture-done"]'
check_eq "PreToolUse apply_patch -> nothing" "$(norm "$FX/p-pre-patch-add.json")" ""
check_eq "PostToolUse apply_patch (add) -> post_edit" "$(norm "$FX/p-post-patch-add.json" | jq -c '[.event,.file]')" '["post_edit","/proj/notes.txt"]'
check_eq "PostToolUse apply_patch (update) -> post_edit" "$(norm "$FX/p-post-patch-update.json" | jq -r .file)" "/proj/notes.txt"
check_eq "multi-file patch -> one post_edit per added/updated/moved file" \
  "$(norm "$FX/p-post-patch-multi.json" | jq -r .file | tr '\n' ' ')" "/proj/src/new.src /proj/src/old.src /proj/src/to.src "
check_eq "PostToolUse Bash -> nothing" "$(norm "$FX/p-post-bash.json")" ""
check_eq "garbage -> nothing" "$(echo nope | "${IMPL[@]}" normalize 2>/dev/null)" ""

echo "codex turn ledger"
for f in p-post-bash-probe p-post-patch-add p-post-patch-update p-post-bash p-post-bash-skill p-post-patch-multi; do rec "$FX/$f.json"; done
# a different turn of the same session must not leak in
U0="$(t_tmp)/u0.json"
jq -c '.turn_id="U0" | .tool_input.command="*** Begin Patch\n*** Update File: /proj/old-turn.src\n*** End Patch"' "$FX/p-post-patch-update.json" > "$U0"
rec "$U0"
t="$(norm "$FX/p-stop.json" | jq -c .turn)"
check_eq "Stop -> turn_end" "$(norm "$FX/p-stop.json" | jq -r .event)" "turn_end"
check_eq "created = Add File + Move to" "$(jq -c '.files_created' <<<"$t")" '["/proj/notes.txt","/proj/src/new.src","/proj/src/to.src"]'
check "edited includes Update File" "$(jq -c '.files_edited' <<<"$t")" has '"/proj/src/old.src"'
check "deleted file is NOT counted as edited" "$(jq -c '.files_edited' <<<"$t")" lacks '"/proj/src/gone.src"'
check "moved-from file is NOT counted as edited" "$(jq -c '.files_edited' <<<"$t")" lacks '"/proj/src/from.src"'
check_eq "other turn's edit excluded (exact)" "$(jq -r '.files_edited[]' <<<"$t" | grep -c old-turn)" "0"
check "shell commands captured" "$(jq -c '.shell_commands' <<<"$t")" has '"echo capture-done"'
check_eq "skill read via SKILL.md -> skills_used" "$(jq -c '.skills_used' <<<"$t")" '["superpowers:test-driven-development"]'
check_eq "assistant text = last_assistant_message" "$(jq -r '.assistant_text' <<<"$t")" "CAPTURE-MARKER-7f3a"
check_eq "stop_hook_active -> reentrant" "$(jq -c '.stop_hook_active=true' "$FX/p-stop.json" | "${IMPL[@]}" normalize | jq -r .reentrant)" "true"
check_eq "no ledger -> empty turn, still turn_end" "$(jq -c '.turn_id="nope"' "$FX/p-stop.json" | "${IMPL[@]}" normalize | jq -c '.turn.files_edited')" "[]"

echo "codex normalize — ordered steps with exit codes (evidence ledger, live shapes 2026-10-11)"
s2() { jq -c --arg id "$2" --arg c "$3" '.session_id="S2" | .turn_id="U2" | .tool_use_id=$id | (if .tool_name=="Bash" then .tool_input.command=$c else . end)' "$FX/$1"; }
s2 p-post-patch-add.json patch1 x | "${IMPL[@]}" hook record >/dev/null 2>&1
s2 p-post-bash.json exec-pass "verify-it a" | "${IMPL[@]}" hook record >/dev/null 2>&1
s2 p-post-bash.json exec-fail "verify-it b" | "${IMPL[@]}" hook record >/dev/null 2>&1
s2 p-post-bash.json exec-gone "verify-it c" | "${IMPL[@]}" hook record >/dev/null 2>&1
jq -c '.tool_response="Exit code: 1\nWall time: 0.1 seconds\nOutput:\nerror: patch did not apply\n"' "$FX/p-post-patch-update.json" \
  | jq -c '.session_id="S2" | .turn_id="U2"' | "${IMPL[@]}" hook record >/dev/null 2>&1
s2 p-post-patch-update.json patch3 x | "${IMPL[@]}" hook record >/dev/null 2>&1
st="$(jq -c --arg tp "$FX/rollout-steps.jsonl" '.session_id="S2" | .turn_id="U2" | .transcript_path=$tp' "$FX/p-stop.json" | "${IMPL[@]}" normalize | jq -c '.turn.steps')"
check_eq "steps: edit, pass (exit 0), fail (exit 3), unknown (not in rollout), failed patch dropped, edit" "$st" \
  '[{"kind":"edit","file":"/proj/notes.txt","seq":1},{"kind":"cmd","cmd":"verify-it a","exit":0,"status":"ok","seq":2},{"kind":"cmd","cmd":"verify-it b","exit":3,"status":"failed","seq":3},{"kind":"cmd","cmd":"verify-it c","exit":null,"status":"unknown","seq":4},{"kind":"edit","file":"/proj/notes.txt","seq":5}]'
check_eq "session and turn_id from the payload" "$(jq -c '.session_id="S2" | .turn_id="U2"' "$FX/p-stop.json" | "${IMPL[@]}" normalize | jq -c '[.session,.turn_id]')" '["S2","U2"]'
RS="$(t_tmp)/rollout-status.jsonl"
for x in 'exec-d:null:declined' 'exec-k:null:failed' 'exec-c:null:completed'; do
  IFS=: read -r id ec stt <<<"$x"; jq -cn --arg id "$id" --arg st "$stt" '{type:"event_msg",payload:{type:"item_completed",item:{type:"CommandExecution",id:$id,status:$st,exit_code:null}}}'
done > "$RS"
for id in exec-d exec-k exec-c; do s2 p-post-bash.json "$id" "verify-it $id" | jq -c '.turn_id="U3"' | "${IMPL[@]}" hook record >/dev/null 2>&1; done
st="$(jq -c --arg tp "$RS" '.session_id="S2" | .turn_id="U3" | .transcript_path=$tp' "$FX/p-stop.json" | "${IMPL[@]}" normalize | jq -c '[.turn.steps[] | .status]')"
check_eq "rollout status without an exit code: declined -> blocked, failed -> failed, completed -> unknown" "$st" '["blocked","failed","unknown"]'
check_eq "Codex steps cover only what happened since the last Stop" "$(jq -c '.session_id="S2" | .turn_id="U3"' "$FX/p-stop.json" | "${IMPL[@]}" normalize | jq -r .turn_scope)" "since_last_stop"
check_eq "no rollout -> exits unknown, order kept" "$(jq -c '.turn_id="nope2"' "$FX/p-stop.json" | "${IMPL[@]}" normalize | jq -c '.turn.steps')" "[]"

L5="$(t_tmp)/codex-ledger-shared"; mkdir -p "$L5/other/data"; t_age 10 "$L5/other"
WF_CODEX_LEDGER_DIR="$L5" "${IMPL[@]}" hook record < "$FX/p-post-bash.json"
WF_CODEX_LEDGER_DIR="$L5" "${IMPL[@]}" hook turn-audit < "$FX/p-stop.json" >/dev/null
check "Codex ledger: a pre-existing directory is never pruned" "$( [ -d "$L5/other/data" ] && echo kept)" has kept
BIGL="$(t_tmp)/big"; mkdir -p "$BIGL/S9"
for k in $(seq 1 600); do printf '%s\n' "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"echo $k\"},\"tool_use_id\":\"e$k\"}"; done > "$BIGL/S9/U9.jsonl"
t0=$(date +%s); n="$(jq -c '.session_id="S9" | .turn_id="U9"' "$FX/p-stop.json" | WF_CODEX_LEDGER_DIR="$BIGL" "${IMPL[@]}" normalize | jq '.turn.steps | length')"; t1=$(date +%s)
check_eq "600 ledger records -> 600 steps" "$n" "600"
check "...in a couple of seconds, not minutes" "$( [ $((t1 - t0)) -lt 5 ] && echo fast)" has fast
echo "codex emit"
check_eq "Stop -> decision block + reason (Codex rejects hookSpecificOutput on Stop)" \
  "$(echo '{"message":"x"}' | "${IMPL[@]}" emit turn_end | jq -c .)" '{"decision":"block","reason":"x"}'
for pair in session_start:SessionStart prompt:UserPromptSubmit pre_shell:PreToolUse post_edit:PostToolUse; do
  check_eq "${pair%%:*} -> hookSpecificOutput.${pair##*:}" "$(echo '{"message":"x"}' | "${IMPL[@]}" emit "${pair%%:*}" | jq -c '[.hookSpecificOutput.hookEventName,.hookSpecificOutput.additionalContext]')" "[\"${pair##*:}\",\"x\"]"
done
check_eq "empty core output -> nothing" "$(printf '' | "${IMPL[@]}" emit turn_end)" ""

echo "codex hook.sh — end to end"
P="$(t_tmp)"; mkdir -p "$P/.burhan"
printf '%s\n' "WF_CODE_REGEX='\\.src\$'" "WF_EVIDENCE_REGEX='^verify-it'" > "$P/.burhan/workflow.config"
WF_CODEX_LEDGER_DIR="$(t_tmp)"
cw() { jq -c --arg p "$P" '.cwd=$p | (.. | strings) |= gsub("/proj"; $p)' "$FX/$1"; }
run() { cw "$1" | "${IMPL[@]}" hook "$2"; echo "rc=$?"; }
out="$(run p-post-patch-multi.json post-edit-reminder)"
check "post_edit on code -> test-first reminder in Codex shape" "$out" has '"hookEventName":"PostToolUse"'
check "post_edit message present" "$out" has "failing test written FIRST"
cw p-stop.json | jq -c '.last_assistant_message="All done ✅"' > "$P/stop.json"
out="$("${IMPL[@]}" hook turn-audit < "$P/stop.json"; echo "rc=$?")"
check "turn with code + claim + no evidence -> block with reason" "$out" has '"decision":"block"'
check "...reason carries the gate" "$out" has "VERIFICATION GATE"
out="$("${IMPL[@]}" hook turn-audit < "$P/stop.json"; echo "rc=$?")"
check "ledger consumed: a second Stop for the same turn is silent" "$out" lacks "VERIFICATION GATE"
cw p-post-patch-multi.json | "${IMPL[@]}" hook record   # fresh ledger: the Stop below WOULD fire if not reentrant
jq -c '.stop_hook_active=true' "$P/stop.json" > "$P/stop2.json"
check "reentrant Stop -> silent (with a ledger that would fire)" "$("${IMPL[@]}" hook turn-audit < "$P/stop2.json")" lacks "decision"
check "session start -> gates" "$(run p-session.json session-gates)" has "WORKFLOW GATES"
check "always rc 0 on garbage" "$(echo garbage | "${IMPL[@]}" hook turn-audit; echo "rc=$?")" has "rc=0"
X="$(t_tmp)"
cw p-post-patch-add.json | env -u WF_CODEX_LEDGER_DIR XDG_STATE_HOME="$X" "${IMPL[@]}" hook record
check "default ledger path is under XDG_STATE_HOME" "$(cd "$X" && find . -name '*.jsonl')" has "./burhan/codex/"
check "ledger never written inside the project" "$(find "$P" -name '*.jsonl')" lacks ".jsonl"

echo "codex regressions"
WF_CODEX_LEDGER_DIR="$(t_tmp)/burhan/codex"; ESC="$(t_tmp)"
jq -c --arg s "../../../$(basename "$ESC")/esc" '.session_id=$s | .turn_id="pwn"' "$FX/p-post-patch-add.json" > "$ESC/bad.json"
out="$("${IMPL[@]}" hook record < "$ESC/bad.json" 2>&1)"
check_eq "traversal ids -> nothing written outside the ledger" "$(find "$ESC" -name '*.jsonl' | wc -l | tr -d ' ')" "0"
check_eq "traversal ids -> no stderr" "$out" ""
check_eq "traversal ids at Stop -> empty turn" "$(jq -c '.session_id="../x" | .turn_id=".."' "$FX/p-stop.json" | "${IMPL[@]}" normalize | jq -c .turn.files_created)" "[]"

R0="$(t_tmp)"; mkdir -p "$R0/precious-old"; t_age 5 "$R0/precious-old"
WF_CODEX_LEDGER_DIR="$R0" "${IMPL[@]}" hook turn-audit < "$FX/p-stop.json" >/dev/null 2>&1
check "prune refuses a directory it did not create" "$( [ -d "$R0/precious-old" ] && echo kept)" has kept
L="$(t_tmp)/burhan/codex"; WF_CODEX_LEDGER_DIR="$L" "${IMPL[@]}" hook record < "$FX/p-post-bash.json"
mkdir -p "$L/old-session" "$L/new-session"; t_age 5 "$L/old-session"
WF_CODEX_LEDGER_DIR="$L" "${IMPL[@]}" hook turn-audit < "$FX/p-stop.json" >/dev/null 2>&1
check "prune removes old sessions in its own ledger" "$( [ -d "$L/old-session" ] && echo kept)" lacks kept
check "prune keeps recent sessions" "$( [ -d "$L/new-session" ] && echo kept)" has kept

L="$(t_tmp)/burhan/codex"; mkdir -p "$L/S1"
{ echo '{"tool_name":"Bash","tool_input":{"command":"a"}}'; echo '{"tool_name":"Ba'; echo '{"tool_name":"Bash","tool_input":{"command":"b"}}'; } > "$L/S1/U1.jsonl"
check_eq "corrupted ledger line skipped, later records kept" "$(WF_CODEX_LEDGER_DIR="$L" "${IMPL[@]}" normalize < "$FX/p-stop.json" | jq -c .turn.shell_commands)" '["a","b"]'

crlf="$(t_tmp)/crlf.json"
jq -c '.tool_input.command = "*** Begin Patch\r\n*** Add File: /proj/a b.src\r\n+x\r\n*** End Patch\r\n"' "$FX/p-post-patch-add.json" > "$crlf"
check_eq "CRLF patch -> clean path (spaces kept)" "$("${IMPL[@]}" normalize < "$crlf" | jq -r .file)" "/proj/a b.src"

sk() { jq -c --arg c "sed -n 1,9p $1" '.tool_input.command=$c' "$FX/p-post-bash.json"; }
L="$(t_tmp)/burhan/codex"
for path in /h/.codex/plugins/cache/mkt/superpowers/6.3.0/skills/brainstorming/SKILL.md \
            /h/.codex/superpowers/skills/test-driven-development/SKILL.md \
            /h/.agents/skills/superpowers/writing-plans/SKILL.md \
            /h/.codex/skills/foo/SKILL.md /proj/.agents/skills/bar/SKILL.md /h/.codex/skills/.system/baz/SKILL.md; do
  sk "$path" | WF_CODEX_LEDGER_DIR="$L" "${IMPL[@]}" hook record
done
check_eq "skill names by install layout" "$(WF_CODEX_LEDGER_DIR="$L" "${IMPL[@]}" normalize < "$FX/p-stop.json" | jq -c .turn.skills_used)" \
  '["superpowers:brainstorming","superpowers:test-driven-development","superpowers:writing-plans","foo","bar","baz"]'

P2="$(t_tmp)"; mkdir -p "$P2/.burhan"; printf '%s\n' "WF_CODE_REGEX='\\.src\$'" > "$P2/.burhan/workflow.config"
out="$(jq -c --arg p "$P2" '.cwd=$p | (.. | strings) |= gsub("/proj"; $p)' "$FX/p-post-patch-multi.json" | WF_CODEX_LEDGER_DIR="$(t_tmp)" "${IMPL[@]}" hook post-edit-reminder | jq -r .hookSpecificOutput.additionalContext)"
check_eq "multi-file patch -> reminder not repeated" "$(printf '%s' "$out" | grep -c 'failing test written FIRST')" "1"

# QC3: Codex launched from a subdirectory -> payload cwd is the subdir; the installed hooks still find the project config
SUB="$(t_tmp)"; mkdir -p "$SUB/.burhan/hooks" "$SUB/pkg/inner"
cp -R "$T_ROOT/dist/hooks" "$SUB/.burhan/hooks/node"
printf '%s\n' "WF_CODE_REGEX='\\.src\$'" > "$SUB/.burhan/workflow.config"
out="$(jq -c --arg c "$SUB/pkg/inner" --arg f "$SUB/pkg/inner/x.src" '.cwd=$c | .tool_input.command=("*** Begin Patch\n*** Add File: " + $f + "\n+x\n*** End Patch")' "$FX/p-post-patch-add.json" \
  | (cd "$SUB/pkg/inner" && WF_CODEX_LEDGER_DIR="$(t_tmp)" node "$SUB/.burhan/hooks/node/main.mjs" codex hook post-edit-reminder))"
check "cwd = subdirectory -> project config still applies (QC3)" "$out" has "failing test written FIRST"

L="$(t_tmp)/burhan/codex"; mkdir -p "$L/S1"
for i in $(seq 1 3); do jq -cn --arg c "$(head -c 60000 /dev/zero | tr '\0' 'c')" '{tool_name:"Bash",tool_input:{command:$c}}'; done > "$L/S1/U1.jsonl"
check_eq "a >128 KB Codex turn still produces turn_end (ARG_MAX)" "$(jq -c '.last_assistant_message=("z" * 300000)' "$FX/p-stop.json" | WF_CODEX_LEDGER_DIR="$L" "${IMPL[@]}" normalize | jq -r '.event + " " + (.turn.shell_commands|length|tostring)')" "turn_end 3"

echo "codex hooks snippet (Node)"
SN="$A/hooks.node.snippet.json"
check_eq "valid JSON" "$(jq -e . "$SN" >/dev/null && echo ok)" "ok"
check "no ownership comments in commands" "$(jq -r '.. | .command? // empty' "$SN")" lacks "<!--"
for c in session-gates prompt-router pre-commit-check post-edit-reminder turn-audit; do
  check "wires $c" "$(jq -r '.. | .command? // empty' "$SN")" has "codex hook $c"
done
check "commands locate the hooks via .burhan/hooks/node/main.mjs" "$(jq -r '.. | .command? // empty' "$SN")" has "'.burhan','hooks','node','main.mjs'"
# Run the real snippet command from a SUBDIRECTORY of a non-git project: it must find the hooks by walking up.
NP="$(t_tmp)"; mkdir -p "$NP/.burhan/hooks" "$NP/deep/er"
cp -R "$T_ROOT/dist/hooks" "$NP/.burhan/hooks/node"
cmd="$(jq -r '.hooks.SessionStart[0].hooks[0].command' "$SN")"
out="$(cd "$NP/deep/er" && jq -c --arg p "$NP" '.cwd=$p' "$FX/p-session.json" | bash -c "$cmd" 2>&1; echo "rc=$?")"
check "snippet command works from a subdirectory of a non-git project" "$out" has "WORKFLOW GATES"
out="$(cd "$(t_tmp)" && echo '{}' | bash -c "$cmd" 2>&1; echo "rc=$?")"
check_eq "snippet command outside any project -> rc 0, silent (no output at all)" "$out" "rc=0"
check "no absolute home paths" "$(cat "$SN")" lacks "$HOME/"
check_eq "no tool matchers (Codex tool names differ; the adapter filters)" "$(jq '[.. | .matcher? // empty] | length' "$SN")" "0"
t_summary
