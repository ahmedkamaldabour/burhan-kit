#!/usr/bin/env bash
# Core output {"message":"..."} (stdin) -> Claude Code hook output (stdout). $1 = normalized event.
# Stop's additionalContext is delivered to the model (verified: recorded as hook_additional_context
# and answered by the model in a real session, 2026-10-11).
set +e
msg="$(jq -r '.message // empty' 2>/dev/null)"
[ -n "$msg" ] || exit 0
case "$1" in
  session_start) ev=SessionStart ;;
  prompt)        ev=UserPromptSubmit ;;
  pre_shell)     ev=PreToolUse ;;
  post_edit)     ev=PostToolUse ;;
  turn_end)      ev=Stop ;;
  *) exit 0 ;;
esac
jq -cn --arg e "$ev" --arg m "$msg" '{hookSpecificOutput:{hookEventName:$e, additionalContext:$m}}' 2>/dev/null
exit 0
