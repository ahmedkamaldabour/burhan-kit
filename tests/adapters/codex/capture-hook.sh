#!/usr/bin/env bash
# Measurement tool, not a hook for real use: append everything Codex hands a hook to a log, so the
# adapter is written against captured payloads instead of assumptions.
#   usage (in a throwaway repo's .codex/hooks.json):  bash /abs/capture-hook.sh <label>
# Writes to $CAPTURE_LOG (default /tmp/codex-hook-capture.log). For SessionStart it also returns a
# marker in additionalContext, to test whether Codex delivers hook output to the model.
log="${CAPTURE_LOG:-/tmp/codex-hook-capture.log}"
payload="$(cat)"
{
  printf '=== %s · %s · args=%s\n' "$(date -Is)" "${1:-?}" "$*"
  printf 'env: %s\n' "$(env | cut -d= -f1 | grep -E '^(CODEX|CLAUDE)' | sort | tr '\n' ' ')"
  printf '%s\n' "$payload"
} >> "$log"
if [ "${1:-}" = SessionStart ]; then
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"CAPTURE-MARKER-7f3a: if you can read this, say the marker back."}}'
fi
exit 0
