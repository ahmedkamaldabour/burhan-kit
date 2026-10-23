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

P="$(proj 'WF_SKILLS=superpowers')"
check "no item -> brainstorming before any story" "$(r 'hello there')" has "Skill (before a story): invoke superpowers:brainstorming"
item foo
check "item without files -> brainstorming" "$(r 'continue')" has "invoke superpowers:brainstorming"
item foo "Draft"
check "story Draft -> brainstorming" "$(r 'continue')" has "invoke superpowers:brainstorming"
item foo "Approved (dev-dabour, 2026-10-23)"
check "story Approved, no plan -> writing-plans" "$(r 'continue')" has "invoke superpowers:writing-plans"
item foo "Approved" "Approved"
check "plan Approved -> test-driven-development" "$(r 'continue')" has "invoke superpowers:test-driven-development"
item foo "Approved" "In progress"
check "plan In progress -> test-driven-development" "$(r 'continue')" has "invoke superpowers:test-driven-development"
item foo "Approved" "Completed"
check "plan Completed -> verification-before-completion" "$(r 'continue')" has "invoke superpowers:verification-before-completion"
item foo "Approved" "In progress" "bug / bounded"
check "route bug -> systematic-debugging" "$(r 'continue')" has "invoke superpowers:systematic-debugging"
item foo "" "" "investigation / bounded"
check "route investigation -> systematic-debugging" "$(r 'continue')" has "invoke superpowers:systematic-debugging"
item foo "Approved" "In progress"
check "the line says to read the skill's instructions" "$(r 'continue')" has "read its instructions"
check "an Arabic prompt gives the same line" "$(r 'كمل')" has "invoke superpowers:test-driven-development"
out="$(r 'add a fix for the broken role permission, investigate, then we are done')"
check_eq "outside the 2-hint cap: two hints and the skill line" "$(printf '%s\n' "$out" | grep -c '^•')" "2"
check "skill line present beside two hints" "$out" has "Skill (build)"
check "notification prompt -> no skill line" "$(r '<task-notification> agent done')" lacks "Skill ("

# several blocks and no live link: the item is unknown, so no phase is claimed
mkdir -p "$P/.burhan/local"; printf '# state\n## Now\n### foo\n### bar\n## Waiting on you\n' > "$P/.burhan/local/PROGRESS.md"
check "two items, no link -> silent" "$(r 'continue')" lacks "Skill ("

# a docs folder that is not the default
P="$(proj 'WF_SKILLS=superpowers' 'WF_DOCS_DIR=AI_SPEC/docs')"; DOCS="AI_SPEC/docs"
item foo "Approved" ""
check "custom docs folder is read" "$(r 'continue')" has "invoke superpowers:writing-plans"

# off
DOCS=".burhan/work"; P="$(proj 'WF_SKILLS=none')"; item foo "Approved" "In progress"
check "WF_SKILLS=none -> no skill line" "$(r 'continue')" lacks "Skill ("
check_eq "WF_SKILLS=none -> silent" "$(r 'continue')" ""
# review fixes (SU1): Completed wins over the route; exact status words; unsafe slug; paused; controls for the silent cases
P="$(proj 'WF_SKILLS=superpowers')"
item foo "Approved" "Completed" "bug / bounded"
check "bug with a Completed plan -> verification-before-completion" "$(r 'continue')" has "invoke superpowers:verification-before-completion"
item foo "Approved" "Paused"
check_eq "Paused plan -> silent" "$(r 'continue' | grep -c 'Skill (')" "0"
rm -rf "$P/$DOCS/foo"; item foo "Approvedish"
check "a status word must match exactly (Approvedish is not Approved)" "$(r 'continue')" has "invoke superpowers:brainstorming"
mkdir -p "$P/.burhan/local"; printf '# state\n## Now\n### ../etc\n## Waiting on you\n' > "$P/.burhan/local/PROGRESS.md"
check "an unsafe slug is never used as a path" "$(r 'continue')" lacks "Skill ("
rm -rf "$P/$DOCS/foo"; item foo "Approved-x"
check "Approved-x is not Approved either" "$(r 'continue')" has "invoke superpowers:brainstorming"
item foo "Approved" "In progress"
check "control: a normal prompt gets the line" "$(r 'continue')" has "Skill (build)"
check "notification prompt -> no line (same fixture)" "$(r '<task-notification> agent done')" lacks "Skill ("
printf '# state\n## Now\n### foo\n### bar\n## Waiting on you\n' > "$P/.burhan/local/PROGRESS.md"
check "two items, no link -> no line (same prompt)" "$(r 'continue')" lacks "Skill ("
printf '# state\n## Now\n### foo\n## Waiting on you\n' > "$P/.burhan/local/PROGRESS.md"
check "one item -> the line comes back" "$(r 'continue')" has "Skill ("

# QC finding: an item on the patch lane has no story or plan, so no phase skill is asked for
P="$(proj 'WF_SKILLS=superpowers')"
for route in "change / patch" "bug / patch" "refactor / patch"; do
  item foo "" "" "$route"
  check "patch route ($route) -> no skill line" "$(r 'continue')" lacks "Skill ("
done
item foo "" "" "change / bounded"
check "control: a bounded route with the same files -> the line" "$(r 'continue')" has "Skill ("
t_summary
