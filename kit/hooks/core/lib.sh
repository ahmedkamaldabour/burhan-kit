#!/usr/bin/env bash
# Shared library for the core checks. Source it, call wf_init, add findings with wf_say,
# finish with wf_emit.
#
# Contract: stdin is a *normalized event* (see tests/CONFORMANCE.md);
# stdout is {"message":"..."} or nothing. Core scripts never read an agent's raw payload or
# transcript — adapters do that.
#
# Fail open, always: no `set -e`, and an EXIT trap forces status 0, so a broken check can never
# break the agent. Findings are printed only by wf_emit at the very end, so a crash part-way
# through prints nothing rather than half a message.

# wf_utf8 — the checks match Arabic text (prompt-router, completion claims). Under a non-UTF-8 locale
# (LC_ALL=C, or none set — some agents start hooks that way) grep reads bytes, and a bracket such as
# [ةه] stops matching. Switch this process to an installed UTF-8 locale; if none, carry on as is.
wf_utf8() {
  case "$(locale charmap 2>/dev/null)" in UTF-8|utf-8|utf8) return 0 ;; esac
  local c
  for c in C.UTF-8 C.utf8 en_US.UTF-8 en_US.utf8; do
    if [ "$(LC_ALL="$c" locale charmap 2>/dev/null)" = UTF-8 ]; then
      WF_LC_SWITCHED=1; WF_LC_ALL_WAS="${LC_ALL+set}"; WF_LC_ALL_OLD="${LC_ALL-}"
      export LC_ALL="$c"; return 0
    fi
  done
  return 0
}

# wf_user_locale <cmd…> — run a command of the user's (WF_CHECK_CMD) under the locale they started with.
wf_user_locale() {
  if [ "${WF_LC_SWITCHED:-0}" != 1 ]; then "$@"
  elif [ "$WF_LC_ALL_WAS" = set ]; then LC_ALL="$WF_LC_ALL_OLD" "$@"
  else env -u LC_ALL "$@"; fi
}

wf_init() {
  set +e
  trap 'exit 0' EXIT
  # bash >= 5.2 expands `&` in ${var//pat/rep} replacements — config values like "a && b" would be
  # corrupted. Turn it off (no-op on older bash).
  shopt -u patsub_replacement 2>/dev/null
  wf_utf8
  WF_EVENT="$(cat 2>/dev/null)"
  [ -n "$WF_EVENT" ] || exit 0
  printf '%s' "$WF_EVENT" | jq -e 'type == "object"' >/dev/null 2>&1 || exit 0

  WF_PROJECT="$(wf_get .project_dir)"
  [ -n "$WF_PROJECT" ] || WF_PROJECT="$PWD"
  [ "$WF_PROJECT" != / ] && WF_PROJECT="${WF_PROJECT%/}"

  local explicit="${WF_CONFIG:-}"   # captured first: a config file must not switch the local layer off
  local cfg="${explicit:-$WF_PROJECT/.workflow/workflow.config}"
  # shellcheck disable=SC1090
  [ -f "$cfg" ] && . "$cfg" 2>/dev/null
  # Personal overrides (git-ignored), key by key over the team file — unless WF_CONFIG points elsewhere.
  # WF_CHECK_TIMEOUT stays the team's: the agent's own hook timeout is derived from it and committed.
  local lcfg="$WF_PROJECT/.workflow/local/workflow.config" team_timeout="${WF_CHECK_TIMEOUT-}" team_timeout_set="${WF_CHECK_TIMEOUT+x}"
  # shellcheck disable=SC1090
  if [ -z "$explicit" ] && [ -f "$lcfg" ]; then
    . "$lcfg" 2>/dev/null
    if [ -n "$team_timeout_set" ]; then WF_CHECK_TIMEOUT="$team_timeout"; else unset WF_CHECK_TIMEOUT; fi
  fi
  set +eu +o pipefail   # a config that enables strict modes must not kill the checks

  : "${WF_DOCS_DIR:=AI_SPEC/docs}"
  : "${WF_DISCOVERY_DIR:=AI_SPEC/discovery}"
  : "${WF_STATE_FILE:=.workflow/local/PROGRESS.md}"
  : "${WF_STATE_BUDGET:=80}"
  : "${WF_CHECK_TIMEOUT:=60}"
  : "${WF_SKILLS:=none}"
  WF_DOCS_DIR="$(wf_cfgpath "$WF_DOCS_DIR")"
  WF_DISCOVERY_DIR="$(wf_cfgpath "$WF_DISCOVERY_DIR")"
  WF_STATE_FILE="$(wf_cfgpath "$WF_STATE_FILE")"
  case "$WF_CHECK_TIMEOUT" in ''|*[!0-9]*) WF_CHECK_TIMEOUT=60 ;; esac
  case "$WF_STATE_BUDGET" in ''|*[!0-9]*) WF_STATE_BUDGET=80 ;; esac
  WF_FINDINGS=""
}

# wf_cfgpath <path> -> config path without leading ./ or trailing /
wf_cfgpath() {
  local p="$1"
  while [ "${p#./}" != "$p" ]; do p="${p#./}"; done
  printf '%s' "${p%/}"
}

# wf_re_escape <text> -> the text with every ERE metacharacter escaped
wf_re_escape() { printf '%s' "$1" | sed -e 's/[][\\.^$*+?(){}|]/\\&/g'; }

# wf_state_now -> the "## Now" section of the state file (empty if absent)
wf_state_now() {
  local f="$WF_PROJECT/$WF_STATE_FILE"
  [ -f "$f" ] || return 0
  awk '/^## /{ if (on) exit; if ($0 ~ /^## Now[[:space:]]*$/) { on=1; next } } on' "$f"
}

# wf_skills_on -> success when the Superpowers skill mapping is bound (phases/skills.md)
wf_skills_on() { [ "$WF_SKILLS" = superpowers ]; }

# wf_get <jq-filter>  -> scalar from the event, empty if absent/null
wf_get() { printf '%s' "$WF_EVENT" | jq -r "($1) // empty" 2>/dev/null; }

# wf_list <jq-filter> -> array items, one per line
wf_list() { printf '%s' "$WF_EVENT" | jq -r "(($1) // [])[]" 2>/dev/null; }

# wf_rel <path> -> project-relative path
# wf_rel_stream — paths on stdin (one per line) -> project-relative, lexically normalised paths, one per
# line. Drop "." and empty segments, let ".." pop a real directory, but KEEP a leading ".." — a path
# outside the project must never look like one inside. One awk for any number of paths: every check
# that compares paths uses this, so they can never disagree.
wf_rel_stream() {
  awk -v proj="$WF_PROJECT" '{
    p = $0
    if (proj != "" && index(p, proj "/") == 1) p = substr(p, length(proj) + 2)
    n = split(p, seg, "/"); top = 0; abs = (substr(p, 1, 1) == "/")
    for (i = 1; i <= n; i++) {
      s = seg[i]
      if (s == "" || s == ".") continue
      if (s == ".." && top > 0 && st[top] != "..") { top--; continue }
      if (s == ".." && abs) continue
      st[++top] = s
    }
    out = abs ? "/" : ""
    for (i = 1; i <= top; i++) out = out (i > 1 ? "/" : "") st[i]
    print out
  }'
}

# wf_rel <path> -> project-relative path (no trailing newline)
wf_rel() { local r; r="$(printf '%s\n' "$1" | wf_rel_stream)"; printf '%s' "$r"; }

# wf_match <ere> <text> -> success if the (non-empty) regex matches
wf_match() { [ -n "$1" ] && printf '%s' "$2" | grep -qE -- "$1"; }

# wf_written -> unique project-relative paths created or edited this turn
wf_written() {
  { wf_list .turn.files_created; wf_list .turn.files_edited; } \
    | while IFS= read -r f; do [ -n "$f" ] && wf_rel "$f" && echo; done | sort -u
}

# wf_shell_writes -> project-relative files this turn's shell commands wrote via redirection or tee
# (agents also edit through the shell). Heuristic — see shell-writes.awk for what counts and what not.
wf_shell_writes() {
  printf '%s' "$WF_EVENT" | jq -j '(.turn.shell_commands // [])[] | . + "\u001e"' 2>/dev/null \
    | awk -f "$(dirname "${BASH_SOURCE[0]}")/shell-writes.awk" 2>/dev/null \
    | while IFS= read -r f; do [ -n "$f" ] && wf_rel "$f" && echo; done | sort -u
}

# wf_created -> unique project-relative paths created this turn
wf_created() {
  wf_list .turn.files_created | while IFS= read -r f; do [ -n "$f" ] && wf_rel "$f" && echo; done | sort -u
}

# wf_sha256 -> hex digest of stdin (GNU sha256sum, or shasum on BSD/macOS)
wf_sha256() { { sha256sum 2>/dev/null || shasum -a 256 2>/dev/null; } | cut -d' ' -f1; }

# wf_project_key -> 16 hex chars identifying the project by its physical path (shared with the CLI)
wf_project_key() {
  local p; p="$(cd "$WF_PROJECT" 2>/dev/null && pwd -P)" || p="$WF_PROJECT"
  printf '%s' "$p" | wf_sha256 | cut -c1-16
}

# wf_safe_id <id> -> success if the id can be a path component (no separators, never . or ..)
wf_safe_id() { case "$1" in ''|.|..) return 1 ;; esac; printf '%s' "$1" | grep -qE '^[A-Za-z0-9._-]+$'; }

# wf_item_now -> slug of the first "### <slug>" block under "## Now" (empty if none, or a template "<slug>")
wf_item_now() { wf_state_now | sed -n 's/^###[[:space:]]\{1,\}\([^[:space:]#<][^[:space:]]*\).*/\1/p' | head -n 1; }

# The fields gates read have ONE fixed form, read exactly — no word lists, no guessing (phases/files.md
# · "Fields the hooks and stats read"). session-gates and turn-audit read them only through these functions.
#
# wf_item_block -> the item in flight: the first "### <slug>" block of Now (a template "### <…>" is no
# item); with no slug heading, the whole Now.
wf_item_block() {
  if [ -n "$(wf_item_now)" ]; then wf_state_now | awk '/^###[[:space:]]+[^<[:space:]#]/ { n++ } /^###([[:space:]]|$)/ && n >= 1 && !/^###[[:space:]]+[^<[:space:]#]/ { n = 2 } n == 1'
  else wf_state_now; fi
}

# wf_item_field <Label> -> the value of the item's "**Label:**" field: the field opens a list line or
# follows a " · " separator, and its value runs to the next " · " or the end of the line (trimmed).
# A template placeholder "<…>" is no value.
wf_item_field() {
  wf_item_block | awk -v L="**$1:**" '
    { line = $0; sub(/^[[:space:]]*[-*][[:space:]]+/, "", line)
      n = split(line, part, / · /)
      for (i = 1; i <= n; i++) {
        p = part[i]; sub(/^[[:space:]]+/, "", p)
        if (index(p, L) == 1) { v = substr(p, length(L) + 1); gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
          if (substr(v, 1, 1) != "<") print v; exit } } }'
}

# wf_item_route -> the item's route "<type> / <scope>" (field **Route:**, or the legacy **Type / scope:**),
# only when it is exactly one of the listed values; otherwise empty.
WF_ROUTE_RE='^(feature|bug|investigation|change|refactor|release) / (spike|bounded|architectural|patch)$'
wf_item_route() {
  local r; r="$(wf_item_field Route)"; [ -n "$r" ] || r="$(wf_item_field 'Type / scope')"
  printf '%s\n' "$r" | grep -xE -- "$WF_ROUTE_RE"
}

# Performed by, exactly "<agent> · <model> · <context>" (asterisks removed first). Same rule as
# src/lib/facts.ts PERFORMED.
WF_PERFORMED_RE='[^·<>]*[^·<>[:space:]] · [^·<>]*[^·<>[:space:]] · (fresh subagent|other agent|human|same session)'

# wf_evidence_record — append this turn's steps to the evidence ledger, outside the project:
#   <root>/<project-key>/<session>/<turn>.jsonl         whole turn (Claude: re-audits rewrite it)
#   <root>/<project-key>/<session>/<turn>.<k>.jsonl     one part per Stop (Codex: steps since the last Stop)
# Private (umask 077), command lines only (never output), off with WF_EVIDENCE_LEDGER=off, sessions older
# than 30 days pruned. Fail open: any problem means no ledger, never a broken hook.
wf_evidence_record() {
  case "${WF_EVIDENCE_LEDGER:-on}" in off|no|false|0) return 0 ;; esac
  local session turn scope key root ldir name part k ltmp
  session="$(wf_get .session)"; turn="$(wf_get .turn_id)"; scope="$(wf_get .turn_scope)"
  wf_safe_id "$session" && wf_safe_id "$turn" || return 0
  printf '%s' "$WF_EVENT" | jq -e '((.turn.steps // []) | length) > 0' >/dev/null 2>&1 || return 0
  key="$(wf_project_key)"; [ "${#key}" -eq 16 ] || return 0      # no sha256 tool -> no shared-root writes
  root="$(wf_evidence_root)"
  ldir="$root/$key/$session"
  # The prune marker goes ONLY into a root this hook creates — never into a directory that already
  # existed (it may hold someone else's data).
  if [ ! -e "$root" ]; then ( umask 077 && mkdir -p "$root" && : > "$root/.burhan-evidence" ) 2>/dev/null; fi
  ( umask 077 && mkdir -p "$ldir" ) 2>/dev/null || return 0
  if [ "$scope" = since_last_stop ]; then
    k=1; while [ -e "$ldir/$turn.$k.jsonl" ]; do k=$((k + 1)); done; name="$turn.$k.jsonl"; part="$k"
  else
    name="$turn.jsonl"; part=0
  fi
  ltmp="$(mktemp "$ldir/.turn.XXXXXX" 2>/dev/null)" || return 0
  printf '%s' "$WF_EVENT" | jq -c --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg i "$(wf_item_now)" \
    --arg ph "$(wf_phase_now)" --arg p "$WF_PROJECT" --argjson part "$part" '
    .agent as $a | .session as $se | .turn_id as $t
    | (.turn.steps // [])[] | select(.kind == "edit" or .kind == "cmd")
    | {ts: $ts, agent: $a, session: $se, turn: $t, part: $part, seq: .seq, kind: .kind}
      + (if .kind == "edit" then {file: (.file // "" | if startswith($p + "/") then .[($p | length) + 1:] else . end)}
         else {cmd: .cmd, exit: .exit, status: .status} end)
      + (if (.by // "") != "" then {by: .by} else {} end)
      + {item: (if $i == "" then null else $i end), phase: (if $ph == "" then null else $ph end), project: $p}' > "$ltmp" 2>/dev/null \
    && mv -f "$ltmp" "$ldir/$name" 2>/dev/null
  rm -f "$ltmp" 2>/dev/null
  wf_evidence_prune "$root"
  return 0
}

# wf_evidence_root -> the ledger root: WF_EVIDENCE_DIR when absolute, else the default under XDG state
wf_evidence_root() {
  case "${WF_EVIDENCE_DIR:-}" in
    /*) printf '%s' "$WF_EVIDENCE_DIR" ;;
    *)  printf '%s/burhan/evidence' "${XDG_STATE_HOME:-$HOME/.local/state}" ;;
  esac
}

# wf_phase_now -> the "Sub-unit:" line of the first item in Now (the phase in flight), empty if none
wf_phase_now() { wf_state_now | sed -n 's/.*\*\*Sub-unit:\*\*[[:space:]]*//p' | head -n 1 | cut -c1-80; }

# wf_evidence_prune <root> — remove ledger session dirs older than 30 days. Only inside a root this kit
# created (marker), only <16-hex project key>/<session id> dirs, only dirs holding nothing but ledger files.
wf_evidence_prune() {
  local r h d; r="$(cd "$1" 2>/dev/null && pwd -P)" || return 0
  h="$(cd "$HOME" 2>/dev/null && pwd -P)"
  [ -n "$r" ] && [ "$r" != / ] && [ "$r" != "$h" ] && [ -f "$r/.burhan-evidence" ] || return 0
  find "$r" -mindepth 2 -maxdepth 2 -type d -mtime +30 2>/dev/null | while IFS= read -r d; do
    basename "$(dirname "$d")" | grep -qE '^[0-9a-f]{16}$' || continue
    wf_safe_id "$(basename "$d")" || continue
    [ -z "$(find "$d" -mindepth 1 ! -name '*.jsonl' ! -name '.turn.*' -print 2>/dev/null | head -n 1)" ] || continue
    rm -rf -- "$d"
  done
}

wf_say() { WF_FINDINGS="${WF_FINDINGS:+$WF_FINDINGS$'\n\n'}$1"; }

wf_emit() {
  [ -n "$WF_FINDINGS" ] && jq -cn --arg m "$WF_FINDINGS" '{message: $m}' 2>/dev/null
  exit 0
}
