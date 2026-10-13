#!/usr/bin/env bash
# Helpers for core hook tests. Source after tests/lib.sh.
#   proj [config-lines...]        -> new project dir with .burhan/workflow.config
#   ev <json-fragment>            -> normalized event JSON (defaults filled, project_dir = $P)
#   core <script> <event-json>    -> runs hooks/core/<script>.sh with the event on stdin
CORE="$T_KIT/hooks/core"

proj() {
  P="$(t_tmp)"
  mkdir -p "$P/.burhan"
  : > "$P/.burhan/workflow.config"
  local line
  for line in "$@"; do printf '%s\n' "$line" >> "$P/.burhan/workflow.config"; done
  printf '%s' "$P"
}

ev() {
  jq -cn --arg p "$P" --argjson x "${1:-{\}}" '
    { event: "turn_end", agent: "claude", project_dir: $p, prompt: "", command: "", file: "",
      turn: { files_created: [], files_edited: [], shell_commands: [], skills_used: [], assistant_text: "" },
      reentrant: false } * $x'
}

core() {
  local err out; err="$(mktemp)"
  out="$(printf '%s' "$2" | bash "$T_ROOT/tests/impl.sh" core "$1" 2>"$err")"
  [ -s "$err" ] && t_fail_note "$1 wrote to stderr (crash?): $(head -c 200 "$err" | tr '\n' ' ')"
  if [ -n "$out" ] && ! printf '%s' "$out" | jq -e 'type == "object" and (.message | type == "string")' >/dev/null 2>&1; then
    t_fail_note "$1 printed invalid output: $(printf '%s' "$out" | head -c 200 | tr '\n' ' ')"
  fi
  rm -f "$err"; printf '%s' "$out"
}
