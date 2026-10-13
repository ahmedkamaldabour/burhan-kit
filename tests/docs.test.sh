#!/usr/bin/env bash
# Docs for the install UX: the agent path, the wizard, uninstall, no unmeasured claims.
. "$(dirname "$0")/lib.sh"
cd "$T_ROOT" || exit 1

README="$(cat README.md)"; AR="$(cat README.ar.md)"; SETUP="$(cat kit/SETUP.md)"
first30() { head -30 "$1"; }
qs_block() { awk '/^## (Quick start|ابدأ بسرعة)/{f=1;next} /^## /{f=0} f' "$1"; }
# section_block <file> <heading line>: the lines under that exact heading, up to the next "## ".
# grep -F -x finds the heading: macOS awk did not match an Arabic heading passed with -v (CI, 0.2.1).
section_block() {
  local start; start="$(grep -n -F -x -- "$2" "$1" | head -n 1 | cut -d: -f1)"
  [ -n "$start" ] || return 0
  tail -n "+$((start + 1))" "$1" | awk '/^## /{exit} {print}'
}

echo "README.md — the agent path comes first"
check "setup --agent within the first 30 lines" "$(first30 README.md)" has "setup --agent"
check "a 'For AI agents' heading" "$(grep -E '^#+ .*For AI agents' README.md)" has "For AI agents"
check "documents npx burhan-kit uninstall" "$README" has "npx burhan-kit uninstall"
check "documents npx burhan-kit setup" "$README" has "npx burhan-kit setup"
check "README.md: the Quick start section is found (not an empty pass)" "$([ "$(qs_block README.md | grep -c .)" -gt 0 ] && echo yes)" has "yes"
check "the Quick start section no longer uses init --agents (the wizard and the agent prompt do)" "$(qs_block README.md)" lacks "init --agents"
check "init is still documented (scripts / CI)" "$README" has "burhan-kit@latest init"

echo "README.ar.md — the same, checked by commands"
check "setup --agent within the first 30 lines" "$(first30 README.ar.md)" has "setup --agent"
check "documents npx burhan-kit uninstall" "$AR" has "npx burhan-kit uninstall"
check "documents npx burhan-kit setup" "$AR" has "npx burhan-kit setup"
check "README.ar.md: the Quick start section is found (not an empty pass)" "$([ "$(qs_block README.ar.md | grep -c .)" -gt 0 ] && echo yes)" has "yes"
check "the Quick start section no longer uses init --agents (the wizard and the agent prompt do)" "$(qs_block README.ar.md)" lacks "init --agents"
check "init is still documented (scripts / CI)" "$AR" has "init --agents"

echo "README work-item process and headline"
WORK_ITEM="$(section_block README.md '## How a work item runs' | tr '\n' ' ')"
AR_WORK_ITEM="$(section_block README.ar.md '## الشغلانة بتمشي إزاي؟' | tr '\n' ' ')"
DESCRIPTION="$(node -e "console.log(require('./package.json').description)")"
check "README.md has a How a work item runs section" "$(grep -E '^## How a work item runs$' README.md)" has "How a work item runs"
check "README.ar.md has a clear Egyptian Arabic work-item section" "$(grep -F '## الشغلانة بتمشي إزاي؟' README.ar.md)" has "الشغلانة بتمشي إزاي؟"
for mark in '⬜' '🟡' '🔵' '🟢' '✅'; do
  check "README.md work-item section has status $mark" "$WORK_ITEM" has "$mark"
  check "README.ar.md work-item section has status $mark" "$AR_WORK_ITEM" has "$mark"
done
for text in 'sub-unit' 'reviewer agent' '.workflow/local/PROGRESS.md' 'burhan status' 'QC'; do
  check "README.md work-item section names $text" "$WORK_ITEM" has "$text"
done
check "README.md work-item section qualifies QC by Q gate" "$WORK_ITEM" has "For routes that include the Q gate"
check "README.md work-item section keeps the commit checkpoint universal" "$WORK_ITEM" has "Every route stops at the commit checkpoint"
for text in 'sub-unit' 'reviewer' '.workflow/local/PROGRESS.md' 'burhan status' 'QC'; do
  check "README.ar.md work-item section names $text" "$AR_WORK_ITEM" has "$text"
done
check "README.ar.md work-item section qualifies QC by Q gate" "$AR_WORK_ITEM" has "لو المسار فيه بوابة Q"
check "README.ar.md work-item section keeps the commit checkpoint universal" "$AR_WORK_ITEM" has "وكل المسارات بتقف عند commit checkpoint"
check "README.md has the new headline" "$README" has "A working process for AI coding agents: plan first, build in reviewed steps, prove every 'done'."
check "README.md keeps the old proof line" "$README" has 'No "done" without proof.'
check "package description mentions plan" "$DESCRIPTION" has "plan"
check "package description mentions review" "$DESCRIPTION" has "review"
for f in README.md README.ar.md; do
  CONTENT="$(cat "$f")"
  check "$f mentions docs/burhan/" "$CONTENT" has "docs/burhan/"
done
check "README.md says existing hooks are listed and asked about" "$README" has "existing hooks"
check "README.md asks about existing hooks" "$README" has "ask"
check "README.ar.md says existing hooks are listed and asked about" "$AR" has "الـ hooks الموجودة"
check "README.ar.md asks about existing hooks" "$AR" has "هتتسأل"

echo "kit/SETUP.md — short, points at setup --agent, keeps the rules"
check "contains setup --agent" "$SETUP" has "setup --agent"
check "contains setup --stack" "$SETUP" has "setup --stack"
check "at most 40 lines" "$( [ "$(wc -l < kit/SETUP.md)" -le 40 ] && echo yes)" has "yes"
while IFS='|' read -r id file phrase; do
  check "SETUP.md keeps $id" "$SETUP" has "$phrase"
done < <(grep -E '^R14[6-9]\||^R15[01]\|' tests/rule-inventory.txt)
workflow_rule='The agent may edit .workflow/workflow.config only, after showing the diff and getting approval; it is a shared file, so the change reaches the team through review (a pull request) like code; never the kit-owned files.'
check "SETUP.md has the one approved .workflow edit rule" "$SETUP" has "$workflow_rule"
check "SETUP.md drops the old blanket .workflow edit ban" "$SETUP" lacks "Do not edit the .workflow/ files yourself."

config_grammar='Inside single quotes, $, backticks and \ are literal; a single-quoted value cannot contain a single quote.'
check "configuration docs state the single-quote grammar" "$(cat docs/configuration.md)" has "$config_grammar"

echo "no unmeasured claims (AC-20)"
# Claim words: faster, lighter, tokens, token cost (lines about credentials, e.g. R148's "tokens, passwords", are exempt).
for f in README.md README.ar.md kit/SETUP.md; do
  check "$f has no speed / weight / token claim" "$(grep -n -i -E 'faster|lighter|tokens|token cost' "$f" | grep -v -i credentials)" lacks ":"
done
removed='WF_FORBIDDEN|never-run|neverRun|NEVER RUN|FORBIDDEN|SINGLE_TEST_HINT|one file at a time|one at a time|resource constraint|single-file test hint|blocking mode|أوامر ممنوعة'
hits="$(grep -n -i -E "$removed" README*.md ROADMAP.md; find docs kit -type f -name '*.md' -exec grep -n -i -E "$removed" {} +)"
check_eq "shipped docs omit removed settings and resource guidance" "$hits" ""

echo "uninstall --all is described in full (review I-1: it also removes the config, bindings and local/)"
for f in README.md README.ar.md docs/configuration.md; do
  # The first "uninstall" plus 400 characters. awk, not grep '.{0,400}': BSD regex caps a repeat bound at 255 (RE_DUP_MAX).
  t="$(tr -s '[:space:]' ' ' < "$f")"
  for w in workflow.config bindings.md local/ .burhan/; do
    check "$f: the uninstall text names $w" "$(printf '%s' "$t" | awk '{ i = index($0, "uninstall"); if (i) print substr($0, i, 409) }')" has "$w"
  done
done
echo "USAGE lists the new commands"
usage="$(node dist/cli.js --help 2>&1)"
check "--help lists setup" "$usage" has "setup"
check "--help lists uninstall" "$usage" has "uninstall"
check "--help omits removed setup options" "$usage" lacks "never-run"
check "--help retains sensitive paths" "$usage" has "[sensitive=<p;q>]"

echo "configuration.md (pending owner) — drop this group if the owner declines"
CFG="$(cat docs/configuration.md)"
check "Commands table has burhan setup" "$(grep -E '^\| `burhan setup' docs/configuration.md)" has "burhan setup"
check "Commands table has burhan uninstall" "$(grep -E '^\| `burhan uninstall' docs/configuration.md)" has "burhan uninstall"
check "WF_STACK_SETUP is documented" "$CFG" has "WF_STACK_SETUP"
check "setup --set lists only the supported settings" "$(grep -E '^\| `burhan setup' docs/configuration.md)" has "--set check=<cmd\\|none> [sensitive=<p;q>]"
check ".burhan/ is mentioned" "$CFG" has ".burhan/"
check "configuration.md tells worktree users to start a new agent session" "$CFG" has "worktree"
check "configuration.md tells mid-session users to start a new agent session" "$CFG" has "new agent session"
check "configuration.md has no replacement permission sentence" "$CFG" lacks "Codex execpolicy"
check "ROADMAP omits the removed blocking proposal" "$(cat ROADMAP.md)" lacks "blocking mode"

t_summary
