#!/usr/bin/env bash
# Codex hook payload (stdin) -> normalized event(s) (stdout, one JSON object per line).
#
# Measured on Codex 0.150.1 (2026-10-11; fixtures in tests/adapters/codex/fixtures):
#   - payloads mirror Claude's: hook_event_name, cwd, prompt, tool_name, tool_input, stop_hook_active,
#     plus session_id + turn_id on every event and last_assistant_message on Stop;
#   - file edits arrive as tool_name "apply_patch"; the paths live in the patch text
#     ("*** Add File: p", "*** Update File: p", "*** Delete File: p", "*** Move to: p");
#   - the rollout transcript records tool work as JavaScript `exec` cells — not parsed here. Instead,
#     hook.sh records every PostToolUse into a per-turn ledger, and Stop reads exactly that turn.
#   - exit codes (measured live 2026-10-11): a Bash PostToolUse carries the output only — no exit code,
#     even for a failing command. The rollout transcript has them: event_msg/item_completed items of
#     type CommandExecution, whose `id` equals the hook's tool_use_id, with `exit_code` and `status`.
#     apply_patch responses start with "Exit code: N".
set +e
payload="$(cat 2>/dev/null)"
printf '%s' "$payload" | jq -e 'type == "object"' >/dev/null 2>&1 || exit 0
j() { printf '%s' "$payload" | jq -r "($1) // empty" 2>/dev/null; }
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/ledger.sh"

name="$(j .hook_event_name)"; tool="$(j .tool_name)"; proj="${WF_PROJECT_ROOT:-$(j .cwd)}"

base() {
  jq -cn --arg e "$1" --arg p "$proj" --arg s "$(j .session_id)" --arg t "$(j .turn_id)" '{event:$e, agent:"codex", project_dir:$p, session:$s, turn_id:$t, turn_scope:"since_last_stop", prompt:"", command:"", file:"",
    turn:{files_created:[],files_edited:[],shell_commands:[],skills_used:[],assistant_text:"",steps:[]}, reentrant:false}'
}

# patch_files — apply_patch bodies on stdin -> "A<TAB>path" (file now exists, new) / "E<TAB>path"
# (existing file changed), in patch order. "Update p" + "Move to q" -> A q. Deletes -> nothing.
# Headers are only at column 0; content lines start with + - or space, so they never match.
patch_files() {
  tr -d '\r' | awk '
    function flush() { if (pend != "") print pend; pend = "" }
    /^\*\*\* Add File: /    { flush(); print "A\t" substr($0, 15); next }
    /^\*\*\* Update File: / { flush(); pend = "E\t" substr($0, 18); next }
    /^\*\*\* Move to: /     { pend = "A\t" substr($0, 14); next }
    /^\*\*\* /              { flush() }
    END                     { flush() }' | awk 'NF && !seen[$0]++'
}
as_json() { awk 'NF' | jq -R . | jq -cs .; }

# skill_ids — shell commands on stdin -> skill ids for every SKILL.md they read
#   .../plugins/cache/<market>/<plugin>/<ver>/skills/<n>/SKILL.md -> <plugin>:<n>
#   .../superpowers/skills/<n>/SKILL.md, .../skills/superpowers/<n>/SKILL.md -> superpowers:<n>
#   anything else .../<n>/SKILL.md -> <n>
skill_ids() {
  grep -o -E "[^[:space:]\"']*/SKILL\.md" | sed -E '
    s#.*/plugins/cache/[^/]+/([^/]+)/[^/]+/skills/([^/]+)/SKILL\.md$#\1:\2#; t
    s#.*/superpowers/skills/([^/]+)/SKILL\.md$#superpowers:\1#; t
    s#.*/skills/superpowers/([^/]+)/SKILL\.md$#superpowers:\1#; t
    s#.*/([^/]+)/SKILL\.md$#\1#' | awk 'NF && !seen[$0]++'
}

# rollout_exits <transcript> -> {"<tool_use_id>": {"exit": N|null, "status": "..."}} from the rollout's
# CommandExecution items ({} if the file is missing or unreadable — exits then stay unknown).
rollout_exits() {
  [ -n "$1" ] && [ -f "$1" ] || { printf '{}'; return; }
  grep -F '"CommandExecution"' "$1" 2>/dev/null | tr -d '\000' | jq -c -R 'fromjson?
      | select(.type == "event_msg" and .payload.type == "item_completed" and .payload.item.type == "CommandExecution")
      | {key: (.payload.item.id // "" | tostring), value: {exit: .payload.item.exit_code, status: .payload.item.status}}' 2>/dev/null \
    | jq -cs 'from_entries' 2>/dev/null || printf '{}'
}

# ordered_steps <transcript> — ledger records (stdin, in call order) -> the turn's steps, in ONE jq pass:
# edits from applied patches (a patch whose response was "Exit code: N", N != 0, changed nothing) and
# commands with the exit code the rollout recorded for their tool_use_id. The patch headers are parsed
# with the same rules as patch_files (Add · Update · Update + Move to → the new path · Delete → nothing).
ordered_steps() {
  local tmpd; tmpd="$(mktemp -d)" || { printf '[]'; return; }
  rollout_exits "$1" > "$tmpd/exits.json"; [ -s "$tmpd/exits.json" ] || printf '{}' > "$tmpd/exits.json"
  jq -cs --slurpfile x "$tmpd/exits.json" '
    def patch_files:
      (gsub("\r"; "") | split("\n"))
      | reduce .[] as $l ({out: [], pend: null};
          if ($l | startswith("*** Add File: ")) then .out += ([.pend] | map(select(. != null))) + [$l[14:]] | .pend = null
          elif ($l | startswith("*** Update File: ")) then .out += ([.pend] | map(select(. != null))) | .pend = $l[17:]
          elif ($l | startswith("*** Move to: ")) then .pend = $l[13:]
          elif ($l | startswith("*** ")) then .out += ([.pend] | map(select(. != null))) | .pend = null
          else . end)
      | .out + ([.pend] | map(select(. != null)))
      | reduce .[] as $f ([]; if any(.[]; . == $f) then . else . + [$f] end);
    [ .[] | objects
      | if .tool_name == "apply_patch" then
          (if ((.patch_exit // 0) != 0) then empty
           else (.tool_input.command // "" | tostring | patch_files[] | {kind: "edit", file: .}) end)
        elif .tool_name == "Bash" then {kind: "cmd", cmd: (.tool_input.command // ""), id: (.tool_use_id // "" | tostring)}
        else empty end ]
    | to_entries | map(.value as $v | ($x[0][$v.id // ""] // null) as $e
      | ( if $v.kind == "cmd" then
            {kind: "cmd", cmd: $v.cmd}
            + ( if $e == null then {exit: null, status: "unknown"}
                elif $e.exit != null then (if $e.exit == 0 then {exit: 0, status: "ok"} else {exit: $e.exit, status: "failed"} end)
                # No exit code: trust the rollout status, never a guess ("declined" etc. never ran).
                elif (($e.status // "") | test("declin|reject|denied"; "i")) then {exit: null, status: "blocked"}
                elif ($e.status // "") == "completed" then {exit: null, status: "unknown"}
                else {exit: null, status: "failed"} end )
          else $v end ) + {seq: (.key + 1)})' 2>/dev/null || printf '[]'
  rm -rf "$tmpd"
}

case "$name" in
  SessionStart) base session_start ;;
  UserPromptSubmit) printf '%s' "$payload" | jq -c --argjson b "$(base prompt)" '$b + {prompt: (.prompt // "")}' ;;
  PreToolUse)
    [ "$tool" = Bash ] || exit 0
    printf '%s' "$payload" | jq -c --argjson b "$(base pre_shell)" '$b + {command: (.tool_input.command // "")}' ;;
  PostToolUse)
    [ "$tool" = apply_patch ] || exit 0
    j .tool_input.command | patch_files | cut -f2- \
      | while IFS= read -r f; do base post_edit | jq -c --arg v "$f" '.file = $v'; done ;;
  Stop)
    created="[]"; edited="[]"; cmds="[]"; skills="[]"; steps="[]"
    ledger="$(ledger_file "$(j .session_id)" "$(j .turn_id)")"
    if [ -n "$ledger" ] && [ -f "$ledger" ]; then
      # Tolerate a torn/corrupted line (parallel appends): skip it, keep the rest.
      recs="$(jq -cR 'fromjson? | select(type == "object")' "$ledger" 2>/dev/null)"
      files="$(printf '%s\n' "$recs" | jq -r 'select(.tool_name == "apply_patch") | .tool_input.command // empty' | patch_files)"
      created="$(printf '%s\n' "$files" | sed -n 's/^A\t//p' | as_json)"
      edited="$(printf '%s\n' "$files" | sed -n 's/^E\t//p' | as_json)"
      cmds="$(printf '%s\n' "$recs" | jq -c 'select(.tool_name == "Bash") | .tool_input.command // empty' | jq -cs .)"
      skills="$(printf '%s' "$cmds" | jq -r '.[]' | skill_ids | as_json)"
      steps="$(printf '%s\n' "$recs" | ordered_steps "$(j .transcript_path)")"
    fi
    # Large values go through files, never argv (ARG_MAX would silently drop the audit).
    tmpd="$(mktemp -d)" || exit 0
    printf '%s' "${created:-[]}" > "$tmpd/c"; printf '%s' "${edited:-[]}" > "$tmpd/e"
    printf '%s' "${cmds:-[]}" > "$tmpd/s"; printf '%s' "${skills:-[]}" > "$tmpd/k"; printf '%s' "${steps:-[]}" > "$tmpd/t"
    printf '%s' "$payload" | jq -j '.last_assistant_message // ""' > "$tmpd/x" 2>/dev/null
    base turn_end | jq -c --slurpfile c "$tmpd/c" --slurpfile e "$tmpd/e" --slurpfile s "$tmpd/s" \
      --slurpfile k "$tmpd/k" --slurpfile t "$tmpd/t" --rawfile x "$tmpd/x" \
      --argjson r "$(printf '%s' "$payload" | jq '.stop_hook_active == true')" \
      '.turn = {files_created:$c[0], files_edited:$e[0], shell_commands:$s[0], skills_used:$k[0], assistant_text:$x, steps:$t[0]} | .reentrant = $r'
    rm -rf "$tmpd" ;;
  *) exit 0 ;;
esac
exit 0
