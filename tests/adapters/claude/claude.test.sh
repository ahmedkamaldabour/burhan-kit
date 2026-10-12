#!/usr/bin/env bash
# Claude Code adapter: payload/transcript -> normalized event; core output -> Claude hook output.
. "$(dirname "$0")/../../lib.sh"
A="$T_KIT/hooks/adapters/claude"
IMPL=(bash "$T_ROOT/tests/impl.sh" claude)
FX="$(dirname "$0")/fixtures"; FX="$(cd "$FX" && pwd)"

# norm <payload-file> [transcript-file] -> normalized event (transcript_path substituted)
norm() {
  local tp="${2:-/nonexistent}"
  jq -c --arg tp "$tp" '.transcript_path = $tp' "$1" | CLAUDE_PROJECT_DIR=/proj "${IMPL[@]}" normalize 2>/dev/null
}
turn() { norm "$FX/p-stop.json" "$FX/$1" | jq -c '.turn'; }

echo "claude normalize — events"
check_eq "SessionStart" "$(norm "$FX/p-session.json" | jq -r .event)" "session_start"
check_eq "agent is claude" "$(norm "$FX/p-session.json" | jq -r .agent)" "claude"
check_eq "project_dir from CLAUDE_PROJECT_DIR" "$(norm "$FX/p-session.json" | jq -r .project_dir)" "/proj"
check_eq "project_dir falls back to cwd" \
  "$(jq -c '.cwd="/other"' "$FX/p-session.json" | env -u CLAUDE_PROJECT_DIR "${IMPL[@]}" normalize | jq -r .project_dir)" "/other"
check_eq "UserPromptSubmit -> prompt" "$(norm "$FX/p-prompt.json" | jq -c '[.event,.prompt]')" '["prompt","fix the bug"]'
check_eq "PreToolUse Bash -> pre_shell" "$(norm "$FX/p-pre-bash.json" | jq -c '[.event,.command]')" '["pre_shell","git commit -m x"]'
check_eq "PreToolUse other tool -> nothing" "$(norm "$FX/p-pre-read.json")" ""
check_eq "PostToolUse Edit -> post_edit" "$(norm "$FX/p-post-edit.json" | jq -c '[.event,.file]')" '["post_edit","/proj/src/a.src"]'
check_eq "PostToolUse NotebookEdit -> notebook path" "$(norm "$FX/p-post-notebook.json" | jq -r .file)" "/proj/nb.ipynb"
check_eq "PostToolUse Bash -> nothing" "$(norm "$FX/p-post-bash.json")" ""
check_eq "Stop -> turn_end" "$(norm "$FX/p-stop.json" "$FX/single-turn.jsonl" | jq -r .event)" "turn_end"
check_eq "stop_hook_active -> reentrant" "$(norm "$FX/p-stop-reentrant.json" "$FX/single-turn.jsonl" | jq -r .reentrant)" "true"
check_eq "garbage stdin -> nothing" "$(echo 'nope' | "${IMPL[@]}" normalize 2>/dev/null)" ""
check_eq "missing transcript -> empty turn" "$(norm "$FX/p-stop.json" /nonexistent | jq -c '.turn.files_edited')" "[]"

echo "claude normalize — turn extraction"
t="$(turn single-turn.jsonl)"
check_eq "Write -> created" "$(jq -c .files_created <<<"$t")" '["/proj/src/new.src"]'
check_eq "Edit/MultiEdit/NotebookEdit -> edited" "$(jq -c .files_edited <<<"$t")" '["/proj/src/old.src","/proj/src/multi.src","/proj/nb.ipynb"]'
check_eq "Bash -> shell_commands" "$(jq -c .shell_commands <<<"$t")" '["verify-it src/new.src"]'
check_eq "Skill -> skills_used" "$(jq -c .skills_used <<<"$t")" '["superpowers:test-driven-development"]'
check "assistant text captured" "$(jq -r .assistant_text <<<"$t")" has "All done ✅"
check_eq "skill expansion (isMeta) does not reset the turn" "$(jq -c .skills_used <<<"$t")" '["superpowers:test-driven-development"]'

t="$(turn prior-turn-edit.jsonl)"
check_eq "PRIOR turn's edit is NOT in this turn (measured false positive)" "$(jq -c .files_edited <<<"$t")" "[]"
check "only this turn's text" "$(jq -r .assistant_text <<<"$t")" has "Waiting for you."
check_eq "previous turn's 'fixed' excluded" "$(jq -r .assistant_text <<<"$t" | grep -c fixed)" "0"

check_eq "tool_result records do not reset the turn" "$(turn tool-results.jsonl | jq -c .files_edited)" '["/proj/a.src","/proj/b.src"]'
check_eq "NUL bytes tolerated" "$(turn nul-bytes.jsonl | jq -c .files_edited)" '["/proj/a.src"]'
check_eq "sidechain (subagent) records ignored" "$(turn sidechain.jsonl | jq -c .files_edited)" '["/proj/main.src"]'
check_eq "task notifications do not reset the turn" "$(turn notification.jsonl | jq -c .files_edited)" '["/proj/a.src","/proj/b.src"]'
t="$(turn compaction-mid-turn.jsonl)"
check_eq "compaction mid-turn does not reset the turn (created)" "$(jq -c .files_created <<<"$t")" '["/proj/imp.src"]'
check_eq "compaction mid-turn does not reset the turn (edited)" "$(jq -c .files_edited <<<"$t")" '["/proj/imp.src"]'
t="$(turn write-update-and-failed.jsonl)"
check_eq "Write over an existing file -> edited, not created (QC5)" "$(jq -c .files_created <<<"$t")" '["/proj/new.src"]'
check "Write over an existing file is listed as edited" "$(jq -c .files_edited <<<"$t")" has '"/proj/AI_SPEC/docs/foo/foo-story.md"'
check "a failed Edit is not counted" "$(jq -c .files_edited <<<"$t")" lacks "failed.src"
t="$(jq -c --arg tp "$FX/write-update-and-failed.jsonl" '.transcript_path=$tp | .last_assistant_message="All done ✅"' "$FX/p-stop.json" | CLAUDE_PROJECT_DIR=/proj "${IMPL[@]}" normalize | jq -c .turn)"
check "Stop payload last_assistant_message is included (live E2E miss)" "$(jq -r .assistant_text <<<"$t")" has "All done ✅"
check "transcript text still included" "$(jq -r .assistant_text <<<"$t")" has "Now I will update"
check_eq "unparseable lines skipped" "$(turn garbage-lines.jsonl | jq -c .files_edited)" '["/proj/a.src"]'

big="$(t_tmp)/big.jsonl"
{ jq -cn '{type:"user",message:{content:"go"}}'
  jq -cn '{type:"assistant",message:{content:[{type:"tool_use",id:"b1",name:"Edit",input:{file_path:"/proj/a.src"}}]}}'
  jq -cn '{type:"assistant",message:{content:[{type:"text",text:("y" * 400000)}]}}'; } > "$big"
check "the >128 KB fixture really is that big" "$(wc -c < "$big")" has "40"
check_eq "a >128 KB turn still produces turn_end (ARG_MAX)" "$(jq -c --arg tp "$big" '.transcript_path=$tp | .last_assistant_message=("z" * 300000)' "$FX/p-stop.json" | CLAUDE_PROJECT_DIR=/proj "${IMPL[@]}" normalize | jq -r '.event + " " + (.turn.files_edited|join(","))')" "turn_end /proj/a.src"

echo "claude normalize — ordered steps with exit codes (evidence ledger, live shapes 2026-10-11)"
st="$(turn steps.jsonl | jq -c '.steps')"
check_eq "steps: edit, pass, fail(exit 3), blocked, no result, write; failed edit dropped" "$st" \
  '[{"kind":"edit","file":"/proj/a.src","seq":1},{"kind":"cmd","cmd":"verify-it a","exit":0,"status":"ok","seq":2},{"kind":"cmd","cmd":"verify-it b","exit":3,"status":"failed","seq":3},{"kind":"cmd","cmd":"ls /x","exit":null,"status":"blocked","seq":4},{"kind":"cmd","cmd":"pending","exit":null,"status":"unknown","seq":5},{"kind":"edit","file":"/proj/b.src","seq":6}]'
AP="$(t_tmp)/approval.jsonl"
{ jq -cn '{type:"user",uuid:"u-ap",message:{content:"go"}}'
  jq -cn '{type:"assistant",message:{content:[{type:"tool_use",id:"p1",name:"Bash",input:{command:"verify-it a; echo \"$?\""}},{type:"tool_use",id:"p2",name:"Bash",input:{command:"rm -rf x"}}]}}'
  jq -cn '{type:"user",message:{content:[{type:"tool_result",tool_use_id:"p1",is_error:true,content:"This Bash command contains multiple operations. The following part requires approval: echo \"$?\""}]}}'
  jq -cn '{type:"user",message:{content:[{type:"tool_result",tool_use_id:"p2",is_error:true,content:"This command requires approval"}]}}'
  jq -cn '{type:"assistant",message:{content:[{type:"tool_use",id:"p3",name:"Bash",input:{command:"a; b"}},{type:"tool_use",id:"p4",name:"Bash",input:{command:"x=$(y)"}}]}}'
  jq -cn '{type:"user",message:{content:[{type:"tool_result",tool_use_id:"p3",is_error:true,content:"This Bash command contains multiple operations. The following parts require approval: a, b"}]}}'
  jq -cn '{type:"user",message:{content:[{type:"tool_result",tool_use_id:"p4",is_error:true,content:"A variable in this command can'"'"'t be checked before it runs"}]}}'; } > "$AP"
check_eq "refusal texts (live, 2.1.280: 'requires approval', 'parts require approval', 'can't be checked before it runs') -> blocked: never ran" "$(norm "$FX/p-stop.json" "$AP" | jq -c '[.turn.steps[] | .status]')" '["blocked","blocked","blocked","blocked"]'
check_eq "no transcript -> empty steps" "$(turn nonexistent.jsonl | jq -c '.steps')" "[]"
RJ="$(t_tmp)/rejected.jsonl"
{ jq -cn '{type:"user",uuid:"u-rj",message:{content:"go"}}'
  jq -cn '{type:"assistant",message:{content:[{type:"tool_use",id:"r1",name:"Bash",input:{command:"verify-it a"}}]}}'
  jq -cn '{type:"user",message:{content:[{type:"tool_result",tool_use_id:"r1",is_error:true,content:"The user doesn'"'"'t want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed."}]}}'; } > "$RJ"
check_eq "a command the user rejected never ran -> blocked, not failed" "$(norm "$FX/p-stop.json" "$RJ" | jq -c '[.turn.steps[] | .status]')" '["blocked"]'
ES="$(t_tmp)"; mkdir -p "$ES/s3/subagents"
{ jq -cn '{type:"user",uuid:"u-es",message:{content:"go"}}'
  jq -cn '{type:"assistant",message:{content:[{type:"tool_use",id:"e1",name:"Agent",input:{subagent_type:"",prompt:"x"}}]}}'
  jq -cn '{type:"user",toolUseResult:{agentId:"a333"},message:{content:[{type:"tool_result",tool_use_id:"e1",content:"done"}]}}'; } > "$ES/s3.jsonl"
{ jq -cn '{type:"user",isSidechain:true,agentId:"a333",message:{content:"x"}}'
  jq -cn '{type:"assistant",isSidechain:true,message:{content:[{type:"tool_use",id:"q1",name:"Bash",input:{command:"rm -rf /tmp/x"}}]}}'
  jq -cn '{type:"user",isSidechain:true,message:{content:[{type:"tool_result",tool_use_id:"q1",content:"ok"}]}}'; } > "$ES/s3/subagents/agent-a333.jsonl"
check_eq "an empty subagent_type still marks the steps as a subagent's" "$(norm "$FX/p-stop.json" "$ES/s3.jsonl" | jq -c '[.turn.steps[] | .by]')" '["subagent"]'
UT="$(t_tmp)/uuid.jsonl"
{ jq -cn '{type:"user",uuid:"u-old",message:{content:"earlier"}}'; jq -cn '{type:"user",uuid:"u-now",message:{content:"go"}}'
  jq -cn '{type:"assistant",uuid:"a1",message:{content:[{type:"text",text:"hi"}]}}'; } > "$UT"
ev="$(norm "$FX/p-stop.json" "$UT")"
check_eq "turn_id = uuid of this turn's prompt record (stable across re-audits)" "$(jq -r .turn_id <<<"$ev")" "u-now"
check_eq "session from the payload" "$(jq -r .session <<<"$ev")" "$(jq -r .session_id "$FX/p-stop.json")"
check "turn_key is not leaked into turn" "$(jq -c .turn <<<"$ev")" lacks "turn_key"

echo "claude emit"
check_eq "Stop output shape" "$(echo '{"message":"x"}' | "${IMPL[@]}" emit turn_end | jq -c .)" \
  '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"x"}}'
for pair in session_start:SessionStart prompt:UserPromptSubmit pre_shell:PreToolUse post_edit:PostToolUse; do
  check_eq "${pair%%:*} -> ${pair##*:}" "$(echo '{"message":"x"}' | "${IMPL[@]}" emit "${pair%%:*}" | jq -r .hookSpecificOutput.hookEventName)" "${pair##*:}"
done
check_eq "empty core output -> no output" "$(printf '' | "${IMPL[@]}" emit turn_end)" ""

echo "claude hook.sh — end to end"
P="$(t_tmp)"; mkdir -p "$P/.workflow"
printf '%s\n' "WF_CODE_REGEX='\\.src\$'" "WF_EVIDENCE_REGEX='^verify-it'" > "$P/.workflow/workflow.config"
e2e() { jq -c --arg tp "$FX/$2" --arg p "$P" '.transcript_path=$tp | .cwd=$p' "$FX/$1" | CLAUDE_PROJECT_DIR="$P" "${IMPL[@]}" hook "$3"; echo "rc=$?"; }
check "text-only turn after a code turn -> silent" "$(e2e p-stop.json prior-turn-edit.jsonl turn-audit)" lacks "GATE"
out="$(e2e p-stop.json tool-results.jsonl turn-audit)"
check "code + 'ok' (no claim) -> silent" "$out" lacks "VERIFICATION GATE"
check "single-turn with evidence -> silent" "$(e2e p-stop.json single-turn.jsonl turn-audit)" lacks "VERIFICATION GATE"
check "nul-bytes turn: code + claim + no evidence -> fires" "$(e2e p-stop.json nul-bytes.jsonl turn-audit)" has "VERIFICATION GATE"
check "session start -> gates in Claude shape" "$(e2e p-session.json single-turn.jsonl session-gates)" has '"hookEventName":"SessionStart"'
check "unknown core name -> rc 0, silent" "$(e2e p-session.json single-turn.jsonl no-such-check)" has "rc=0"
check "always rc 0" "$(e2e p-stop.json garbage-lines.jsonl turn-audit)" has "rc=0"
echo "claude — evidence ledger end to end"
st="$(turn steps-fail.jsonl | jq -c '[.steps[] | select(.kind=="cmd") | [.cmd,.exit,.status]]')"
check_eq "failed Bash -> exit 1 failed; background Bash -> background (not a result)" "$st" '[["verify-it a",1,"failed"],["verify-it b",null,"background"]]'
out="$(e2e p-stop.json steps-fail.jsonl turn-audit)"
check "each evidence command is judged by its own last run: verify-it a failed (a background run of another proves nothing)" "$out" has "verify-it a"
FT="$(t_tmp)/fail-only.jsonl"; sed -n '1,5p;8p' "$FX/steps-fail.jsonl" > "$FT"
out="$(jq -c --arg tp "$FT" --arg p "$P" '.transcript_path=$tp | .cwd=$p' "$FX/p-stop.json" | CLAUDE_PROJECT_DIR="$P" "${IMPL[@]}" hook turn-audit)"
check "a failed evidence run reaches the precise message on Claude" "$out" has "failed (exit 1)"
echo "claude — subagent steps (a delegated build is evidence too)"
# Live layout (Claude Code 2.1.280): <session>.jsonl + <session>/subagents/agent-<id>.jsonl, the id in
# the Agent tool_result's toolUseResult.agentId and in agent-<id>.meta.json {"toolUseId": ...}.
SD="$(t_tmp)"; mkdir -p "$SD/s1/subagents"
{ jq -cn '{type:"user",uuid:"u-sa",message:{content:"build it"}}'
  jq -cn '{type:"assistant",message:{content:[{type:"tool_use",id:"ag1",name:"Agent",input:{subagent_type:"burhan-builder",prompt:"sub-unit 1"}}]}}'
  jq -cn '{type:"user",toolUseResult:{agentId:"a111",agentType:"burhan-builder",status:"completed"},message:{content:[{type:"tool_result",tool_use_id:"ag1",content:"built"}]}}'
  jq -cn '{type:"assistant",message:{content:[{type:"tool_use",id:"ag2",name:"Agent",input:{subagent_type:"burhan-reviewer",prompt:"review"}}]}}'
  jq -cn '{type:"user",message:{content:[{type:"tool_result",tool_use_id:"ag2",content:"reviewed"}]}}'
  jq -cn '{type:"assistant",message:{content:[{type:"tool_use",id:"ag3",name:"Agent",input:{subagent_type:"ghost",prompt:"x"}}]}}'
  jq -cn '{type:"user",toolUseResult:{agentId:"a999"},message:{content:[{type:"tool_result",tool_use_id:"ag3",content:"?"}]}}'
  jq -cn '{type:"assistant",message:{content:[{type:"text",text:"Sub-unit 1 is done ✅"}]}}'; } > "$SD/s1.jsonl"
{ jq -cn '{type:"user",isSidechain:true,agentId:"a111",message:{content:"sub-unit 1"}}'
  jq -cn '{type:"assistant",isSidechain:true,message:{content:[{type:"tool_use",id:"s1",name:"Write",input:{file_path:"/proj/t.test"}}]}}'
  jq -cn '{type:"user",isSidechain:true,toolUseResult:{type:"create"},message:{content:[{type:"tool_result",tool_use_id:"s1",content:"ok"}]}}'
  jq -cn '{type:"assistant",isSidechain:true,message:{content:[{type:"tool_use",id:"s2",name:"Bash",input:{command:"verify-it a"}}]}}'
  jq -cn '{type:"user",isSidechain:true,message:{content:[{type:"tool_result",tool_use_id:"s2",is_error:true,content:"Exit code 1\nnot found"}]}}'
  jq -cn '{type:"assistant",isSidechain:true,message:{content:[{type:"tool_use",id:"s3",name:"Edit",input:{file_path:"/proj/a.src"}}]}}'
  jq -cn '{type:"user",isSidechain:true,message:{content:[{type:"tool_result",tool_use_id:"s3",content:"ok"}]}}'
  jq -cn '{type:"assistant",isSidechain:true,message:{content:[{type:"tool_use",id:"s4",name:"Bash",input:{command:"verify-it a"}}]}}'
  jq -cn '{type:"user",isSidechain:true,message:{content:[{type:"tool_result",tool_use_id:"s4",is_error:false,content:"ok"}]}}'; } > "$SD/s1/subagents/agent-a111.jsonl"
# The reviewer's result carries no agentId: found through its meta file instead.
jq -cn '{agentType:"burhan-reviewer",toolUseId:"ag2"}' > "$SD/s1/subagents/agent-a222.meta.json"
{ jq -cn '{type:"assistant",isSidechain:true,message:{content:[{type:"tool_use",id:"r1",name:"Bash",input:{command:"verify-it a"}}]}}'
  jq -cn '{type:"user",isSidechain:true,message:{content:[{type:"tool_result",tool_use_id:"r1",content:"ok"}]}}'; } > "$SD/s1/subagents/agent-a222.jsonl"
sa="$(norm "$FX/p-stop.json" "$SD/s1.jsonl")"
check_eq "an Agent call is replaced by the subagent's own ordered steps, tagged by its type" \
  "$(jq -c '[.turn.steps[] | [.seq, .kind, (.file // .cmd), .status, .by]]' <<<"$sa")" \
  '[[1,"edit","/proj/t.test",null,"burhan-builder"],[2,"cmd","verify-it a","failed","burhan-builder"],[3,"edit","/proj/a.src",null,"burhan-builder"],[4,"cmd","verify-it a","ok","burhan-builder"],[5,"cmd","verify-it a","ok","burhan-reviewer"]]'
check_eq "a subagent with no transcript (a999) adds nothing and breaks nothing" "$(jq -r .event <<<"$sa")" "turn_end"
check_eq "written files stay the main agent's own (checks B-H judge the main turn)" "$(jq -c '[.turn.files_created, .turn.files_edited]' <<<"$sa")" '[[],[]]'
check_eq "a main-agent step carries no 'by'" "$(turn steps.jsonl | jq -c '[.steps[] | has("by")] | unique')" '[false]'
sae() { jq -c --arg tp "$1" --arg p "$P" '.transcript_path=$tp | .cwd=$p' "$FX/p-stop.json" | CLAUDE_PROJECT_DIR="$P" "${IMPL[@]}" hook turn-audit; }
check "delegated build + passing evidence after its last edit + 'done' -> silent" "$(sae "$SD/s1.jsonl")" lacks "VERIFICATION GATE"
mkdir -p "$SD/s2/subagents"
sed -n '1,3p;8p' "$SD/s1.jsonl" > "$SD/s2.jsonl"
sed -n '1,7p' "$SD/s1/subagents/agent-a111.jsonl" > "$SD/s2/subagents/agent-a111.jsonl"
check "delegated code edit with no evidence after it + 'done' -> fires (was silent: the edit was invisible)" "$(sae "$SD/s2.jsonl")" has "ran before the last code edit"
EV="$(t_tmp)"
printf '%s\n' "WF_EVIDENCE_DIR='$EV'" >> "$P/.workflow/workflow.config"
sae "$SD/s1.jsonl" >/dev/null
check_eq "the ledger records who ran each step" \
  "$(cat "$EV"/*/*/u-sa.jsonl 2>/dev/null | jq -r '.by // "main"' | paste -sd, -)" \
  "burhan-builder,burhan-builder,burhan-builder,burhan-builder,burhan-reviewer"

echo "claude — subagent steps: robustness"
# A >128 KB subagent transcript: its steps still arrive (values go through files, never argv).
mkdir -p "$SD/big/subagents"
{ jq -cn '{type:"user",uuid:"u-big",message:{content:"go"}}'
  jq -cn '{type:"assistant",message:{content:[{type:"tool_use",id:"gb",name:"Agent",input:{subagent_type:"burhan-builder",prompt:"x"}}]}}'
  jq -cn '{type:"user",toolUseResult:{agentId:"abig"},message:{content:[{type:"tool_result",tool_use_id:"gb",content:"ok"}]}}'; } > "$SD/big.jsonl"
{ jq -cn '{type:"assistant",isSidechain:true,message:{content:[{type:"tool_use",id:"b0",name:"Edit",input:{file_path:"/proj/a.src"}}]}}'
  for k in $(seq 1 60); do jq -cn --arg k "$k" '{type:"assistant",isSidechain:true,message:{content:[{type:"tool_use",id:("c"+$k),name:"Bash",input:{command:("verify-it " + ("z" * 3000))}}]}}'; done; } > "$SD/big/subagents/agent-abig.jsonl"
check_eq "a >128 KB subagent transcript keeps all its steps (ARG_MAX, #1)" "$(norm "$FX/p-stop.json" "$SD/big.jsonl" | jq -c '[(.turn.steps | length), .turn.steps[0].file]')" '[61,"/proj/a.src"]'
# Many agents: no placeholder ever reaches the event (or the ledger).
mkdir -p "$SD/many/subagents"
{ jq -cn '{type:"user",uuid:"u-many",message:{content:"go"}}'
  for k in $(seq 1 40); do
    jq -cn --arg k "$k" '{type:"assistant",message:{content:[{type:"tool_use",id:("m"+$k),name:"Agent",input:{subagent_type:"burhan-explorer",prompt:"x"}}]}}'
    jq -cn --arg k "$k" '{type:"user",toolUseResult:{agentId:("am"+$k)},message:{content:[{type:"tool_result",tool_use_id:("m"+$k),content:"ok"}]}}'
    jq -cn '{type:"assistant",isSidechain:true,message:{content:[{type:"tool_use",id:"q",name:"Bash",input:{command:("cat " + ("f" * 4000))}}]}}' > "$SD/many/subagents/agent-am$k.jsonl"
  done; } > "$SD/many.jsonl"
check_eq "40 agents x 4 KB: every step spliced, no agent placeholder left" "$(norm "$FX/p-stop.json" "$SD/many.jsonl" | jq -c '[(.turn.steps | length), ([.turn.steps[] | select(.kind == "agent")] | length)]')" '[40,0]'
# A background (async) agent ran alongside and after the rest of the turn: its steps go last.
mkdir -p "$SD/bg/subagents"
{ jq -cn '{type:"user",uuid:"u-bg",message:{content:"go"}}'
  jq -cn '{type:"assistant",message:{content:[{type:"tool_use",id:"g1",name:"Agent",input:{subagent_type:"burhan-builder",prompt:"x"}}]}}'
  jq -cn '{type:"user",toolUseResult:{isAsync:true,status:"async_launched",agentId:"abg"},message:{content:[{type:"tool_result",tool_use_id:"g1",content:"launched"}]}}'
  jq -cn '{type:"assistant",message:{content:[{type:"tool_use",id:"t1",name:"Bash",input:{command:"verify-it a"}}]}}'
  jq -cn '{type:"user",message:{content:[{type:"tool_result",tool_use_id:"t1",content:"ok"}]}}'
  jq -cn '{type:"assistant",message:{content:[{type:"text",text:"All done ✅"}]}}'; } > "$SD/bg.jsonl"
jq -cn '{type:"assistant",isSidechain:true,message:{content:[{type:"tool_use",id:"e",name:"Edit",input:{file_path:"/proj/a.src"}}]}}' > "$SD/bg/subagents/agent-abg.jsonl"
check_eq "a background agent's steps come after the main turn's (live: isAsync / async_launched, #2)" \
  "$(norm "$FX/p-stop.json" "$SD/bg.jsonl" | jq -c '[.turn.steps[] | [.seq, .kind, .by]]')" '[[1,"cmd",null],[2,"edit","burhan-builder"]]'
check "...so 'done' after a test that ran before the background edit fires" "$(sae "$SD/bg.jsonl")" has "ran before the last code edit"
# With timestamps (live shape): the main agent waits for the background builder, then re-runs the test.
mkdir -p "$SD/bgt/subagents"
{ jq -cn '{type:"user",uuid:"u-bgt",timestamp:"2026-10-12T10:00:00Z",message:{content:"go"}}'
  jq -cn '{type:"assistant",timestamp:"2026-10-12T10:00:01Z",message:{content:[{type:"tool_use",id:"g1",name:"Agent",input:{subagent_type:"burhan-builder",prompt:"x"}}]}}'
  jq -cn '{type:"user",timestamp:"2026-10-12T10:00:02Z",toolUseResult:{isAsync:true,status:"async_launched",agentId:"abgt"},message:{content:[{type:"tool_result",tool_use_id:"g1",content:"launched"}]}}'
  jq -cn '{type:"assistant",timestamp:"2026-10-12T10:05:00Z",message:{content:[{type:"tool_use",id:"t1",name:"Bash",input:{command:"verify-it a"}}]}}'
  jq -cn '{type:"user",timestamp:"2026-10-12T10:05:01Z",message:{content:[{type:"tool_result",tool_use_id:"t1",content:"ok"}]}}'
  jq -cn '{type:"assistant",timestamp:"2026-10-12T10:05:02Z",message:{content:[{type:"text",text:"All done ✅"}]}}'; } > "$SD/bgt.jsonl"
{ jq -cn '{type:"assistant",isSidechain:true,timestamp:"2026-10-12T10:01:00Z",message:{content:[{type:"tool_use",id:"w",name:"Write",input:{file_path:"/proj/t.test"}}]}}'
  jq -cn '{type:"assistant",isSidechain:true,timestamp:"2026-10-12T10:02:00Z",message:{content:[{type:"tool_use",id:"e",name:"Edit",input:{file_path:"/proj/a.src"}}]}}'; } > "$SD/bgt/subagents/agent-abgt.jsonl"
check_eq "background steps are merged by timestamp: test file, code, then the main re-run" \
  "$(norm "$FX/p-stop.json" "$SD/bgt.jsonl" | jq -c '[.turn.steps[] | [.kind, (.file // .cmd)]]')" '[["edit","/proj/t.test"],["edit","/proj/a.src"],["cmd","verify-it a"]]'
check "...and no internal timestamp leaks into the steps" "$(norm "$FX/p-stop.json" "$SD/bgt.jsonl" | jq -c '.turn.steps')" lacks "_ts"
check "...so the re-run after the background edit proves it -> silent" "$(sae "$SD/bgt.jsonl")" lacks "VERIFICATION GATE"
# A truncated meta file breaks nothing for the others.
mkdir -p "$SD/tm/subagents"
{ jq -cn '{type:"user",uuid:"u-tm",message:{content:"go"}}'
  jq -cn '{type:"assistant",message:{content:[{type:"tool_use",id:"k1",name:"Agent",input:{subagent_type:"burhan-explorer",prompt:"x"}}]}}'
  jq -cn '{type:"user",message:{content:[{type:"tool_result",tool_use_id:"k1",content:"ok"}]}}'; } > "$SD/tm.jsonl"
printf '{"toolUseId":"k' > "$SD/tm/subagents/agent-a0.meta.json"
jq -cn '{toolUseId:"k1"}' > "$SD/tm/subagents/agent-a1.meta.json"
jq -cn '{type:"assistant",isSidechain:true,message:{content:[{type:"tool_use",id:"q",name:"Bash",input:{command:"ls"}}]}}' > "$SD/tm/subagents/agent-a1.jsonl"
check_eq "a truncated meta file does not hide the next one" "$(norm "$FX/p-stop.json" "$SD/tm.jsonl" | jq -c '[.turn.steps[].cmd]')" '["ls"]'
# One malformed agentId breaks nothing else; "by" is one clean line.
mkdir -p "$SD/bad/subagents"
{ jq -cn '{type:"user",uuid:"u-bad",message:{content:"go"}}'
  jq -cn '{type:"assistant",message:{content:[{type:"tool_use",id:"x1",name:"Agent",input:{subagent_type:"weird",prompt:"x"}},{type:"tool_use",id:"x2",name:"Agent",input:{subagent_type:"bur\thue\nx",prompt:"y"}}]}}'
  jq -cn '{type:"user",toolUseResult:{agentId:{"o":1}},message:{content:[{type:"tool_result",tool_use_id:"x1",content:"?"}]}}'
  jq -cn '{type:"user",toolUseResult:{agentId:"agood"},message:{content:[{type:"tool_result",tool_use_id:"x2",content:"ok"}]}}'; } > "$SD/bad.jsonl"
jq -cn '{type:"assistant",isSidechain:true,message:{content:[{type:"tool_use",id:"k",name:"Bash",input:{command:"OKCMD"}}]}}' > "$SD/bad/subagents/agent-agood.jsonl"
check_eq "a malformed agentId drops only that agent; 'by' is one line" \
  "$(norm "$FX/p-stop.json" "$SD/bad.jsonl" | jq -c '[.turn.steps[] | [.cmd, .by]]')" '[["OKCMD","bur hue x"]]'
# The meta fallback is one pass over the meta files, not one per agent per meta.
mkdir -p "$SD/meta/subagents"
{ jq -cn '{type:"user",uuid:"u-meta",message:{content:"go"}}'
  for k in $(seq 1 60); do
    jq -cn --arg k "$k" '{type:"assistant",message:{content:[{type:"tool_use",id:("t"+$k),name:"Agent",input:{subagent_type:"burhan-explorer",prompt:"x"}}]}}'
    jq -cn --arg k "$k" '{type:"user",message:{content:[{type:"tool_result",tool_use_id:("t"+$k),content:"ok"}]}}'
    jq -cn --arg k "$k" '{toolUseId:("t"+$k)}' > "$SD/meta/subagents/agent-mt$k.meta.json"
    jq -cn --arg k "$k" '{type:"assistant",isSidechain:true,message:{content:[{type:"tool_use",id:"q",name:"Bash",input:{command:("ls " + $k)}}]}}' > "$SD/meta/subagents/agent-mt$k.jsonl"
  done; } > "$SD/meta.jsonl"
t0=$(date +%s)
n="$(norm "$FX/p-stop.json" "$SD/meta.jsonl" | jq '.turn.steps | length')"
t1=$(date +%s)
check_eq "60 agents found through their meta files" "$n" "60"
check_eq "...within the Stop hook's time budget (< 8 s here)" "$( [ $((t1 - t0)) -lt 8 ] && echo fast || echo "slow: $((t1 - t0)) s")" "fast"

echo "claude settings snippet"
SN="$A/settings.snippet.json"
check_eq "valid JSON" "$(jq -e . "$SN" >/dev/null && echo ok)" "ok"
for c in session-gates prompt-router pre-commit-check post-edit-reminder turn-audit; do
  check "wires $c" "$(jq -r '.. | .command? // empty' "$SN")" has "hook.sh\" $c"
  check "$c script exists" "$( [ -f "$T_KIT/hooks/core/$c.sh" ] && echo yes)" has yes
done
check "paths are project-relative" "$(cat "$SN")" lacks "$HOME/"
check "pre-commit timeout exceeds the default check timeout" "$(jq '.hooks.PreToolUse[0].hooks[0].timeout > 60' "$SN")" has "true"
t_summary
