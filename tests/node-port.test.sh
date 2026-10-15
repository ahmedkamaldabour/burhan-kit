#!/usr/bin/env bash
# The Node port of the hooks, judged by the same black-box suites as the bash kit (tests/CONFORMANCE.md).
# PORTED grows phase by phase; a suite joins it only when it passes in full. Needs a build (npm run build).
. "$(dirname "$0")/lib.sh"
ENTRY="$T_ROOT/dist/hooks/main.mjs"
PORTED_CORE="post-edit-reminder pre-commit-check session-gates prompt-router turn-audit"

echo "node port — the entry is built and answers"
check "dist/hooks/main.mjs exists (npm run build)" "$([ -f "$ENTRY" ] && echo yes)" has "yes"
P="$(t_tmp)"; mkdir -p "$P/.burhan"; : > "$P/.burhan/workflow.config"
out="$(printf '{"event":"session_start","project_dir":"%s"}' "$P" | node "$ENTRY" core session-gates 2>&1)"
check "a session_start event through Node prints the gates" "$out" has "WORKFLOW GATES"

echo "node port — ported core suites pass through WF_IMPL_CORE"
for s in $PORTED_CORE; do
  out="$(WF_IMPL_CORE="node $ENTRY core" bash "$T_ROOT/tests/core/$s.test.sh" 2>&1)"; rc=$?
  check "core/$s passes on Node" "rc=$rc" has "rc=0"
  check "core/$s ran cases on Node (not an empty pass)" "$out" lacks "passed: 0 "
  [ "$rc" -ne 0 ] && printf '%s\n' "$out" | grep -E '^  FAIL' | head -5 | sed 's/^/        /'
done
t_summary
