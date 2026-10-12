#!/usr/bin/env bash
# The hook suites are black-box: every component call goes through tests/impl.sh, so the same
# suites can verify another implementation (a port) — WF_IMPL_CORE / _CLAUDE / _CODEX.
. "$(dirname "$0")/lib.sh"
D="$(t_tmp)"
printf '#!/usr/bin/env bash\ncat >/dev/null 2>&1\nexit 0\n' > "$D/silent.sh"
for part in core claude codex; do
  dir="$T_KIT/hooks/core"; [ "$part" = core ] || dir="$T_KIT/hooks/adapters/$part"
  printf '#!/usr/bin/env bash\nn="$1"; shift; exec bash "%s/$n.sh" "$@"\n' "$dir" > "$D/pass-$part.sh"
done
suite() { # <VAR> <impl-script> <test-file> -> rc=N (and, on a pass-through failure, which checks failed)
  local out rc
  out="$(env "$1=bash $2" bash "$T_ROOT/tests/$3" 2>&1)"; rc=$?
  echo "rc=$rc"
  case "$2" in *pass-*) [ "$rc" -ne 0 ] && printf '%s\n' "$out" | grep -E '^  FAIL' | head -5 | sed 's/^/        /' >&2 ;; esac
}

echo "conformance seam"
for s in turn-audit prompt-router session-gates pre-commit-check post-edit-reminder; do
  check "core/$s passes through a pass-through implementation" "$(suite WF_IMPL_CORE "$D/pass-core.sh" "core/$s.test.sh")" has "rc=0"
  check "core/$s FAILS against a silent implementation" "$(suite WF_IMPL_CORE "$D/silent.sh" "core/$s.test.sh")" lacks "rc=0"
done
for a in claude codex; do
  V="WF_IMPL_$(printf '%s' "$a" | tr a-z A-Z)"
  check "$a adapter suite passes through a pass-through implementation" "$(suite "$V" "$D/pass-$a.sh" "adapters/$a/$a.test.sh")" has "rc=0"
  check "$a adapter suite FAILS against a silent implementation" "$(suite "$V" "$D/silent.sh" "adapters/$a/$a.test.sh")" lacks "rc=0"
done
# Any direct execution of a kit script (by variable or path) bypasses the seam. lib.test.sh is the one
# allowed exception: it *sources* lib.sh as a white-box test and skips itself under WF_IMPL_CORE.
check "no suite calls a kit script directly" \
  "$(grep -nE '(bash|sh|exec)[[:space:]]+"?[^"[:space:]]*(\$(A|CORE|T_KIT)|kit/hooks)[^"[:space:]]*\.sh' "$T_ROOT"/tests/core/*.test.sh "$T_ROOT"/tests/core/helpers.sh "$T_ROOT"/tests/adapters/*/*.test.sh)" lacks ".sh"
t_summary
