#!/usr/bin/env bash
# Core output {"message":"..."} (stdin) -> Codex hook output (stdout). $1 = normalized event.
# Measured against the schemas embedded in Codex 0.150.1: SessionStart / UserPromptSubmit /
# PreToolUse / PostToolUse accept hookSpecificOutput.additionalContext (SessionStart delivery to the
# model confirmed in a live run). Stop's schema has additionalProperties:false and NO
# hookSpecificOutput — the model is reached only via {"decision":"block","reason":…}, which
# continues the turn once with the reason; the core's reentrant guard stops it repeating.
set +e
msg="$(jq -r '.message // empty' 2>/dev/null)"
[ -n "$msg" ] || exit 0
case "$1" in
  session_start) ev=SessionStart ;;
  prompt)        ev=UserPromptSubmit ;;
  pre_shell)     ev=PreToolUse ;;
  post_edit)     ev=PostToolUse ;;
  turn_end)      jq -cn --arg m "$msg" '{decision:"block", reason:$m}' 2>/dev/null; exit 0 ;;
  *) exit 0 ;;
esac
jq -cn --arg e "$ev" --arg m "$msg" '{hookSpecificOutput:{hookEventName:$e, additionalContext:$m}}' 2>/dev/null
exit 0
