#!/usr/bin/env bash
# Codex entry point:  hook.sh <core-check-name>   (or: hook.sh record — ledger only, for tests)
#   PostToolUse payloads are first appended to the per-turn ledger (read back at Stop).
#   payload --normalize.sh--> event(s) --core/<name>.sh--> {"message"} --emit.sh--> Codex output
# Fails open at every stage: always exit 0, never partial output.
set +e
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/ledger.sh"
# The project is where the kit is installed (<project>/.workflow/hooks/adapters/codex), not the
# session cwd — Codex may be started from a subdirectory.
case "$here" in */.workflow/hooks/adapters/codex) export WF_PROJECT_ROOT="${here%/.workflow/hooks/adapters/codex}" ;; esac
payload="$(cat 2>/dev/null)"
printf '%s' "$payload" | jq -e 'type == "object"' >/dev/null 2>&1 || exit 0
jr() { printf '%s' "$payload" | jq -r "($1) // empty" 2>/dev/null; }
event="$(jr .hook_event_name)"

if [ "$event" = PostToolUse ]; then
  f="$(ledger_file "$(jr .session_id)" "$(jr .turn_id)")"
  # The prune marker only goes into a ledger root this hook creates (never a pre-existing directory).
  [ -n "$f" ] && [ ! -e "$LEDGER_DIR" ] && { ( umask 077 && mkdir -p "$LEDGER_DIR" && : > "$LEDGER_DIR/$LEDGER_MARK" ); } 2>/dev/null
  if [ -n "$f" ] && { ( umask 077 && mkdir -p "$(dirname "$f")" ); } 2>/dev/null; then
    # Never the tool output (size, secrets): only what the turn audit needs — the call, its id (to find
    # the exit code in the rollout at Stop) and, for patches, the exit code from the response header.
    # jq >= 1.6: no postfix `?` on a call followed by a path (tests/jq-compat.test.sh).
    line="$(printf '%s' "$payload" | jq -c '{tool_name, tool_input, tool_use_id,
      patch_exit: (if .tool_name == "apply_patch"
                   then (((.tool_response // "" | tostring | capture("^Exit code: (?<n>[0-9]+)")) // {}) | .n // null
                         | if . == null then null else (tonumber? // null) end)
                   else null end)}' 2>/dev/null)"
    # Never lose the call silently: if the full record cannot be built, keep the call itself, marked.
    [ -n "$line" ] || line="$(printf '%s' "$payload" | jq -c '{tool_name, tool_input, tool_use_id, record: "minimal"}' 2>/dev/null)"
    # One write per record (O_APPEND) so parallel tool calls don't interleave; readers skip torn lines.
    [ -n "$line" ] && { printf '%s\n' "$line" >> "$f"; } 2>/dev/null
  fi
fi
[ "${1:-}" = record ] && exit 0

core="$here/../../core/${1:-}.sh"
[ -n "${1:-}" ] && [ -f "$core" ] || exit 0

msgs=""; kind=""
while IFS= read -r ev; do
  [ -n "$ev" ] || continue
  out="$(printf '%s' "$ev" | bash "$core" 2>/dev/null | jq -r '.message // empty' 2>/dev/null)"
  [ -n "$out" ] || continue
  kind="$(printf '%s' "$ev" | jq -r .event 2>/dev/null)"
  case "$msgs" in *"$out"*) ;; *) msgs="${msgs:+$msgs$'\n\n'}$out" ;; esac   # a multi-file patch: say it once
done < <(printf '%s' "$payload" | bash "$here/normalize.sh" 2>/dev/null)

if [ "$event" = Stop ]; then
  f="$(ledger_file "$(jr .session_id)" "$(jr .turn_id)")"
  [ -n "$f" ] && rm -f -- "$f" 2>/dev/null   # the turn is over: consume its ledger
  ledger_prune
fi

[ -n "$msgs" ] || exit 0
jq -cn --arg m "$msgs" '{message:$m}' | bash "$here/emit.sh" "$kind" 2>/dev/null
exit 0
