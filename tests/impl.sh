#!/usr/bin/env bash
# Runs one hook component — from the bash kit, or from another implementation (a port).
#   bash tests/impl.sh core <check> [args]          stdin: a normalized event      (WF_IMPL_CORE)
#   bash tests/impl.sh claude|codex <script> [args] normalize | emit | hook | …    (WF_IMPL_CLAUDE / WF_IMPL_CODEX)
# WF_IMPL_<PART> is a command prefix; the component name and the args are appended, e.g.
#   WF_IMPL_CORE="node dist/hooks/core.js"  ->  node dist/hooks/core.js turn-audit
part="$1"; name="$2"; shift 2
kit="$(cd "$(dirname "$0")/../kit/hooks" && pwd)"
case "$part" in
  core)   pre="${WF_IMPL_CORE:-}";   dir="$kit/core" ;;
  claude) pre="${WF_IMPL_CLAUDE:-}"; dir="$kit/adapters/claude" ;;
  codex)  pre="${WF_IMPL_CODEX:-}";  dir="$kit/adapters/codex" ;;
  *) echo "impl.sh: unknown part: $part" >&2; exit 2 ;;
esac
# shellcheck disable=SC2086  # the prefix is a command line on purpose
[ -n "$pre" ] && exec $pre "$name" "$@"
exec bash "$dir/$name.sh" "$@"
