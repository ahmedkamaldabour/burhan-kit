#!/usr/bin/env bash
# Per-turn ledger location and safety rules — sourced by hook.sh and normalize.sh.
# Lives outside the project: ${WF_CODEX_LEDGER_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/burhan/codex}
LEDGER_DIR="${WF_CODEX_LEDGER_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/burhan/codex}"
LEDGER_MARK=".burhan-ledger"

# valid_id <id> — session/turn ids become path components: allow only a safe charset, never . or ..
valid_id() {
  case "$1" in ''|.|..) return 1 ;; esac
  printf '%s' "$1" | grep -qE '^[A-Za-z0-9._-]+$'
}

# ledger_file <session> <turn> -> path, or nothing if either id is unsafe
ledger_file() { valid_id "$1" && valid_id "$2" && printf '%s/%s/%s.jsonl' "$LEDGER_DIR" "$1" "$2"; }

# ledger_prune — remove session dirs older than 2 days, ONLY inside a directory this kit created
# (it carries the marker file) and never "/" or $HOME themselves.
ledger_prune() {
  local d
  d="$(cd "$LEDGER_DIR" 2>/dev/null && pwd -P)" || return 0
  [ -n "$d" ] && [ "$d" != / ] && [ "$d" != "$(cd "$HOME" 2>/dev/null && pwd -P)" ] || return 0
  [ -f "$d/$LEDGER_MARK" ] || return 0
  find "$d" -mindepth 1 -maxdepth 1 -type d -mtime +2 2>/dev/null | while IFS= read -r s; do
    valid_id "$(basename "$s")" || continue
    # only session dirs that hold nothing but turn ledgers
    [ -z "$(find "$s" -mindepth 1 ! -name '*.jsonl' -print 2>/dev/null | head -n 1)" ] || continue
    rm -rf -- "$s"
  done
}
