#!/usr/bin/env bash
# The router's skill line: one mandatory line, from the item's phase (its files), not from the prompt's words.
. "$(dirname "$0")/../lib.sh"; . "$(dirname "$0")/helpers.sh"
S=prompt-router
r() { core $S "$(ev "$(jq -cn --arg p "$1" '{event:"prompt",prompt:$p,session:"s1"}')")" | jq -r '.message // empty'; }
echo "skill line (prompt-router)"

# item <slug> [story-status] [plan-status] [route]: a state block and the item's files under $P/$DOCS
DOCS=".burhan/work"
item() {
  mkdir -p "$P/.burhan/local" "$P/$DOCS/$1"
  { printf '# state\n## Now\n'; printf '### %s\n' "$1"; [ -n "${4:-}" ] && printf -- '- **Route:** %s\n' "$4"; printf '## Waiting on you\n'; } > "$P/.burhan/local/PROGRESS.md"
  [ -n "${2:-}" ] && printf '# s\n- **Status:** %s\n' "$2" > "$P/$DOCS/$1/$1-story.md"
  [ -n "${3:-}" ] && printf '# p\n- **Overall status:** %s\n' "$3" > "$P/$DOCS/$1/$1-implementation-plan.md"
  return 0
}

P="$(proj)"
check "no item -> burhan-story before any story" "$(r 'hello there')" has "Skill (before a story): invoke burhan-story"
item foo
check "item without files -> burhan-story" "$(r 'continue')" has "invoke burhan-story"
item foo "Draft"
check "story Draft -> burhan-story" "$(r 'continue')" has "invoke burhan-story"
item foo "Approved (dev-dabour, 2026-10-23)"
check "story Approved, no plan -> burhan-plan" "$(r 'continue')" has "invoke burhan-plan"
item foo "Approved" "Approved"
check "plan Approved -> burhan-build" "$(r 'continue')" has "invoke burhan-build"
item foo "Approved" "In progress"
check "plan In progress -> burhan-build" "$(r 'continue')" has "invoke burhan-build"
item foo "Approved" "Completed"
check "plan Completed -> burhan-done" "$(r 'continue')" has "invoke burhan-done"
item foo "Approved" "In progress" "bug / bounded"
check "route bug -> burhan-debug" "$(r 'continue')" has "invoke burhan-debug"
item foo "" "" "investigation / bounded"
check "route investigation -> burhan-debug" "$(r 'continue')" has "invoke burhan-debug"
item foo "Approved" "In progress"
check "the line says where to read the skill" "$(r 'continue')" has "read .burhan/skills/burhan-build/SKILL.md"
check "an Arabic prompt gives the same line" "$(r 'كمل')" has "invoke burhan-build"
out="$(r 'add a fix for the broken role permission, investigate, then we are done')"
check_eq "outside the 2-hint cap: two hints and the skill line" "$(printf '%s\n' "$out" | grep -c '^•')" "2"
check "skill line present beside two hints" "$out" has "Skill (build)"
check "notification prompt -> no skill line" "$(r '<task-notification> agent done')" lacks "Skill ("

# several blocks and no live link: the item is unknown, so no phase is claimed
mkdir -p "$P/.burhan/local"; printf '# state\n## Now\n### foo\n### bar\n## Waiting on you\n' > "$P/.burhan/local/PROGRESS.md"
check "two items, no link -> silent" "$(r 'continue')" lacks "Skill ("

# a docs folder that is not the default
P="$(proj 'WF_DOCS_DIR=AI_SPEC/docs')"; DOCS="AI_SPEC/docs"
item foo "Approved" ""
check "custom docs folder is read" "$(r 'continue')" has "invoke burhan-plan"

DOCS=".burhan/work"
# review fixes (SU1): Completed wins over the route; exact status words; unsafe slug; paused; controls for the silent cases
P="$(proj)"
item foo "Approved" "Completed" "bug / bounded"
check "bug with a Completed plan -> burhan-done" "$(r 'continue')" has "invoke burhan-done"
item foo "Approved" "Paused"
check_eq "Paused plan -> silent" "$(r 'continue' | grep -c 'Skill (')" "0"
rm -rf "$P/$DOCS/foo"; item foo "Approvedish"
check "a status word must match exactly (Approvedish is not Approved)" "$(r 'continue')" has "invoke burhan-story"
mkdir -p "$P/.burhan/local"; printf '# state\n## Now\n### ../etc\n## Waiting on you\n' > "$P/.burhan/local/PROGRESS.md"
check "an unsafe slug is never used as a path" "$(r 'continue')" lacks "Skill ("
rm -rf "$P/$DOCS/foo"; item foo "Approved-x"
check "Approved-x is not Approved either" "$(r 'continue')" has "invoke burhan-story"
item foo "Approved" "In progress"
check "control: a normal prompt gets the line" "$(r 'continue')" has "Skill (build)"
check "notification prompt -> no line (same fixture)" "$(r '<task-notification> agent done')" lacks "Skill ("
printf '# state\n## Now\n### foo\n### bar\n## Waiting on you\n' > "$P/.burhan/local/PROGRESS.md"
check "two items, no link -> no line (same prompt)" "$(r 'continue')" lacks "Skill ("
printf '# state\n## Now\n### foo\n## Waiting on you\n' > "$P/.burhan/local/PROGRESS.md"
check "one item -> the line comes back" "$(r 'continue')" has "Skill ("

# QC finding: an item on the patch lane has no story or plan, so no phase skill is asked for
P="$(proj)"
for route in "change / patch" "bug / patch" "refactor / patch"; do
  item foo "" "" "$route"
  check "patch route ($route) -> no skill line" "$(r 'continue')" lacks "Skill ("
done
item foo "" "" "change / bounded"
check "control: a bounded route with the same files -> the line" "$(r 'continue')" has "Skill ("
t_summary
