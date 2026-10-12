#!/usr/bin/env bash
# Shared helpers for the test files. Source it; never run it directly.
#   check <name> <output> has|lacks <needle>
#   t_tmp            -> prints a fresh temp dir (removed on exit)
#   t_summary        -> prints the tally; returns non-zero if anything failed
set -u

T_PASS=0
T_FAIL=0
T_TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$T_TMP_ROOT"' EXIT
# Hooks keep state outside the project (Codex turn ledger, evidence ledger): never the real ~/.local/state.
export XDG_STATE_HOME="$T_TMP_ROOT/state"

# Portable helpers (GNU and BSD/macOS userlands; CI runs both).
t_sha()   { { sha256sum 2>/dev/null || shasum -a 256; } | cut -d' ' -f1; }   # stdin -> hex digest
t_sedi()  { local f="${!#}" t; t="$(mktemp)"; sed "${@:1:$#-1}" "$f" > "$t" && cat "$t" > "$f"; rm -f "$t"; }  # sed -i, keeps the file's mode
t_mode()  { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }            # octal permission bits
t_timeout() { if command -v timeout >/dev/null; then timeout "$@"; else gtimeout "$@"; fi; }  # GNU timeout or Homebrew's gtimeout
t_age()   { local d="$1" ts; shift; ts="$(date -d "$d days ago" +%Y%m%d%H%M 2>/dev/null || date -v-"$d"d +%Y%m%d%H%M)"; touch -t "$ts" "$@"; }  # set mtime N days back

# Repository root, for tests that need to read the kit itself.
T_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The kit itself (what gets copied into projects).
T_KIT="$T_ROOT/kit"

check() {
  if [ $# -ne 4 ] || { [ "$3" != has ] && [ "$3" != lacks ]; }; then
    T_FAIL=$((T_FAIL + 1)); echo "  FAIL - malformed check (need: name output has|lacks needle): ${1:-?}"; return
  fi
  local name="$1" out="$2" mode="$3" needle="$4"
  if { [ "$mode" = has ] && printf '%s' "$out" | grep -qF -- "$needle"; } \
    || { [ "$mode" = lacks ] && ! printf '%s' "$out" | grep -qF -- "$needle"; }; then
    T_PASS=$((T_PASS + 1)); echo "  ok   - $name"
  else
    T_FAIL=$((T_FAIL + 1)); echo "  FAIL - $name (expected output to $mode: $needle)"
    [ -n "${T_VERBOSE:-}" ] && printf '        got: %s\n' "$out"
  fi
}

# check_eq <name> <actual> <expected>
check_eq() {
  if [ "$2" = "$3" ]; then
    T_PASS=$((T_PASS + 1)); echo "  ok   - $1"
  else
    T_FAIL=$((T_FAIL + 1)); echo "  FAIL - $1"
    printf '        expected: %s\n        actual:   %s\n' "$3" "$2"
  fi
}

t_tmp() { mktemp -d "$T_TMP_ROOT/t.XXXXXX"; }

# t_bash_only <WF_IMPL_VAR> <reason> && check … — a case only the bash kit can meet (tests/CONFORMANCE.md ·
# Bash-only cases). Under a port (the variable is set) it prints a skip line, counts nothing, and fails.
t_bash_only() {
  [ -z "${!1:-}" ] && return 0
  echo "  skip - bash-only: $2"
  return 1
}

# t_fail_note <text> — record a failure from inside a $(...) subshell, where T_FAIL is not shared.
T_NOTES="$T_TMP_ROOT/failure-notes"
t_fail_note() { printf '%s\n' "$1" >> "$T_NOTES"; }

t_summary() {
  if [ -s "$T_NOTES" ]; then
    sed 's/^/  FAIL - /' "$T_NOTES"
    T_FAIL=$((T_FAIL + $(wc -l < "$T_NOTES")))
  fi
  echo "  passed: $T_PASS  failed: $T_FAIL"
  [ "$T_FAIL" -eq 0 ]
}
