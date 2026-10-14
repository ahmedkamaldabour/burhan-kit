#!/usr/bin/env bash
# Session start (also after compaction, where the agent re-fires it): re-inject the gates, filled
# from workflow.config, and surface the state file's "Now" section so a fresh session lands on the
# primary objective instead of rediscovering it.
. "$(dirname "$0")/lib.sh"
wf_init

STATE_LINES_MAX=30

# Resolve Now once: the display, mode and external snapshot must describe the same item without
# repeatedly reparsing the state file.  Failure remains fail-open, as in the shared lib helpers.
now="$(wf_state_now | cut -c1-300)"
slugs="$(printf '%s\n' "$now" | sed -n 's/^###[[:space:]]\{1,\}\([^[:space:]#<][^[:space:]]*\).*/\1/p')"
slug_count="$(printf '%s\n' "$slugs" | sed '/^$/d' | wc -l | tr -d ' ')"
linked=""
link_file="$(wf_link_file 2>/dev/null)" || link_file=""
if [ -n "$link_file" ] && [ -f "$link_file" ]; then linked="$(sed -n '1p' "$link_file" 2>/dev/null)"; fi
item=""
if wf_safe_id "$linked" && printf '%s\n' "$slugs" | grep -qxF -- "$linked"; then
  item="$linked"
elif [ "$slug_count" = 1 ]; then
  item="$slugs"
fi
if [ -n "$item" ]; then
  block="$(printf '%s\n' "$now" | awk -v want="$item" '
    /^###[[:space:]]/ { if ($0 ~ /^###[[:space:]]+[^<[:space:]#]/) { h=$0; sub(/^###[[:space:]]+/, "", h); split(h, a, /[[:space:]]/); on = (a[1] == want) } else on = 0 }
    on')"
elif [ -n "$slugs" ]; then
  block=""
else
  block="$now"
fi
item_field() {
  printf '%s\n' "$block" | awk -v L="**$1:**" '
    { line = $0; sub(/^[[:space:]]*[-*][[:space:]]+/, "", line)
      n = split(line, part, / · /)
      for (i = 1; i <= n; i++) { p = part[i]; sub(/^[[:space:]]+/, "", p)
        if (index(p, L) == 1) { v = substr(p, length(L) + 1); gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
          if (substr(v, 1, 1) != "<") print v; exit } } }'
}
item_route() {
  local r; r="$(item_field Route)"; [ -n "$r" ] || r="$(item_field 'Type / scope')"
  printf '%s\n' "$r" | grep -xE -- "$WF_ROUTE_RE"
}
wf_state_snapshot "$slugs"
wf_state_fingerprint_snapshot

fill() {
  local line val key name
  while IFS= read -r line; do
    case "$line" in
      "[skills]"*) wf_skills_on || continue; line="${line#\[skills\]}" ;;
    esac
    for key in DOCS_DIR STATE_FILE CHECK_CMD MODE; do
      case "$line" in *"{{$key}}"*)
        name="WF_$key"; val="${!name}"
        [ -z "$val" ] && continue 2
        line="${line//\{\{$key\}\}/$val}" ;;
      esac
    done
    printf '%s\n' "$line"
  done < "$(dirname "$0")/gates.txt"
}

# Autonomy mode (phases/lifecycle.md · Modes), from the item in flight only (wf_item_field — the same
# reader turn-audit uses). The first value SET decides: the item's **Mode:**, else
# WF_MODE_<TYPE>_<SCOPE> for its **Route:**, else WF_MODE_DEFAULT, else step. It must be exactly
# step | auto; any other value is step — never a looser fallback below it.
route="$(item_route)"; route_key=""; route_mode=""
if [ -n "$route" ]; then
  route_key="WF_MODE_$(printf '%s' "$route" | sed 's| / |_|' | tr '[:lower:]' '[:upper:]')"; route_mode="${!route_key:-}"
fi
mode_val="$(item_field Mode)"
if [ -n "$mode_val" ]; then WF_MODE="$mode_val"
elif [ -n "$route_mode" ]; then WF_MODE="$route_mode"
elif [ -n "${WF_MODE_DEFAULT:-}" ]; then WF_MODE="$WF_MODE_DEFAULT"
else WF_MODE=step; fi
case "$WF_MODE" in step|auto) ;; *) WF_MODE=step ;; esac
# plan-only was a mode before 0.1.0: an old value anywhere gets one line, with the mode really used.
old_plan_only=""
is_plan_only() { printf '%s' "$1" | tr -d '`*' | grep -qiE '^[[:space:]]*plan[-_ ]?only[[:space:]]*$'; }
for v in "the item's Mode=$mode_val" "$route_key=$route_mode" "WF_MODE_DEFAULT=${WF_MODE_DEFAULT:-}"; do
  if is_plan_only "${v#*=}"; then
    old_plan_only="⚑ plan-only is no longer a mode (step | auto): the old value in ${v%%=*} is ignored; this session runs as $WF_MODE. To stop after the plan, say so — the item closes at Plan ready (.burhan/phases/lifecycle.md · Modes)."
    break
  fi
done
wf_say "$(fill)"
[ "${WF_STACK_SETUP:-}" = "pending" ] && wf_say "⚑ FIRST USE: burhan's project checks are not set up yet. Before other work, run \`burhan setup --stack\` and follow it."
[ -n "$old_plan_only" ] && wf_say "$old_plan_only"

if [ "$slug_count" -gt 1 ] 2>/dev/null && [ -z "$item" ]; then
    listed="$(printf '%s\n' "$slugs" | paste -sd ',' - | sed 's/,/, /g')"
    wf_say "⚑ ITEMS IN FLIGHT: $listed — this session isn't linked to one yet — say which, or run /burhan:e2e <slug>."
elif [ "$slug_count" -gt 1 ] 2>/dev/null; then
    shown="$(printf '%s\n' "$block" | cut -c1-300)"
    other="$(printf '%s\n' "$slugs" | grep -vxF -- "$item" | paste -sd ',' - | sed 's/,/, /g')"
    wf_say "⚑ CURRENT STATE ($WF_STATE_FILE · Now · linked: $item):"$'\n'"$shown"$'\n'"⚑ OTHER ITEMS: $other"
elif [ -n "$now" ]; then
    total="$(printf '%s\n' "$now" | wc -l | tr -d ' ')"
    shown="$(printf '%s\n' "$now" | head -n "$STATE_LINES_MAX")"
    [ "$total" -gt "$STATE_LINES_MAX" ] && shown="$shown"$'\n'"… truncated ($total lines) — read $WF_STATE_FILE"
    wf_say "⚑ CURRENT STATE ($WF_STATE_FILE · Now):"$'\n'"$shown"
fi

wf_emit
