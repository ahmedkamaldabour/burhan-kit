#!/usr/bin/env bash
# Session start (also after compaction, where the agent re-fires it): re-inject the gates, filled
# from workflow.config, and surface the state file's "Now" section so a fresh session lands on the
# primary objective instead of rediscovering it.
. "$(dirname "$0")/lib.sh"
wf_init

STATE_LINES_MAX=30

fill() {
  local line val key name
  while IFS= read -r line; do
    case "$line" in
      "[skills]"*) wf_skills_on || continue; line="${line#\[skills\]}" ;;
    esac
    for key in DOCS_DIR STATE_FILE CHECK_CMD FORBIDDEN_REASON MODE; do
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
route="$(wf_item_route)"; route_key=""; route_mode=""
if [ -n "$route" ]; then
  route_key="WF_MODE_$(printf '%s' "$route" | sed 's| / |_|' | tr '[:lower:]' '[:upper:]')"; route_mode="${!route_key:-}"
fi
mode_val="$(wf_item_field Mode)"
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
    old_plan_only="⚑ plan-only is no longer a mode (step | auto): the old value in ${v%%=*} is ignored; this session runs as $WF_MODE. To stop after the plan, say so — the item closes at Plan ready (.workflow/phases/lifecycle.md · Modes)."
    break
  fi
done
# A forbidden pattern with no reason still gets its gate line.
[ -n "${WF_FORBIDDEN_REGEX:-}" ] && [ -z "${WF_FORBIDDEN_REASON:-}" ] && WF_FORBIDDEN_REASON="commands matching WF_FORBIDDEN_REGEX in .workflow/workflow.config."

wf_say "$(fill)"
[ -n "$old_plan_only" ] && wf_say "$old_plan_only"

now="$(wf_state_now | cut -c1-300)"
if [ -n "$now" ]; then
    total="$(printf '%s\n' "$now" | wc -l | tr -d ' ')"
    shown="$(printf '%s\n' "$now" | head -n "$STATE_LINES_MAX")"
    [ "$total" -gt "$STATE_LINES_MAX" ] && shown="$shown"$'\n'"… truncated ($total lines) — read $WF_STATE_FILE"
    wf_say "⚑ CURRENT STATE ($WF_STATE_FILE · Now):"$'\n'"$shown"
fi

wf_emit
