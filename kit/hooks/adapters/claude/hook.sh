#!/usr/bin/env bash
# Claude Code entry point:  hook.sh <core-check-name>
#   payload --normalize.sh--> normalized event --core/<name>.sh--> {"message"} --emit.sh--> Claude output
# Fails open at every stage: always exit 0, never partial output.
set +e
here="$(cd "$(dirname "$0")" && pwd)"
core="$here/../../core/$1.sh"
[ -n "$1" ] && [ -f "$core" ] || { cat >/dev/null 2>&1; exit 0; }
ev="$(bash "$here/normalize.sh" 2>/dev/null)"
[ -n "$ev" ] || exit 0
out="$(printf '%s' "$ev" | bash "$core" 2>/dev/null)"
[ -n "$out" ] || exit 0
printf '%s' "$out" | bash "$here/emit.sh" "$(printf '%s' "$ev" | jq -r '.event' 2>/dev/null)" 2>/dev/null
exit 0
