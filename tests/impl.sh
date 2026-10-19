#!/usr/bin/env bash
# Runs one hook component for the black-box suites. By default that is the Node hooks the kit ships
# (dist/hooks/main.mjs — run `npm run build` first):
#   bash tests/impl.sh core <check> [args]          stdin: a normalized event
#   bash tests/impl.sh claude|codex <script> [args] normalize | emit <event> | hook <check> | hook record (codex)
# WF_IMPL_CORE, WF_IMPL_CLAUDE and WF_IMPL_CODEX replace the default with another implementation: each is a command
# prefix, and the component name and the args are appended, e.g.
#   WF_IMPL_CORE="node /path/to/other/main.mjs core"  ->  node /path/to/other/main.mjs core turn-audit
# The suites judge only what a component prints and its exit status, so any implementation that meets them passes.
part="$1"; name="$2"; shift 2
root="$(cd "$(dirname "$0")/.." && pwd)"
case "$part" in
  core)   pre="${WF_IMPL_CORE:-}" ;;
  claude) pre="${WF_IMPL_CLAUDE:-}" ;;
  codex)  pre="${WF_IMPL_CODEX:-}" ;;
  *) echo "impl.sh: unknown part: $part" >&2; exit 2 ;;
esac
# shellcheck disable=SC2086  # the prefix is a command line on purpose
[ -n "$pre" ] && exec $pre "$name" "$@"
exec node "$root/dist/hooks/main.mjs" "$part" "$name" "$@"
