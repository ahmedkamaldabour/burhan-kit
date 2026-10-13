#!/usr/bin/env bash
. "$(dirname "$0")/../lib.sh"; . "$(dirname "$0")/helpers.sh"
S=turn-audit
a() { core $S "$(ev "$1")" | jq -r '.message // empty'; }
# t <created-json> <edited-json> <commands-json> <skills-json> <text>
t() { jq -cn --argjson c "$1" --argjson e "$2" --argjson s "$3" --argjson k "$4" --arg x "$5" \
  '{turn:{files_created:$c,files_edited:$e,shell_commands:$s,skills_used:$k,assistant_text:$x}}'; }
echo "turn-audit.sh"

BASE=("WF_CODE_REGEX='\\.src\$'" "WF_EVIDENCE_REGEX='^verify-it'")

P="$(proj "${BASE[@]}")"
check_eq "reentrant -> silent even when checks would fire" \
  "$(a "$(jq -cn '{reentrant:true, turn:{files_edited:["a.src"],assistant_text:"done"}}')")" ""

echo "  -- A: unverified completion"
check "code + claim + no evidence -> fires" "$(a "$(t '[]' '["a.src"]' '["ls"]' '[]' 'All done.')")" has "VERIFICATION GATE"
check "✅ counts as a claim" "$(a "$(t '[]' '["a.src"]' '[]' '[]' 'Sub-unit 1 ✅')")" has "VERIFICATION GATE"
check "Arabic claim counts" "$(a "$(t '[]' '["a.src"]' '[]' '[]' 'كده خلص')")" has "VERIFICATION GATE"
check "with evidence -> silent" "$(a "$(t '[]' '["a.src"]' '["verify-it now"]' '[]' 'done')")" lacks "VERIFICATION GATE"
check "no claim -> silent" "$(a "$(t '[]' '["a.src"]' '[]' '[]' 'still working on it')")" lacks "VERIFICATION GATE"
check "'abandoned' is not 'done'" "$(a "$(t '[]' '["a.src"]' '[]' '[]' 'the abandoned path')")" lacks "VERIFICATION GATE"
check "no code touched -> silent" "$(a "$(t '[]' '["notes.md"]' '[]' '[]' 'done')")" lacks "VERIFICATION GATE"
P="$(proj "WF_CODE_REGEX='\\.src\$'")"
check "evidence regex empty -> says so" "$(a "$(t '[]' '["a.src"]' '[]' '[]' 'done')")" has "no evidence pattern configured"
P="$(proj)"
check "code regex empty -> silent" "$(a "$(t '[]' '["a.src"]' '[]' '[]' 'done')")" lacks "VERIFICATION GATE"

echo "  -- B: state transition not recorded"
P="$(proj "${BASE[@]}")"
check "item file written, state not -> fires" "$(a "$(t '[]' '[".burhan/work/foo/foo-story.md"]' '[]' '[]' '')")" has "STATE-TRANSITION GATE"
check "absolute item path also counts" "$(a "$(t '[]' "[\"$P/.burhan/work/foo/foo-story.md\"]" '[]' '[]' '')")" has "STATE-TRANSITION GATE"
check "state written too -> silent" "$(a "$(t '[]' '[".burhan/work/foo/foo-story.md",".burhan/local/PROGRESS.md"]' '[]' '[]' '')")" lacks "STATE-TRANSITION GATE"
check "state only MENTIONED -> still fires (measured bug)" \
  "$(a "$(t '[]' '[".burhan/work/foo/foo-story.md"]' '[]' '[]' 'I updated .burhan/local/PROGRESS.md')")" has "STATE-TRANSITION GATE"
check "docs index written -> silent" "$(a "$(t '[]' '[".burhan/work/README.md"]' '[]' '[]' '')")" lacks "STATE-TRANSITION GATE"

echo "  -- legacy settings are inert"
P="$(proj "WF_FORBIDDEN_REGEX='run-everything'" "WF_FORBIDDEN_REASON='it melts the laptop'")"
out="$(a "$(t '[]' '[]' '["tool run-everything --all"]' '[]' '')")"
check "legacy WF_FORBIDDEN_REGEX emits no audit finding" "$out" lacks "FORBIDDEN"
check "legacy reason is ignored" "$out" lacks "it melts the laptop"
P="$(proj)"

mkdir -p "$P/.burhan/local"
printf '%s\n' "WF_FORBIDDEN_REGEX='run-everything'" "WF_FORBIDDEN_REASON='legacy local reason'" "WF_SINGLE_TEST_HINT='legacy local runner'" > "$P/.burhan/local/workflow.config"
out="$(a "$(t '[]' '[]' '["tool run-everything"]' '[]' '')")"
check_eq "legacy local settings emit no audit finding" "$out" ""
header="$(sed -n '1,16p' "$CORE/turn-audit.sh")"
check "audit header has no C label" "$header" lacks "#   C "
for label in D E F G H; do
  check "audit header retains label $label" "$header" has "#   $label "
done

echo "  -- D: state file over budget"
P="$(proj)"; mkdir -p "$P/.burhan/local"
seq 1 81 > "$P/.burhan/local/PROGRESS.md"
out="$(a "$(t '[]' '[]' '[]' '[]' '')")"
check "81 lines -> fires" "$out" has "STATE-SIZE GATE"
check "real count reported" "$out" has "is 81 lines"
seq 1 80 > "$P/.burhan/local/PROGRESS.md"
check "80 lines -> silent" "$(a "$(t '[]' '[]' '[]' '[]' '')")" lacks "STATE-SIZE GATE"
rm "$P/.burhan/local/PROGRESS.md"
check "missing -> silent" "$(a "$(t '[]' '[]' '[]' '[]' '')")" lacks "STATE-SIZE GATE"

echo "  -- E: contradictory status"
P="$(proj)"; mkdir -p "$P/.burhan/work/foo" "$P/.burhan/discovery"
lbl='Status'; dm='✅'
both="- **${lbl}:** Draft"$'\n'"- ${dm} Completed"
printf '%s\n' "$both" > "$P/.burhan/work/foo/foo-story.md"
printf '%s\n' "$both" > "$P/.burhan/work/README.md"
printf '%s\n' "$both" > "$P/.burhan/discovery/2026-10-11-x.md"
printf '%s\n' "$both" > "$P/.burhan/discovery/README.md"
check "item file with both -> fires" "$(a "$(t '[]' '[".burhan/work/foo/foo-story.md",".burhan/local/PROGRESS.md"]' '[]' '[]' '')")" has "STALE-STATUS GATE"
check "docs index with both -> silent" "$(a "$(t '[]' '[".burhan/work/README.md"]' '[]' '[]' '')")" lacks "STALE-STATUS GATE"
check "dated discovery with both -> fires" "$(a "$(t '[]' '[".burhan/discovery/2026-10-11-x.md"]' '[]' '[]' '')")" has "STALE-STATUS GATE"
check "discovery index -> silent" "$(a "$(t '[]' '[".burhan/discovery/README.md"]' '[]' '[]' '')")" lacks "STALE-STATUS GATE"
printf '%s\n' "- **${lbl}:** Approved" > "$P/.burhan/work/foo/foo-story.md"
check "consistent file -> silent" "$(a "$(t '[]' '[".burhan/work/foo/foo-story.md"]' '[]' '[]' '')")" lacks "STALE-STATUS GATE"

# The real templates, copied as-is into an item folder, must never trip the scan.
P="$(proj)"; mkdir -p "$P/.burhan/work/tpl/reviews"
for f in "$T_KIT"/templates/*.md; do cp "$f" "$P/.burhan/work/tpl/tpl-$(basename "$f")"; done
tpl_files="$(cd "$P" && find .burhan/work/tpl -name '*.md' | jq -R . | jq -cs .)"
check "fresh templates -> silent" "$(a "$(t '[]' "$tpl_files" '[]' '[]' '')")" lacks "STALE-STATUS GATE"

echo "  -- F: skill usage"
P="$(proj "${BASE[@]}" 'WF_SKILLS=superpowers')"
check "story created w/o brainstorming -> fires" "$(a "$(t '[".burhan/work/foo/foo-story.md"]' '[]' '[]' '[]' '')")" has "SKILL GATE (story)"
check "story created with brainstorming -> silent" "$(a "$(t '[".burhan/work/foo/foo-story.md"]' '[]' '[]' '["superpowers:brainstorming"]' '')")" lacks "SKILL GATE (story)"
check "story only edited -> silent" "$(a "$(t '[]' '[".burhan/work/foo/foo-story.md"]' '[]' '[]' '')")" lacks "SKILL GATE (story)"
check "plan created w/o writing-plans -> fires" "$(a "$(t '[".burhan/work/foo/foo-implementation-plan.md"]' '[]' '[]' '[]' '')")" has "SKILL GATE (plan)"
check "code w/o TDD/debugging -> fires" "$(a "$(t '[]' '["a.src"]' '[]' '[]' '')")" has "SKILL GATE (code)"
check "code with TDD -> silent" "$(a "$(t '[]' '["a.src"]' '[]' '["superpowers:test-driven-development"]' '')")" lacks "SKILL GATE (code)"
check "code with debugging -> silent" "$(a "$(t '[]' '["a.src"]' '[]' '["superpowers:systematic-debugging"]' '')")" lacks "SKILL GATE (code)"
check "review w/o code-review -> fires" "$(a "$(t '[]' '[".burhan/work/foo/reviews/foo-task1.md"]' '[]' '[]' '')")" has "SKILL GATE"
check "qc file -> not the review gate" "$(a "$(t '[]' '[".burhan/work/foo/reviews/foo-qc.md"]' '[]' '[]' '')")" lacks "SKILL GATE"
check "verification file -> not the review gate" "$(a "$(t '[]' '[".burhan/work/foo/reviews/foo-verification.md"]' '[]' '[]' '')")" lacks "SKILL GATE"
check "code edited only by a subagent -> F silent (skills are judged in the subagent's own turn)" \
  "$(a "$(jq -cn '{turn:{files_created:[],files_edited:[],shell_commands:[],skills_used:[],assistant_text:"",steps:[{seq:1,kind:"edit",file:"a.src",by:"burhan-builder"}]}}')")" lacks "SKILL GATE (code)"
P="$(proj "${BASE[@]}")"
check "skills none -> F silent" "$(a "$(t '[".burhan/work/foo/foo-story.md"]' '["a.src"]' '[]' '[]' '')")" lacks "SKILL GATE"

echo "  -- G: read-only violation (R2)"
P="$(proj "${BASE[@]}")"; mkdir -p "$P/.burhan/local"
printf '%s\n' '## Now' '### inv' '- **Type / scope:** investigation / bounded · **Read-only:** yes' > "$P/.burhan/local/PROGRESS.md"
check "read-only + code written -> fires" "$(a "$(t '[]' '["a.src"]' '[]' '[]' '')")" has "READ-ONLY GATE"
check "read-only + docs only -> silent" "$(a "$(t '[]' '[".burhan/work/inv/inv-story.md",".burhan/local/PROGRESS.md"]' '[]' '[]' '')")" lacks "READ-ONLY GATE"
SUBED='{turn:{files_created:[],files_edited:[],shell_commands:[],skills_used:[],assistant_text:"",steps:[{seq:1,kind:"edit",file:"a.src",by:"burhan-builder"}]}}'
check "read-only + code edited by a subagent -> fires" "$(a "$(jq -cn "$SUBED")")" has "READ-ONLY GATE"
printf '%s\n' '## Now' '- **Read-only:** no' > "$P/.burhan/local/PROGRESS.md"
check "no read-only marker -> silent" "$(a "$(t '[]' '["a.src"]' '[]' '[]' '')")" lacks "READ-ONLY GATE"
for ro in '<yes|no>' 'Yes' ''; do
  printf '%s\n' '## Now' '### inv' "- **Route:** investigation / bounded · **Read-only:** $ro" > "$P/.burhan/local/PROGRESS.md"
  check "investigation route, Read-only '$ro' (not exactly no) -> fires" "$(a "$(t '[]' '["a.src"]' '[]' '[]' '')")" has "READ-ONLY GATE"
done
printf '%s\n' '## Now' '### b' '- **Route:** bug / spike' > "$P/.burhan/local/PROGRESS.md"
check "bug / spike with no Read-only field -> fires" "$(a "$(t '[]' '["a.src"]' '[]' '[]' '')")" has "READ-ONLY GATE"
printf '%s\n' '## Now' '### inv' '- **Route:** investigation / spike · **Read-only:** no' > "$P/.burhan/local/PROGRESS.md"
check "a read-only route explicitly marked Read-only: no -> silent (the human's call)" "$(a "$(t '[]' '["a.src"]' '[]' '[]' '')")" lacks "READ-ONLY GATE"
printf '%s\n' '## Now' '### b' '- **Route:** bug / bounded' > "$P/.burhan/local/PROGRESS.md"
check "a writing route with no Read-only field -> silent" "$(a "$(t '[]' '["a.src"]' '[]' '[]' '')")" lacks "READ-ONLY GATE"

echo "  -- regressions"
P="$(proj "${BASE[@]}")"
check "'not done yet' is not a claim" "$(a "$(t '[]' '["a.src"]' '[]' '[]' 'Not done yet.')")" lacks "VERIFICATION GATE"
check "'not passing yet' is not a claim" "$(a "$(t '[]' '["a.src"]' '[]' '[]' 'The test is not passing yet')")" lacks "VERIFICATION GATE"
check "Arabic 'خلصانة' is not a claim" "$(a "$(t '[]' '["a.src"]' '[]' '[]' 'هعمل خلصانة')")" lacks "VERIFICATION GATE"
pp="$(proj "${BASE[@]}")"
ev_slash="$(jq -cn --arg p "$pp/" --arg f "$pp/.burhan/work/foo/foo-story.md" '{event:"turn_end",project_dir:$p,turn:{files_edited:[$f]}}')"
check "project_dir with trailing slash -> B still fires" "$(core $S "$ev_slash" | jq -r '.message // empty')" has "STATE-TRANSITION GATE"
P="$(proj "WF_DOCS_DIR='docs(v2)'")"
check "ERE metachars in WF_DOCS_DIR" "$(a "$(t '[]' '["docs(v2)/foo/foo-story.md"]' '[]' '[]' '')")" has "STATE-TRANSITION GATE"
P="$(proj "WF_DOCS_DIR='./docs'" "WF_STATE_FILE='./.burhan/local/PROGRESS.md'")"
check "leading ./ in config paths normalized (B fires)" "$(a "$(t '[]' '["docs/foo/foo-story.md"]' '[]' '[]' '')")" has "STATE-TRANSITION GATE"
check "leading ./ in config paths normalized (B silent)" "$(a "$(t '[]' '["docs/foo/foo-story.md",".burhan/local/PROGRESS.md"]' '[]' '[]' '')")" lacks "STATE-TRANSITION GATE"
P="$(proj)"; mkdir -p "$P/.burhan/local"; printf '%s' "$(seq 1 81)" > "$P/.burhan/local/PROGRESS.md"
check "D counts a last line without newline" "$(a "$(t '[]' '[]' '[]' '[]' '')")" has "is 81 lines"
P="$(proj)"; mkdir -p "$P/.burhan/work/foo"
printf '%s\n' "Status: **Draft**" "${dm} Completed" > "$P/.burhan/work/foo/foo-story.md"
check "E detects 'Status: **Draft**'" "$(a "$(t '[]' '[".burhan/work/foo/foo-story.md",".burhan/local/PROGRESS.md"]' '[]' '[]' '')")" has "STALE-STATUS GATE"
P="$(proj "${BASE[@]}")"; mkdir -p "$P/.burhan/local"
printf '%s\n' '## Now' '### active' '- **Read-only:** no' '## Standing facts' '- parked inv **Read-only:** yes' > "$P/.burhan/local/PROGRESS.md"
check "G reads only the Now section" "$(a "$(t '[]' '["a.src"]' '[]' '[]' '')")" lacks "READ-ONLY GATE"
P="$(proj "${BASE[@]}" 'set -eu')"
check "config with 'set -eu' does not kill the checks" "$(a "$(t '[]' '["a.src"]' '[]' '[]' 'done')")" has "VERIFICATION GATE"
P="$(proj "${BASE[@]}" 'WF_SKILLS=other')"
check "unknown WF_SKILLS -> F silent" "$(a "$(t '[]' '["a.src"]' '[]' '[]' '')")" lacks "SKILL GATE"

echo "  -- regressions"
P="$(proj "${BASE[@]}")"
check "'still work to be done' is not a claim" "$(a "$(t '[]' '["a.src"]' '[]' '[]' 'There is still work to be done here.')")" lacks "VERIFICATION GATE"
check "'not yet complete' is not a claim" "$(a "$(t '[]' '["a.src"]' '[]' '[]' 'This is not yet complete.')")" lacks "VERIFICATION GATE"
check "a real claim still fires" "$(a "$(t '[]' '["a.src"]' '[]' '[]' 'The fix is complete.')")" has "VERIFICATION GATE"
check "state file written via a .. path -> B silent" "$(a "$(t '[]' '[".burhan/work/foo/foo-story.md",".burhan/local/../local/PROGRESS.md"]' '[]' '[]' '')")" lacks "STATE-TRANSITION GATE"
P="$(proj)"; mkdir -p "$P/.burhan/work/foo" "$P/.burhan/discovery"
printf '%s\n' '- **Overall status:** Draft' '### Sub-unit 1 — x · ✅ Reviewed' > "$P/.burhan/work/foo/foo-implementation-plan.md"
check "E: plan Draft with a ✅ Reviewed sub-unit -> fires (QC2)" "$(a "$(t '[]' '[".burhan/work/foo/foo-implementation-plan.md",".burhan/local/PROGRESS.md"]' '[]' '[]' '')")" has "STALE-STATUS GATE"
printf '%s\n' '- **Status:** Planned' '- **Verdict:** Resolved' > "$P/.burhan/discovery/2026-10-11-d.md"
check "E: discovery Planned + Resolved -> fires" "$(a "$(t '[]' '[".burhan/discovery/2026-10-11-d.md"]' '[]' '[]' '')")" has "STALE-STATUS GATE"
printf '%s\n' '- **Overall status:** In progress' '### Sub-unit 1 — x · ✅ Reviewed' > "$P/.burhan/work/foo/foo-implementation-plan.md"
check "E: In progress with a reviewed sub-unit -> silent (normal)" "$(a "$(t '[]' '[".burhan/work/foo/foo-implementation-plan.md",".burhan/local/PROGRESS.md"]' '[]' '[]' '')")" lacks "STALE-STATUS GATE"
printf '%s\n' '- **Status:** Draft' 'The migration completed last year in the old system.' > "$P/.burhan/work/foo/foo-story.md"
check "E: prose word 'completed' is not a done marker" "$(a "$(t '[]' '[".burhan/work/foo/foo-story.md",".burhan/local/PROGRESS.md"]' '[]' '[]' '')")" lacks "STALE-STATUS GATE"

echo "  -- shell redirections count as writes (live E2E finding)"
P="$(proj "${BASE[@]}")"
check "printf >> story (shell) -> B fires" "$(a "$(t '[]' '[]' '["printf %s\\n note >> .burhan/work/foo/foo-story.md && tail -3 .burhan/work/foo/foo-story.md"]' '[]' '')")" has "STATE-TRANSITION GATE"
check "tee -a to the state file counts as writing it" "$(a "$(t '[]' '[".burhan/work/foo/foo-story.md"]' '["echo x | tee -a .burhan/local/PROGRESS.md"]' '[]' '')")" lacks "STATE-TRANSITION GATE"
check "cat > code file (heredoc) -> code written (A)" "$(a "$(t '[]' '[]' '["cat > a.src <<EOF\nx\nEOF"]' '[]' 'done')")" has "VERIFICATION GATE"
check "2>/dev/null is not a write" "$(a "$(t '[]' '[]' '["ls 2>/dev/null"]' '[]' 'done')")" lacks "VERIFICATION GATE"
check "> /dev/null is not a write" "$(a "$(t '[]' '[]' '["grep x a.src > /dev/null"]' '[]' 'done')")" lacks "VERIFICATION GATE"
check "comparison inside [ ] is not a write" "$(a "$(t '[]' '[]' '["[ 3 > 2 ]"]' '[]' 'done')")" lacks "VERIFICATION GATE"

echo "  -- shell-write false positives / misses"
P="$(proj "${BASE[@]}")"
sw() { a "$(t '[]' '[]' "$(jq -cn --arg c "$1" '[$c]')" '[]' "${2:-done}")"; }
check "quoted > in echo is not a write" "$(sw 'echo "a > b.src"')" lacks "VERIFICATION GATE"
check "quoted > in commit message is not a write" "$(sw 'git commit -m "fix: a > b.src"')" lacks "VERIFICATION GATE"
check "=> in quoted code is not a write" "$(sw 'node -e "x=>b.src"')" lacks "VERIFICATION GATE"
check "[[ a > b ]] is not a write" "$(sw '[[ $a > b.src ]]')" lacks "VERIFICATION GATE"
check "here-string with > is not a write" "$(sw 'cat <<< "x > y.src"')" lacks "VERIFICATION GATE"
check "heredoc body line '> path' is not a write" "$(sw $'cat > notes.txt <<\'EOF\'\n> .burhan/work/foo/foo-story.md quoted\nEOF' '')" lacks "STATE-TRANSITION GATE"
check "the heredoc's own target still counts" "$(sw $'cat > a.src <<\'EOF\'\nx\nEOF')" has "VERIFICATION GATE"
check "&> f counts" "$(sw 'run &> a.src')" has "VERIFICATION GATE"
check ">| f counts" "$(sw 'echo x >| a.src')" has "VERIFICATION GATE"
check "1> f counts" "$(sw 'echo x 1> a.src')" has "VERIFICATION GATE"
check "quoted target with a space counts" "$(sw 'echo x > "my a.src"')" has "VERIFICATION GATE"
check "every file in tee a b counts" "$(sw 'echo x | tee -a notes.txt a.src')" has "VERIFICATION GATE"
echo "  -- claims and check E"
for x in "Once that is done we can merge." "None of this is done." "It's not quite done." "Is it done? No."; do
  check "not a claim: $x" "$(a "$(t '[]' '["a.src"]' '[]' '[]' "$x")")" lacks "VERIFICATION GATE"
done
P="$(proj)"; mkdir -p "$P/.burhan/work/foo"
printf '%s\n' '- **Overall status:** Draft' '### Sub-unit 1 — x · ✅' > "$P/.burhan/work/foo/foo-implementation-plan.md"
check "E: emoji-only ✅ sub-unit heading counts as done" "$(a "$(t '[]' '[".burhan/work/foo/foo-implementation-plan.md",".burhan/local/PROGRESS.md"]' '[]' '[]' '')")" has "STALE-STATUS GATE"
printf '%s\n' '- **Status:** Approved' '```' 'Status: Draft' '```' '- ✅ Reviewed' > "$P/.burhan/work/foo/foo-story.md"
check "E: status inside a code block is ignored" "$(a "$(t '[]' '[".burhan/work/foo/foo-story.md",".burhan/local/PROGRESS.md"]' '[]' '[]' '')")" lacks "STALE-STATUS GATE"
printf '%s\n' '- **Status:** Draft' '- Result: ✅ Reviewed → reviews/x.md' > "$P/.burhan/work/foo/foo-story.md"
check "E: a result line with one arrow is not a ladder" "$(a "$(t '[]' '[".burhan/work/foo/foo-story.md",".burhan/local/PROGRESS.md"]' '[]' '[]' '')")" has "STALE-STATUS GATE"

echo "  -- combined"
P="$(proj "${BASE[@]}")"
out="$(a "$(t '[]' '["a.src",".burhan/work/foo/foo-plan.md"]' '["run-everything"]' '[]' 'done')")"
check "several checks -> one message (A)" "$out" has "VERIFICATION GATE"
check "several checks -> one message (B)" "$out" has "STATE-TRANSITION GATE"
echo "  -- H: QC provenance / independence"
P="$(proj "${BASE[@]}")"; mkdir -p "$P/.burhan/work/foo/reviews"
Q=".burhan/work/foo/reviews/foo-qc.md"
cp "$T_KIT/templates/qc.md" "$P/$Q"
check "QC written with the placeholder Performed by -> fires" "$(a "$(t '[]' "[\"$Q\"]" '[]' '[]' '')")" has "QC PROVENANCE"
printf '%s\n' '# QC' '- **Verdict:** PASS' > "$P/$Q"
check "QC written with no Performed by line -> fires" "$(a "$(t '[]' "[\"$Q\"]" '[]' '[]' '')")" has "QC PROVENANCE"
printf '%s\n' '# QC' '- **Performed by:** claude · opus · fresh subagent' > "$P/$Q"
check "QC with provenance -> silent" "$(a "$(t '[]' "[\"$Q\"]" '[]' '[]' '')")" lacks "QC PROVENANCE"
check "QC + code in the same turn -> independence warning" "$(a "$(t '[]' "[\"$Q\",\"a.src\"]" '["verify-it x"]' '[]' '')")" has "QC INDEPENDENCE"
check "QC alone -> no independence warning" "$(a "$(t '[]' "[\"$Q\"]" '[]' '[]' '')")" lacks "QC INDEPENDENCE"
check "a sub-unit review is not a QC file" "$(a "$(t '[]' '[".burhan/work/foo/reviews/foo-task1.md"]' '[]' '[]' '')")" lacks "QC PROVENANCE"
printf '%s\n' '# QC' '- **Performed by:** —' > "$P/$Q"
check "Performed by — (a dash) -> fires, same rule as stats" "$(a "$(t '[]' "[\"$Q\"]" '[]' '[]' '')")" has "QC PROVENANCE"
printf '%s\n' '# QC' '- **Performed by:** claude · opus · fresh subagent (checked a<b paths)' > "$P/$Q"
check "text after the context is not the fixed form -> fires, as stats says unknown" "$(a "$(t '[]' "[\"$Q\"]" '[]' '[]' '')")" has "QC PROVENANCE"
printf '%s\n' '# QC' '- **Performed by:** — (to be filled)' > "$P/$Q"
check "a dash plus an explanation -> fires (same rule as stats)" "$(a "$(t '[]' "[\"$Q\"]" '[]' '[]' '')")" has "QC PROVENANCE"
printf '%s\n' '# QC' '- **Performed by:** claude · opus' > "$P/$Q"
check "no context word (fresh subagent / other agent / human / same session) -> fires, as stats says unknown" "$(a "$(t '[]' "[\"$Q\"]" '[]' '[]' '')")" has "QC PROVENANCE"
for v in 'claude · opus · subagents' 'claude · opus · by the agentic loop'; do
  printf '%s\n' '# QC' "- **Performed by:** $v" > "$P/$Q"
  check "partial words are no context ($v) -> fires, as stats" "$(a "$(t '[]' "[\"$Q\"]" '[]' '[]' '')")" has "QC PROVENANCE"
done
check "a QC re-run file is not a sub-unit review" "$(P="$(proj "${BASE[@]}" 'WF_SKILLS=superpowers')"; a "$(t '[]' '[".burhan/work/foo/reviews/foo-qc-r2.md"]' '[]' '[]' '')")" lacks "SKILL GATE"
SUBQC="{\"turn\":{\"files_created\":[],\"files_edited\":[\"a.src\"],\"shell_commands\":[],\"skills_used\":[],\"assistant_text\":\"\",\"steps\":[{\"seq\":1,\"kind\":\"edit\",\"file\":\"a.src\"},{\"seq\":2,\"kind\":\"edit\",\"file\":\"$Q\",\"by\":\"burhan-reviewer\"}]}}"
check "a QC file written by the reviewer subagent is audited too" "$(a "$SUBQC")" has "QC PROVENANCE"
printf '%s\n' '# QC' '- **Performed by:** claude · opus · fresh subagent' > "$P/$Q"
check "...and a fresh-subagent QC next to the main agent's code is independent -> silent" "$(a "$SUBQC")" lacks "QC INDEPENDENCE"
Q2=".burhan/work/foo/reviews/foo-qc-r2.md"; cp "$T_KIT/templates/qc.md" "$P/$Q2"
check "a QC round file (-qc-r2.md) is audited for provenance too" "$(a "$(t '[]' "[\"$Q2\"]" '[]' '[]' '')")" has "QC PROVENANCE"
check "...also when the reviewer subagent writes it" "$(a "$(jq -cn --arg f "$Q2" '{turn:{files_created:[],files_edited:[],shell_commands:[],skills_used:[],assistant_text:"",steps:[{seq:1,kind:"edit",file:$f,by:"burhan-reviewer"}]}}')")" has "QC PROVENANCE"
echo "  -- A on ordered steps (evidence ledger)"
P="$(proj "${BASE[@]}")"
st() { jq -cn --argjson s "$1" --arg x "${2:-All done.}" '{turn:{files_edited:[ $s[] | select(.kind=="edit") | .file ], shell_commands:[ $s[] | select(.kind=="cmd") | .cmd ], assistant_text:$x, steps:$s}}'; }
E1='{"kind":"edit","file":"a.src","seq":1}'
check "edit -> passing evidence -> claim: silent" "$(a "$(st "[$E1,{\"kind\":\"cmd\",\"cmd\":\"verify-it a\",\"exit\":0,\"status\":\"ok\",\"seq\":2}]")")" lacks "VERIFICATION GATE"
out="$(a "$(st '[{"kind":"cmd","cmd":"verify-it a","exit":0,"status":"ok","seq":1},{"kind":"edit","file":"a.src","seq":2}]')")"
check "evidence BEFORE the last code edit -> fires" "$out" has "before the last code edit"
check "...names the file edited after it" "$out" has "a.src"
out="$(a "$(st "[$E1,{\"kind\":\"cmd\",\"cmd\":\"verify-it a\",\"exit\":3,\"status\":\"failed\",\"seq\":2}]")")"
check "failed evidence -> fires with the exit code" "$out" has "failed (exit 3)"
check "unknown exit (agent did not report) -> accepted" "$(a "$(st "[$E1,{\"kind\":\"cmd\",\"cmd\":\"verify-it a\",\"exit\":null,\"status\":\"unknown\",\"seq\":2}]")")" lacks "VERIFICATION GATE"
check "a non-code edit after the evidence does not count" "$(a "$(st "[$E1,{\"kind\":\"cmd\",\"cmd\":\"verify-it a\",\"exit\":0,\"status\":\"ok\",\"seq\":2},{\"kind\":\"edit\",\"file\":\"notes.md\",\"seq\":3}]")")" lacks "VERIFICATION GATE"
check "fail then pass after the edit -> silent" "$(a "$(st "[$E1,{\"kind\":\"cmd\",\"cmd\":\"verify-it a\",\"exit\":1,\"status\":\"failed\",\"seq\":2},{\"kind\":\"cmd\",\"cmd\":\"verify-it a\",\"exit\":0,\"status\":\"ok\",\"seq\":3}]")")" lacks "VERIFICATION GATE"
check "no claim -> silent even with failed evidence" "$(a "$(st "[$E1,{\"kind\":\"cmd\",\"cmd\":\"verify-it a\",\"exit\":3,\"status\":\"failed\",\"seq\":2}]" 'still working')")" lacks "VERIFICATION GATE"

echo "  -- evidence ledger store"
EVD="$(t_tmp)/ev"; export WF_EVIDENCE_DIR="$EVD"
P="$(proj "${BASE[@]}")"; mkdir -p "$P/.burhan/local"; printf '%s\n' '## Now' '### add-export' '- **Next action:** x' > "$P/.burhan/local/PROGRESS.md"
KEY="$(cd "$P" && pwd -P | tr -d '\n' | t_sha | cut -c1-16)"
evl() { jq -c --arg s "$1" --arg t "$2" '. + {session:$s, turn_id:$t, agent:"claude"}' <<<"$3"; }
ev3="$(st "[$E1,{\"kind\":\"cmd\",\"cmd\":\"verify-it a\",\"exit\":3,\"status\":\"failed\",\"seq\":2},{\"kind\":\"cmd\",\"cmd\":\"verify-it a\",\"exit\":0,\"status\":\"ok\",\"seq\":3}]")"
a "$(evl S1 T1 "$ev3")" >/dev/null
L="$EVD/$KEY/S1/T1.jsonl"
check_eq "ledger file per project/session/turn" "$( [ -f "$L" ] && wc -l < "$L" | tr -d ' ')" "3"
check "records carry exit, status, seq" "$(sed -n 2p "$L" 2>/dev/null)" has '"exit":3'
check "records carry the item in flight" "$(sed -n 1p "$L" 2>/dev/null)" has '"item":"add-export"'
check "edit paths are project-relative" "$(sed -n 1p "$L" 2>/dev/null)" has '"file":"a.src"'
check "no output is stored, only the command" "$(cat "$L" 2>/dev/null)" lacks "stdout"
a "$(evl S1 T1 "$ev3")" >/dev/null
check_eq "re-audit of the same turn rewrites, never duplicates" "$(wc -l < "$L" | tr -d ' ')" "3"
a "$(evl '../escape' T1 "$ev3")" >/dev/null
check_eq "unsafe session id -> nothing written outside the ledger" "$(find "$EVD/.." -maxdepth 2 -name 'escape*' | wc -l | tr -d ' ')" "0"
check_eq "no session -> nothing written" "$(a "$(st "[$E1]" 'hi')" >/dev/null; find "$EVD/$KEY" -name '*.jsonl' | wc -l | tr -d ' ')" "1"
RO="$(t_tmp)/ro"; mkdir -p "$RO"; chmod 555 "$RO"
out="$(WF_EVIDENCE_DIR="$RO/x" core turn-audit "$(ev "$(evl S2 T2 "$(st '[{"kind":"cmd","cmd":"verify-it a","exit":0,"status":"ok","seq":1},{"kind":"edit","file":"a.src","seq":2}]')")")")"
check "unwritable ledger dir -> the audit still speaks (fail open)" "$out" has "before the last code edit"
unset WF_EVIDENCE_DIR
mkdir -p "$P/.burhan/work/foo/reviews"; printf '%s\n' '# QC' '- **Performed by:** claude · opus · same session' '## 5. Limitations' 'same session' > "$P/.burhan/work/foo/reviews/foo-qc.md"
check "same session already recorded -> no independence warning" "$(a "$(t '[]' '[".burhan/work/foo/reviews/foo-qc.md","a.src"]' '["verify-it x"]' '[]' '')")" lacks "QC INDEPENDENCE"
printf '%s\n' '# QC' '- **Performed by:** **claude · opus · fresh subagent**' > "$P/.burhan/work/foo/reviews/foo-qc.md"
check "bold around the whole value is the same fixed form (hook = stats)" "$(a "$(t '[]' '[".burhan/work/foo/reviews/foo-qc.md"]' '[]' '[]' '')")" lacks "QC PROVENANCE"
echo "  -- evidence regressions"
P="$(proj "${BASE[@]}")"
out="$(a "$(st "[$E1,{\"kind\":\"cmd\",\"cmd\":\"verify-it a\",\"exit\":0,\"status\":\"ok\",\"seq\":2},{\"kind\":\"cmd\",\"cmd\":\"verify-it a\",\"exit\":1,\"status\":\"failed\",\"seq\":3}]")")"
check "pass then FAIL after the edit -> the last run decides" "$out" has "failed (exit 1)"
out="$(a "$(st "[$E1,{\"kind\":\"cmd\",\"cmd\":\"verify-it a\",\"exit\":null,\"status\":\"background\",\"seq\":2}]")")"
check "evidence only in the background -> its result is unknown, says so" "$out" has "in the background"
out="$(a "$(st "[$E1,{\"kind\":\"cmd\",\"cmd\":\"verify-it a\",\"exit\":null,\"status\":\"blocked\",\"seq\":2}]")")"
check "blocked evidence is no proof" "$out" has "VERIFICATION GATE"
EVD="$(t_tmp)/ev2"; export WF_EVIDENCE_DIR="$EVD"
P="$(proj "${BASE[@]}")"; KEY="$(cd "$P" && pwd -P | tr -d '\n' | t_sha | cut -c1-16)"
re="$(jq -c '. + {reentrant:true, session:"S9", turn_id:"T9", agent:"claude"}' <<<"$(st "[$E1,{\"kind\":\"cmd\",\"cmd\":\"verify-it a\",\"exit\":0,\"status\":\"ok\",\"seq\":2}]")")"
a "$re" >/dev/null
check_eq "a reentrant Stop still records the ledger" "$(wc -l < "$EVD/$KEY/S9/T9.jsonl" 2>/dev/null | tr -d ' ')" "2"
p1="$(jq -c '. + {session:"S8", turn_id:"T8", agent:"codex", turn_scope:"since_last_stop"}' <<<"$(st "[$E1]" 'x')")"
p2="$(jq -c '. + {reentrant:true, session:"S8", turn_id:"T8", agent:"codex", turn_scope:"since_last_stop"}' <<<"$(st '[{"kind":"cmd","cmd":"verify-it a","exit":0,"status":"ok","seq":1}]' 'x')")"
a "$p1" >/dev/null; a "$p2" >/dev/null
check_eq "Codex parts of one turn are kept side by side, not overwritten" "$(cat "$EVD/$KEY/S8/"T8*.jsonl 2>/dev/null | wc -l | tr -d ' ')" "2"
check_eq "ledger dirs are private" "$(t_mode "$EVD/$KEY/S9" 2>/dev/null)" "700"
P2="$(proj "${BASE[@]}" 'WF_EVIDENCE_LEDGER=off')"
a "$(jq -c --arg p "$P2" '. + {session:"S7", turn_id:"T7", project_dir:$p}' <<<"$(st "[$E1]" 'x')")" >/dev/null
check_eq "WF_EVIDENCE_LEDGER=off -> nothing written" "$(find "$EVD" -mindepth 2 -maxdepth 2 -name S7 | wc -l | tr -d ' ')" "0"
mkdir -p "$EVD/$KEY/OLDS"; t_age 40 "$EVD/$KEY/OLDS"; : > "$EVD/.burhan-evidence"
a "$(jq -c '. + {session:"S6", turn_id:"T6"}' <<<"$(st "[$E1]" 'x')")" >/dev/null
check "sessions older than 30 days are pruned" "$( [ -d "$EVD/$KEY/OLDS" ] && echo kept)" lacks kept
mkdir -p "$P/.burhan/local"; printf '%s\n' '## Now' '### <slug>' > "$P/.burhan/local/PROGRESS.md"
a "$(jq -c '. + {session:"S5", turn_id:"T5"}' <<<"$(st "[$E1]" 'x')")" >/dev/null
check "an unfilled template slug is no item" "$(cat "$EVD/$KEY/S5/T5.jsonl" 2>/dev/null)" has '"item":null'
printf '%s\n' '## Now' '#### deep' > "$P/.burhan/local/PROGRESS.md"
a "$(jq -c '. + {session:"S4", turn_id:"T4"}' <<<"$(st "[$E1]" 'x')")" >/dev/null
check "a #### heading is no item" "$(cat "$EVD/$KEY/S4/T4.jsonl" 2>/dev/null)" has '"item":null'
BIG="$(jq -cn '[range(1;1500) | if . % 3 == 0 then {kind:"edit",file:"a.src",seq:.} else {kind:"cmd",cmd:"echo \(.)",exit:0,status:"ok",seq:.} end] + [{kind:"cmd",cmd:"verify-it a",exit:0,status:"ok",seq:1500}]')"
t0=$(date +%s); out="$(a "$(jq -c '. + {session:"S3", turn_id:"T3"}' <<<"$(st "$BIG")")")"; t1=$(date +%s)
check "a 1,500-step turn is audited and recorded in seconds" "$(( t1 - t0 ))s $(wc -l < "$EVD/$KEY/S3/T3.jsonl" 2>/dev/null | tr -d ' ')" has " 1500"
check "...and well under the hook timeout" "$( [ $(( t1 - t0 )) -lt 8 ] && echo fast)" has fast
unset WF_EVIDENCE_DIR
echo "  -- patch lane: no story/plan, but evidence still required"
P="$(proj "${BASE[@]}" 'WF_SKILLS=superpowers')"
check "declared patch -> no TDD skill gate" "$(a "$(t '[]' '["a.src"]' '["verify-it a"]' '[]' 'patch — typo in a message. Done, verify-it a passed.')")" lacks "SKILL GATE (code)"
check "undeclared -> the skill gate still fires" "$(a "$(t '[]' '["a.src"]' '["verify-it a"]' '[]' 'Done, verify-it a passed.')")" has "SKILL GATE (code)"
check "a patch still needs evidence" "$(a "$(t '[]' '["a.src"]' '[]' '[]' 'patch — typo. Done.')")" has "VERIFICATION GATE"
check "'Applied the patch: see diff' is not a routing line" "$(a "$(t '[]' '["a.src"]' '["verify-it a"]' '[]' 'Applied the patch: see diff. Done.')")" has "SKILL GATE (code)"
mkdir -p "$P/.burhan/local"; printf '%s\n' '## Now' '### big-item' '- **Type / scope:** feature / architectural' > "$P/.burhan/local/PROGRESS.md"
check "a patch line while a routed item is in flight -> no exemption" "$(a "$(t '[]' '["a.src"]' '["verify-it a"]' '[]' 'patch — typo. Done.')")" has "SKILL GATE (code)"
printf '%s\n' '## Now' '### fix-typo' '- **Route:** change / patch' > "$P/.burhan/local/PROGRESS.md"
check "...but an item whose Route is patch keeps it" "$(a "$(t '[]' '["a.src"]' '["verify-it a"]' '[]' 'patch — typo. Done.')")" lacks "SKILL GATE (code)"
rm -f "$P/.burhan/local/PROGRESS.md"
P="$(proj "${BASE[@]}" 'WF_SKILLS=superpowers' "WF_SENSITIVE_REGEX='auth'")"
P="$(proj "${BASE[@]}" 'WF_SKILLS=superpowers')"; mkdir -p "$P/.burhan/local"
printf '%s\n' '## Now' '### big-item' '- **Type / scope:** feature / architectural' '### other' '- **Route:** patch' > "$P/.burhan/local/PROGRESS.md"
check "Route: patch on ANOTHER item does not exempt the item in flight" "$(a "$(t '[]' '["a.src"]' '["verify-it a"]' '[]' 'patch — typo. Done.')")" has "SKILL GATE (code)"
printf '%s\n' '## Now' '### fix-typo' '- **Type / scope:** change / patch' > "$P/.burhan/local/PROGRESS.md"
check "Type / scope: change / patch counts as a patch route" "$(a "$(t '[]' '["a.src"]' '["verify-it a"]' '[]' 'patch — typo. Done.')")" lacks "SKILL GATE (code)"
rm -f "$P/.burhan/local/PROGRESS.md"
check "'Patch: …' is not the routing line (patch — reason)" "$(a "$(t '[]' '["a.src"]' '["verify-it a"]' '[]' 'Patch: applied. Done.')")" has "SKILL GATE (code)"
check "'patchwork — …' is not the routing line" "$(a "$(t '[]' '["a.src"]' '["verify-it a"]' '[]' 'patchwork — misc. Done.')")" has "SKILL GATE (code)"
mkdir -p "$P/.burhan/local"
printf '%s\n' '## Now' '### <slug>' '- **Type / scope:** <type> / <scope>' > "$P/.burhan/local/PROGRESS.md"
check "an untouched template heading is no item in flight" "$(a "$(t '[]' '["a.src"]' '["verify-it a"]' '[]' 'patch — typo. Done.')")" lacks "SKILL GATE (code)"
printf '%s\n' '## Now' '### fix-typo' '- **Route:** change / patch · **Mode:** step' > "$P/.burhan/local/PROGRESS.md"
check "the fixed form '**Route:** change / patch' next to another field is read" "$(a "$(t '[]' '["a.src"]' '["verify-it a"]' '[]' 'patch — typo. Done.')")" lacks "SKILL GATE (code)"
printf '%s\n' '## Now' '### grown' '- **Type / scope:** change / bounded (promoted; was Route: patch)' > "$P/.burhan/local/PROGRESS.md"
check "a promoted item that mentions 'was Route: patch' is not a patch" "$(a "$(t '[]' '["a.src"]' '["verify-it a"]' '[]' 'patch — typo. Done.')")" has "SKILL GATE (code)"
printf '%s\n' '## Now' '### grown' '- **Route:** change / patch-level' > "$P/.burhan/local/PROGRESS.md"
check "'Route: change / patch-level' is not the exact patch route" "$(a "$(t '[]' '["a.src"]' '["verify-it a"]' '[]' 'patch — typo. Done.')")" has "SKILL GATE (code)"
printf '%s\n' '## Now' '### f' '- **Route:** feature / patch' > "$P/.burhan/local/PROGRESS.md"
check "feature / patch is not a patch lane (only change, bug, refactor — core §3)" "$(a "$(t '[]' '["a.src"]' '["verify-it a"]' '[]' 'patch — typo. Done.')")" has "SKILL GATE (code)"
rm -f "$P/.burhan/local/PROGRESS.md"
P="$(proj "${BASE[@]}" 'WF_SKILLS=superpowers' "WF_SENSITIVE_REGEX='auth'")"
check "a patch that touches a sensitive path -> no exemption" "$(a "$(t '[]' '["src/auth.src"]' '["verify-it a"]' '[]' 'patch — one line. Done.')")" has "SKILL GATE (code)"
P="$(proj "${BASE[@]}" 'WF_SKILLS=superpowers')"
P="$(proj "${BASE[@]}" 'WF_SKILLS=superpowers')"
check "the single review file counts as a review (skill gate)" "$(a "$(t '[]' '[".burhan/work/foo/reviews/foo-review.md"]' '[]' '[]' '')")" has "SKILL GATE"
mkdir -p "$P/.burhan/work/foo/reviews"
for v in pending TBD 'waiting for the reviewer' 'fresh subagent' 'same session' 'claude · fresh subagent' '<agent> · <model> · fresh subagent' 'claude · opus · same session · fresh subagent'; do
  printf '%s\n' '# QC' "- **Performed by:** $v" > "$P/.burhan/work/foo/reviews/foo-qc.md"
  check "Performed by: $v -> no provenance" "$(a "$(t '[]' '[".burhan/work/foo/reviews/foo-qc.md"]' '[]' '[]' '')")" has "QC PROVENANCE"
done
echo "  -- evidence regressions (2)"
P="$(proj "WF_CODE_REGEX='\\.src\$'" "WF_EVIDENCE_REGEX='^verify-it'")"
out="$(a "$(st '[{"kind":"cmd","cmd":"verify-it a","exit":0,"status":"ok","seq":1},{"kind":"edit","file":"./a.src","seq":2}]')")"
check "a ./-prefixed edit after the evidence is still the last code edit" "$out" has "before the last code edit"
P="$(proj "WF_CODE_REGEX='\\.(js|ts)\\b'" "WF_EVIDENCE_REGEX='\\bverify-it\\b'")"
out="$(jq -c '.turn.files_edited=["src/a.js"]' <<<"$(st '[{"kind":"cmd","cmd":"verify-it a","exit":0,"status":"ok","seq":1},{"kind":"edit","file":"src/a.js","seq":2}]')")"
check "the same regex dialect as the code-written check (\\b)" "$(a "$out")" has "before the last code edit"
out="$(jq -c '.turn.files_edited=["src/a.js"]' <<<"$(st '[{"kind":"edit","file":"src/a.js","seq":1},{"kind":"cmd","cmd":"verify-it a","exit":0,"status":"ok","seq":2}]')")"
check "...and a \\b evidence pattern is recognised (no false 'no verification')" "$(a "$out")" lacks "VERIFICATION GATE"
P="$(proj "${BASE[@]}")"
out="$(a "$(st "[$E1,{\"kind\":\"cmd\",\"cmd\":\"verify-it test\",\"exit\":1,\"status\":\"failed\",\"seq\":2},{\"kind\":\"cmd\",\"cmd\":\"verify-it lint\",\"exit\":0,\"status\":\"ok\",\"seq\":3}]")")"
check "a failed evidence command is not hidden by a different one that passed" "$out" has "verify-it test"
out="$(a "$(st "[$E1,{\"kind\":\"cmd\",\"cmd\":\"verify-it a\",\"exit\":null,\"status\":\"failed\",\"seq\":2}]")")"
check "failed with no exit code -> no '(exit ?)'" "$out" lacks "exit ?"
echo "  -- ledger safety"
EVD3="$(t_tmp)/shared-state"; mkdir -p "$EVD3/someone-else/old"; t_age 60 "$EVD3/someone-else/old" "$EVD3/someone-else"
export WF_EVIDENCE_DIR="$EVD3"
P="$(proj "${BASE[@]}")"
a "$(jq -c '. + {session:"S1", turn_id:"T1"}' <<<"$(st "[$E1]" 'x')")" >/dev/null
check "a pre-existing directory is never pruned by burhan (no marker written into it)" "$( [ -d "$EVD3/someone-else/old" ] && echo kept)" has kept
check "...and no marker is planted in a directory burhan did not create" "$( [ -e "$EVD3/.burhan-evidence" ] && echo planted)" lacks planted
export WF_EVIDENCE_DIR="relative/dir"
RC="$(t_tmp)"   # run from a scratch cwd: a regression must not write into the repo running the suite
(cd "$RC" && a "$(jq -c '. + {session:"S2", turn_id:"T2"}' <<<"$(st "[$E1]" 'x')")" >/dev/null)
check "a relative WF_EVIDENCE_DIR never writes inside the project" "$( [ -e "$P/relative" ] && echo inside)" lacks inside
check "...nor relative to the current directory" "$( [ -e "$RC/relative" ] && echo cwd)" lacks cwd
unset WF_EVIDENCE_DIR
EVD4="$(t_tmp)/ev4"; export WF_EVIDENCE_DIR="$EVD4"
mkdir -p "$P/.burhan/local"; printf '%s\n' '## Now' '### foo' '- **Sub-unit:** 2/3 — 🔵 In progress' > "$P/.burhan/local/PROGRESS.md"
a "$(jq -c '. + {session:"S3", turn_id:"T3"}' <<<"$(st "[$E1]" 'x')")" >/dev/null
check "records carry the phase (sub-unit) from the state file (spec E-1)" "$(cat "$EVD4"/*/S3/T3.jsonl 2>/dev/null)" has '"phase":"2/3 — 🔵 In progress"'
unset WF_EVIDENCE_DIR
echo "  -- subagent steps"
# sst: like st, but only the MAIN agent's steps (no "by") appear in files_edited / shell_commands.
sst() { jq -cn --argjson s "$1" --arg x "${2:-All done ✅}" '{turn:{files_created:[], files_edited:[ $s[] | select(.kind=="edit" and (has("by")|not)) | .file ], shell_commands:[ $s[] | select(.kind=="cmd" and (has("by")|not)) | .cmd ], skills_used:[], assistant_text:$x, steps:$s}}'; }
P="$(proj "${BASE[@]}")"
out="$(a "$(sst '[{"kind":"edit","file":"a.src","seq":1},{"kind":"cmd","cmd":"verify-it a","exit":0,"status":"ok","seq":2},{"kind":"cmd","cmd":"verify-it a; echo $?","exit":null,"status":"blocked","seq":3,"by":"burhan-reviewer"}]')")"
check "a subagent's refused probe after a passing run proves nothing either way -> silent" "$out" lacks "VERIFICATION GATE"
out="$(a "$(sst '[{"kind":"edit","file":"a.src","seq":1},{"kind":"cmd","cmd":"verify-it a","exit":0,"status":"ok","seq":2},{"kind":"cmd","cmd":"verify-it a","exit":null,"status":"blocked","seq":3}]')")"
check "a blocked re-run never ran: it does not undo the earlier pass of the same command" "$out" lacks "VERIFICATION GATE"
out="$(a "$(sst '[{"kind":"edit","file":"a.src","seq":1},{"kind":"cmd","cmd":"verify-it a","exit":null,"status":"blocked","seq":2}]')")"
check "only blocked evidence -> still the gate, naming the command (#6: empty exit field)" "$out" has 'last run of `verify-it a` was blocked'
out="$(a "$(sst '[{"kind":"edit","file":"a.src","seq":1},{"kind":"cmd","cmd":"verify-it a","exit":null,"status":"failed","seq":2}]')")"
check "failed with no exit code -> the message names the command" "$out" has 'last run of `verify-it a` failed.'
out="$(a "$(sst '[{"kind":"edit","file":"a.src","seq":1,"by":"burhan-builder"},{"kind":"cmd","cmd":"verify-it a","exit":0,"status":"ok","seq":2,"by":"burhan-builder"},{"kind":"cmd","cmd":"verify-it b","exit":2,"status":"failed","seq":3,"by":"burhan-builder"}]')")"
check "the builder's real failing evidence run after its edit still fires" "$out" has 'last run of `verify-it b` failed (exit 2)'
out="$(a "$(sst '[{"kind":"edit","file":"a.src","seq":1},{"kind":"cmd","cmd":"verify-it suite","exit":1,"status":"failed","seq":2,"by":"burhan-reviewer"}]')")"
check "a reviewer's REAL failing suite run after the edit fires — a failure from any agent counts" "$out" has 'last run of `verify-it suite` failed (exit 1)'
out="$(a "$(sst '[{"kind":"edit","file":"t.test","seq":1,"by":"burhan-builder"},{"kind":"edit","file":"a.src","seq":2},{"kind":"cmd","cmd":"verify-it a","exit":0,"status":"ok","seq":3,"by":"general-purpose"}]')")"
check "a subagent's passing run after the main agent's edit is credited" "$out" lacks "VERIFICATION GATE"
out="$(a "$(sst '[{"kind":"edit","file":"a.src","seq":1},{"kind":"cmd","cmd":"verify-it a","exit":null,"status":"unknown","seq":2,"by":"general-purpose"}]')")"
check "a still-running subagent's run with no result yet is no pass" "$out" has "VERIFICATION GATE"
out="$(a "$(sst '[{"kind":"edit","file":"a.src","seq":1},{"kind":"cmd","cmd":"verify-it a","exit":0,"status":"ok","seq":2,"by":"general-purpose"},{"kind":"cmd","cmd":"verify-it a","exit":null,"status":"unknown","seq":3,"by":"general-purpose"}]')")"
check "...and does not undo the subagent's earlier pass of the same command" "$out" lacks "VERIFICATION GATE"
out="$(a "$(sst '[{"kind":"edit","file":"a.src","seq":1},{"kind":"cmd","cmd":"verify-it test","exit":null,"status":"blocked","seq":2},{"kind":"cmd","cmd":"verify-it lint","exit":0,"status":"ok","seq":3}]')")"
check "main agent: a blocked evidence command is NOT hidden by another one that passed" "$out" has 'last run of `verify-it test` was blocked'
out="$(a "$(sst '[{"kind":"edit","file":"a.src","seq":1},{"kind":"cmd","cmd":"verify-it test","exit":null,"status":"background","seq":2},{"kind":"cmd","cmd":"verify-it lint","exit":0,"status":"ok","seq":3}]')")"
check "...nor a background one" "$out" has 'last run of `verify-it test` was in the background'
P="$(proj "${BASE[@]}")"
out="$(a "$(sst '[{"kind":"edit","file":".burhan/work/foo/reviews/foo-qc.md","seq":1,"by":"burhan-reviewer"},{"kind":"edit","file":".burhan/local/PROGRESS.md","seq":2,"by":"burhan-reviewer"}]' 'qc written')")"
check "B: the state file written by the subagent counts" "$out" lacks "STATE-TRANSITION GATE"
P="$(proj "${BASE[@]}")"
out="$(a "$(sst '[{"kind":"edit","file":".burhan/work/foo/foo-story.md","seq":1,"by":"burhan-planner"}]' 'story drafted')")"
check "B: a story written by a planner subagent with no state update -> fires" "$out" has "STATE-TRANSITION GATE"
out="$(a "$(sst '[{"kind":"edit","file":".burhan/work/foo/foo-story.md","seq":1,"by":"burhan-planner"},{"kind":"edit","file":".burhan/local/PROGRESS.md","seq":2}]' 'story drafted')")"
check "...and silent once the main agent writes the state file" "$out" lacks "STATE-TRANSITION GATE"
t_summary
