#!/usr/bin/env bash
# "No rule is deleted": every rule of the working agreement keeps a key phrase in
# the place tests/rule-inventory.txt names; the core stays lean; every phase file is reachable.
. "$(dirname "$0")/lib.sh"
cd "$T_KIT" || exit 1
norm() { tr -s '[:space:]' ' '; }

echo "rule inventory — every rule still lives where the map says"
n=0
while IFS='|' read -r id where phrase; do
  case "$id" in ''|\#*) continue ;; esac
  n=$((n + 1))
  f="WORKFLOW.md"; [ "$where" = core ] || f="$where"
  check "$id ($where): $phrase" "$(norm < "$f" 2>/dev/null)" has "$(printf '%s' "$phrase" | norm)"
done < "$T_ROOT/tests/rule-inventory.txt"
check "inventory is not empty ($n rules)" "$([ "$n" -ge 100 ] && echo yes)" has yes
check_eq "rule identifiers are unique" "$(cut -d '|' -f 1 "$T_ROOT/tests/rule-inventory.txt" | grep -E '^R[0-9]+$' | sort | uniq -d)" ''

echo "lean core"
w="$(sed '/^## الخلاصة/,$d' WORKFLOW.md | wc -w | tr -d ' ')"
check "core is at most 1,600 words (now $w)" "$([ "$w" -le 1600 ] && echo yes)" has yes
check "the Arabic summary lives in the README, not in the agent's context" "$(cat WORKFLOW.md)" lacks "الخلاصة بالعربي"

echo "phase files are reachable"
for f in phases/*.md; do
  check "$f is listed in the core's read-on-demand table" "$(cat WORKFLOW.md)" has "$f"
  # A real pointer the agent reads at that moment: a command, an agent, or hook text — not a code comment.
  check "$f is pointed at by a command, an agent or a hook's text" \
    "$(grep -rn --include='*.md' --include='*.sh' --include='*.txt' -F "$f" commands agents hooks 2>/dev/null | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#')" has "$f"
done
echo "no stale section references (the core has §1–§9)"
stale="$(cd "$T_ROOT" && grep -rnE "(WORKFLOW(\.md)? )?§ ?(1[0-9]|3\.[0-9])" kit src README.md 2>/dev/null | grep -v "^kit/phases/.*core §")"
check "no reference to a § that no longer exists" "$stale" lacks "§"
echo "S+P is one gate over two files (issue #1: a combined document left burhan status at Spec ready)"
check "e2e no longer asks for one combined story + plan document" "$(norm < commands/e2e.md)" lacks "one combined story + plan document"
check "e2e names both files for S+P" "$(norm < commands/e2e.md)" has "write both \`<slug>-story.md\` and \`<slug>-implementation-plan.md\`"
echo "QC and templates"
check "QC opens the whole review checklist" "$(norm < commands/qc.md)" has "Apply the **whole** review checklist in \`.burhan/phases/review.md\` — security first"
for t in templates/*.md; do
  case "$t" in templates/bindings.md|templates/docs-index.md|templates/progress.md) continue ;; esac  # generated or config, not prose
  check "$t says empty sections may be deleted" "$(cat "$t")" has "Delete any section that does not apply"
done
t_summary
