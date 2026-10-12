#!/usr/bin/env bash
# Claude Code hook payload (stdin) -> normalized event (stdout), or nothing if the event is not one
# the core handles. For Stop, the turn is read from the transcript and covers ONLY the current turn:
# everything after the last real user prompt. A fixed line window is wrong — it reaches back into
# earlier turns (measured false positive in a real session).
#
# Transcript shapes this relies on (verified against real Claude Code transcripts, 2026-10-11):
#   real prompt      {"type":"user", "message":{"content":"<string>"}}  (or text/image parts, no tool_result)
#   tool result      {"type":"user", "message":{"content":[{"type":"tool_result",...}]}}   — not a prompt
#   skill expansion  {"type":"user", "isMeta":true, ...}                                    — not a prompt
#   compaction       {"type":"user", "isCompactSummary":true, ...} (can happen mid-turn)      — not a prompt
#   subagent record  {"isSidechain":true, ...}  — not part of the main turn; a subagent's steps come from
#                    <session>/subagents/agent-<id>.jsonl (with_subagent_steps)
#   tool call        {"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{...}}]}}
set +e
payload="$(cat 2>/dev/null)"
printf '%s' "$payload" | jq -e 'type == "object"' >/dev/null 2>&1 || exit 0

j() { printf '%s' "$payload" | jq -r "($1) // empty" 2>/dev/null; }
name="$(j .hook_event_name)"
proj="${CLAUDE_PROJECT_DIR:-$(j .cwd)}"
tool="$(j .tool_name)"

base() {
  jq -cn --arg e "$1" --arg p "$proj" --arg s "$(j .session_id)" '{event:$e, agent:"claude", project_dir:$p, session:$s, turn_id:"", turn_scope:"whole", prompt:"", command:"", file:"",
    turn:{files_created:[],files_edited:[],shell_commands:[],skills_used:[],assistant_text:"",steps:[]}, reentrant:false}'
}

# Shared by the main turn and by subagent transcripts (same record shapes).
#   results: tool_use_id -> {err, kind (Write create/update), text, agent (an Agent call's subagent id)}
#   steps:   ordered edit/cmd steps for the evidence ledger. Exit codes as Claude reports them (live,
#            2026-10-11): success -> is_error false (exit 0); failure -> is_error true, "Exit code N"; a
#            call refused by permissions -> is_error true, "... was blocked ...", "... require(s) approval",
#            "... can't be checked before it runs" (never ran: blocked); no result yet -> unknown.
#            An Agent/Task call becomes a placeholder {kind:"agent"}, replaced by the subagent's own steps.
JQ_DEFS='
  def results:
    [ .[] | select(.type == "user") as $u
      | ($u.message.content | if type == "array" then .[] else empty end) | objects
      | select(.type == "tool_result")
      | { key: (.tool_use_id // "" | tostring),
          value: { err: (.is_error == true),
                   kind: (($u.toolUseResult | objects | .type) // null),
                   agent: (($u.toolUseResult | objects | .agentId | strings) // null),
                   async: ((($u.toolUseResult | objects | .isAsync) // false) == true
                           or (($u.toolUseResult | objects | .status) // "") == "async_launched"),
                   text: (.content | if type == "string" then .
                                     elif type == "array" then (map(objects | .text // "") | join("\n"))
                                     else "" end) } } ]
    | from_entries;
  def steps($parts; $res):
    [ $parts[] | select(.type == "tool_use") | ._ts as $ts | ($res[(.id // "")]) as $r
      | (if (.name == "Write" or .name == "Edit" or .name == "MultiEdit" or .name == "NotebookEdit") then
          (if ($r.err // false) then empty
           else {kind: "edit", file: (.input.file_path // .input.notebook_path // "")} end)
        elif .name == "Bash" then
          {kind: "cmd", cmd: (.input.command // "")}
          + ( if (.input.run_in_background // false) == true then {exit: null, status: "background"}
              elif $r == null then {exit: null, status: "unknown"}
              elif ($r.err | not) then {exit: 0, status: "ok"}
              elif (($r.text // "") | test("^\\s*(Error: )?Exit code [0-9]+")) then
                {exit: (($r.text // "") | capture("Exit code (?<n>[0-9]+)").n | tonumber), status: "failed"}
              elif (($r.text // "") | test("was blocked|requires? approval|can.t be checked before it runs|denied|not allowed|permission|tool use was rejected|doesn.t want to proceed"; "i")) then {exit: null, status: "blocked"}
              else {exit: null, status: "failed"} end )
        elif (.name == "Agent" or .name == "Task") then
          {kind: "agent", tool_id: (.id // "" | tostring), agent_id: ($r.agent // null),
           async: (($r.async // false) or ((.input.run_in_background // false) == true)),
           by: (.input.subagent_type // "" | tostring | gsub("[\t\n\r]"; " ") | if test("^\\s*$") then "subagent" else . end)}
        else empty end) | . + {_ts: $ts} ]
    | to_entries | map(.value + {seq: (.key + 1)});
  def tool_parts: [ .[] | select(.type == "assistant") | .timestamp as $t | .message.content[]? | objects | . + {_ts: $t} ];'

# records <transcript> -> its last 20000 parseable JSON object lines (NULs and garbage dropped)
records() { tail -n 20000 "$1" 2>/dev/null | tr -d '\000' | jq -c -R 'fromjson? | select(type=="object")' 2>/dev/null; }

# with_subagent_steps <turn-json> <subagents-dir> -> the turn with every Agent placeholder replaced by
# that subagent's steps (tagged "by": its type) and seq renumbered. A delegated build is part of the
# turn's evidence: without this, a builder's red/green runs and its code edits are invisible (measured
# in a live run). The subagent transcript is found by the result's agentId, else by agent-*.meta.json
# {"toolUseId"} (live layout, Claude Code 2.1.280; read in one pass). A background agent (isAsync /
# async_launched) ran alongside and after the rest of the turn, so its steps go last, never at its
# launch point. One level deep; a missing transcript adds nothing; no placeholder ever survives.
# Values go through files, never argv (ARG_MAX).
with_subagent_steps() {
  local dir="$2" w tid aid f m
  w="$(mktemp -d 2>/dev/null)" || { printf '%s' "$1" | jq -c "$STRIP_AGENTS" 2>/dev/null; return; }
  printf '%s' "$1" > "$w/turn"
  if ! jq -e '[.steps[]? | select(.kind == "agent")] | length > 0' "$w/turn" >/dev/null 2>&1; then
    cat "$w/turn"; rm -rf "$w"; return
  fi
  : > "$w/meta"; : > "$w/subs"
  if [ -d "$dir" ]; then
    # One jq pass over all meta files (fast); if any file is broken, one jq per file instead, so a
    # truncated file never hides the ones after it.
    local metas=("$dir"/agent-*.meta.json)
    if [ -e "${metas[0]}" ] && ! jq -r '[input_filename, (.toolUseId // "" | strings)] | @tsv' "${metas[@]}" > "$w/meta" 2>/dev/null; then
      : > "$w/meta"
      for m in "${metas[@]}"; do
        jq -r --arg f "$m" '[$f, (.toolUseId // "" | strings)] | @tsv' "$m" >> "$w/meta" 2>/dev/null
      done
    fi
  fi
  jq -r '.steps[]? | select(.kind == "agent") | [(.tool_id // "" | strings), ((.agent_id // "") | strings)] | @tsv' "$w/turn" 2>/dev/null > "$w/agents"
  while IFS=$'\t' read -r tid aid; do
    [ -n "$tid" ] || continue
    f=""
    case "$aid" in ''|*[!A-Za-z0-9_-]*) ;; *) [ -f "$dir/agent-$aid.jsonl" ] && f="$dir/agent-$aid.jsonl" ;; esac
    if [ -z "$f" ]; then
      m="$(awk -F'\t' -v t="$tid" '$2 == t { print $1; exit }' "$w/meta")"
      [ -n "$m" ] && f="${m%.meta.json}.jsonl"
    fi
    [ -n "$f" ] && [ -f "$f" ] || continue
    records "$f" | jq -c -s --arg k "$tid" "$JQ_DEFS"'
      tool_parts as $p
      | {key: $k, value: (steps($p; results) | map(select(.kind != "agent")))}' >> "$w/subs" 2>/dev/null
  done < "$w/agents"
  jq -c --slurpfile subs "$w/subs" '
    ($subs | from_entries) as $m
    | def expand: .by as $b | ($m[.tool_id] // [])[] | . + {by: $b};
    .steps as $s
    | ( [ $s[] | if .kind != "agent" then . elif .async then empty else expand end ]
        + [ $s[] | select(.kind == "agent" and .async) | expand ] ) as $all
    # With timestamps on every step (live transcripts carry them), merge by time — a background
    # agent ran alongside the main turn. Without, its steps go last.
    | .steps = ( (if ($all | all(._ts != null)) then ($all | sort_by(._ts)) else $all end)
                 | to_entries | map(.value + {seq: (.key + 1)}) )' "$w/turn" 2>/dev/null \
    || jq -c "$STRIP_AGENTS" "$w/turn" 2>/dev/null || cat "$w/turn"
  rm -rf "$w"
}
# Drops agent placeholders and renumbers: the fallback when the subagent splice cannot be done.
STRIP_AGENTS='.steps = ([.steps[]? | select(.kind != "agent")] | to_entries | map(.value + {seq: (.key + 1)}))'

case "$name" in
  SessionStart) base session_start ;;
  UserPromptSubmit) printf '%s' "$payload" | jq -c --argjson b "$(base prompt)" '$b + {prompt: (.prompt // "")}' ;;
  PreToolUse)
    [ "$tool" = Bash ] || exit 0
    printf '%s' "$payload" | jq -c --argjson b "$(base pre_shell)" '$b + {command: (.tool_input.command // "")}' ;;
  PostToolUse)
    case "$tool" in Write|Edit|MultiEdit|NotebookEdit) ;; *) exit 0 ;; esac
    f="$(j '.tool_input.file_path // .tool_input.notebook_path // .tool_response.filePath')"
    base post_edit | jq -c --arg v "$f" '.file = $v' ;;
  Stop|SubagentStop)
    [ "$name" = SubagentStop ] && exit 0
    tp="$(j .transcript_path)"
    re="$(printf '%s' "$payload" | jq -r '.stop_hook_active == true')"
    turn='{}'
    if [ -n "$tp" ] && [ -f "$tp" ]; then
      turn="$(records "$tp" | jq -c -s "$JQ_DEFS"'
          def prompt_like:
            .type == "user" and (.isMeta != true) and (.isSidechain != true) and (.isCompactSummary != true) and
            ( (.message.content | type) as $t
              | if $t == "string" then (.message.content | test("^\\s*<task-notification>") | not)
                elif $t == "array" then
                  ([.message.content[].type] | (index("tool_result") == null) and (any(. == "text" or . == "image")))
                else false end );
          . as $r
          | ([range(0; length) | select($r[.] | prompt_like)] | last // -1) as $i
          | [ $r[($i + 1):][] | select(.isSidechain != true) ] as $turn
          | (if $i >= 0 then ($r[$i].uuid // "") else "" end) as $turn_key
          | ($turn | tool_parts) as $parts
          | ($turn | results) as $res
          | [ $parts[] | select(.type == "tool_use") | select(($res[(.id // "")].err // false) | not) ] as $tools
          | { files_created:  [ $tools[] | select(.name == "Write" and ($res[(.id // "")].kind // "create") != "update")
                                | .input.file_path // empty ],
              files_edited:   [ $tools[] | select(.name == "Edit" or .name == "MultiEdit" or .name == "NotebookEdit"
                                                  or (.name == "Write" and $res[(.id // "")].kind == "update"))
                                | .input.file_path // .input.notebook_path // empty ],
              shell_commands: [ $tools[] | select(.name == "Bash") | .input.command // empty ],
              skills_used:    [ $tools[] | select(.name == "Skill") | .input.skill // empty ],
              assistant_text: ([ $parts[] | select(.type == "text") | .text ] | join("\n")),
              steps:          steps($parts; $res),
              turn_key:       $turn_key }' 2>/dev/null)"
      [ -n "$turn" ] || turn='{}'
      turn="$(with_subagent_steps "$turn" "${tp%.jsonl}/subagents")"
    fi
    # The Stop payload carries the final message; at Stop time it may not be in the transcript yet
    # (measured in a live run, 2026-10-11) — and that is where completion claims usually are.
    # Large values go through files, never argv: a long turn would exceed ARG_MAX and drop the audit.
    tmpd="$(mktemp -d)" || exit 0
    printf '%s' "$turn" > "$tmpd/turn.json"
    printf '%s' "$payload" | jq -j '.last_assistant_message // ""' > "$tmpd/last.txt" 2>/dev/null
    base turn_end | jq -c --slurpfile t "$tmpd/turn.json" --rawfile l "$tmpd/last.txt" --argjson r "${re:-false}" '
      .turn += $t[0] | .reentrant = $r
      | .turn.steps = [ (.turn.steps // [])[] | del(._ts) ]
      | .turn_id = (.turn.turn_key // "") | del(.turn.turn_key)
      | if $l == "" then . else
          .turn.assistant_text = (((.turn.assistant_text // "") | if endswith($l) then . else . + "\n" + $l end) | ltrimstr("\n"))
        end'
    rm -rf "$tmpd" ;;
  *) exit 0 ;;
esac
exit 0
