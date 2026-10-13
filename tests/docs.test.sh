#!/usr/bin/env bash
# Docs for the install UX: the agent path, the wizard, uninstall, no unmeasured claims.
. "$(dirname "$0")/lib.sh"
cd "$T_ROOT" || exit 1

README="$(cat README.md)"; AR="$(cat README.ar.md)"; SETUP="$(cat kit/SETUP.md)"
first30() { head -30 "$1"; }
qs_block() { awk '/^## (Quick start|ابدأ بسرعة)/{f=1;next} /^## /{f=0} f' "$1"; }

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

echo "kit/SETUP.md — short, points at setup --agent, keeps the rules"
check "contains setup --agent" "$SETUP" has "setup --agent"
check "contains setup --stack" "$SETUP" has "setup --stack"
check "at most 40 lines" "$( [ "$(wc -l < kit/SETUP.md)" -le 40 ] && echo yes)" has "yes"
while IFS='|' read -r id file phrase; do
  check "SETUP.md keeps $id" "$SETUP" has "$phrase"
done < <(grep -E '^R14[6-9]\||^R15[01]\|' tests/rule-inventory.txt)

echo "no unmeasured claims (AC-20) and honest wording about never-run commands"
# Claim words: faster, lighter, tokens, token cost (lines about credentials, e.g. R148's "tokens, passwords", are exempt). Wording rule: a line that talks about
# never-run commands (never run / must never / forbidden) must not say block/blocks/blocked.
for f in README.md README.ar.md kit/SETUP.md docs/configuration.md; do
  check "$f has no speed / weight / token claim" "$(grep -n -i -E 'faster|lighter|tokens|token cost' "$f" | grep -v -i credentials)" lacks ":"
  check "$f never says 'blocked' about never-run commands" "$(grep -n -i -E 'never run|must never|forbidden' "$f" | grep -i -E 'block')" lacks ":"
done

echo "uninstall --all is described in full (review I-1: it also removes the config, bindings and local/)"
for f in README.md README.ar.md docs/configuration.md; do
  t="$(tr -s '[:space:]' ' ' < "$f")"
  for w in workflow.config bindings.md local/ .burhan/; do
    check "$f: the uninstall text names $w" "$(printf '%s' "$t" | grep -o -E 'uninstall.{0,400}' | head -n 1)" has "$w"
  done
done
echo "USAGE lists the new commands"
usage="$(node dist/cli.js --help 2>&1)"
check "--help lists setup" "$usage" has "setup"
check "--help lists uninstall" "$usage" has "uninstall"

echo "configuration.md (pending owner) — drop this group if the owner declines"
CFG="$(cat docs/configuration.md)"
check "Commands table has burhan setup" "$(grep -E '^\| `burhan setup' docs/configuration.md)" has "burhan setup"
check "Commands table has burhan uninstall" "$(grep -E '^\| `burhan uninstall' docs/configuration.md)" has "burhan uninstall"
check "WF_STACK_SETUP is documented" "$CFG" has "WF_STACK_SETUP"
check ".burhan/ is mentioned" "$CFG" has ".burhan/"

t_summary
