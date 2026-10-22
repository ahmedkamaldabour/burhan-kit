#!/usr/bin/env bash
# WORKFLOW.md and templates/ stay in sync; the config example documents every key.
. "$(dirname "$0")/lib.sh"
cd "$T_KIT" || exit 1

EXPECTED="bindings story plan findings discovery progress review qc verification docs-index project context-area"
KEYS="WF_DOCS_DIR WF_DISCOVERY_DIR WF_STATE_FILE WF_STATE_BUDGET WF_CHECK_CMD WF_CHECK_TIMEOUT
WF_EVIDENCE_REGEX WF_CODE_REGEX WF_TEST_REGEX WF_SENSITIVE_REGEX WF_SENSITIVE_NOTE
WF_SKILLS WF_MODEL_CLAUDE_REVIEWER WF_EVIDENCE_LEDGER WF_EVIDENCE_DIR WF_MODE_DEFAULT WF_REVIEWER_AGENT WF_MODEL_CLAUDE_PLANNER WF_MODEL_CLAUDE_BUILDER WF_MODEL_CLAUDE_EXPLORER WF_STACK_SETUP"

wf="$(cat WORKFLOW.md phases/*.md 2>/dev/null)"   # the agreement = the core + the phase files

echo "shipped guidance — removed settings and resource rules are absent"
removed='WF_FORBIDDEN|never-run|neverRun|NEVER RUN|FORBIDDEN|SINGLE_TEST_HINT|one file at a time|one at a time|resource constraint|single-file test hint|single test files only|full test suite.*memory|blocking mode|أوامر ممنوعة'
hits="$(grep -n -i -E "$removed" "$T_ROOT"/README*.md "$T_ROOT/ROADMAP.md" workflow.config.example; find "$T_ROOT/docs" . -type f -name '*.md' -exec grep -n -i -E "$removed" {} +)"
check_eq "no removed feature in any shipped guide, template or public doc" "$hits" ""
for key in WF_FORBIDDEN_REGEX WF_FORBIDDEN_REASON WF_SINGLE_TEST_HINT; do
  check "config example omits $key" "$(cat workflow.config.example)" lacks "$key"
done
check "no replacement permission/resource boundary in WORKFLOW" "$wf" lacks "Blocking belongs"
check "no replacement permission boundary in configuration docs" "$(cat "$T_ROOT/docs/configuration.md")" lacks "Codex execpolicy"

echo "templates — every expected template exists and is referenced by the agreement (core + phases)"
for t in $EXPECTED; do
  check "templates/$t.md exists" "$( [ -f "templates/$t.md" ] && echo yes)" has "yes"
  check "WORKFLOW.md references templates/$t.md" "$wf" has "templates/$t.md"
done

echo "templates — no unreferenced template files"
for f in templates/*.md; do
  [ -e "$f" ] || continue
  check "$f is referenced by WORKFLOW.md" "$wf" has "$f"
done

echo "templates — every reference in WORKFLOW.md points to a real file"
while IFS= read -r ref; do
  check "$ref exists" "$( [ -f "$ref" ] && echo yes)" has "yes"
done < <(printf '%s' "$wf" | grep -o -E 'templates/[a-z-]+\.md' | sort -u)

echo "commands — exist and only reference real templates"
for c in e2e qc onboard; do
  check "commands/$c.md exists" "$( [ -f "commands/$c.md" ] && echo yes)" has "yes"
done
while IFS= read -r ref; do
  check "commands reference $ref — exists" "$( [ -f "$ref" ] && echo yes)" has "yes"
done < <(cat commands/*.md 2>/dev/null | grep -o -E 'templates/[a-z-]+\.md' | sort -u)

echo "onboard command (project-scan-and-memory AC-02…AC-05, AC-12)"
ob="$(cat commands/onboard.md 2>/dev/null)"
for phrase in \
  'description:' \
  '.burhan/local/onboard-request.md' \
  'a request is a task to do, not knowledge about the project' \
  'kit command' \
  'inspect' \
  'Every topic of the checklist gets an answer' \
  'Architecture' 'Stack' 'Data' 'Integrations' 'Environments' 'Conventions' 'Business rules' 'Decisions' \
  'Purpose' 'Where to look first' 'Discovery limitations' \
  'decides where to look closer, never what to skip' \
  '- **Baseline:** Draft' \
  'Inspected' 'Sampled' 'Not inspected' \
  'a path and a hash, never content' \
  'never the secret itself' \
  'memory check' 'memory status' \
  'Stop and wait for the person' \
  'ask the person what name to write' \
  'never guess it' \
  'Never write Approved or Waived on your own' \
  'continue the saved request, so the person never has to say it twice' \
  'An Approved baseline is not redone' \
  'A Draft baseline is completed' \
  '## Refresh' \
  're-check only the facts it lists as changed or missing' \
  'reconfirm or supersede' \
  'changed does not mean false' \
  'show the person the result before saving' \
  'commit checkpoint' \
  "sed 's/\\r\$//' <file> | sha256sum | cut -c1-16" \
  'line endings were counted differently' \
  '**Waive**' \
  'the draft is not memory' \
  '(git-ignored)' \
  'write no draft' \
  'a refresh never changes the Baseline line' \
  'operational and security risks' \
  'add the new fact under a new ID' \
  'YYYY-MM-DD' \
  'has no `·` and no `<`' \
  'Only a clear yes approves' \
  'never hash a file that holds secrets' \
  'A Draft in the repository is not memory' \
  'continue any saved request (step 7)' \
  'change the draft, present it again' \
  '`- **Baseline:** Waived — <name> · YYYY-MM-DD`' \
  'there are no memory files to commit' \
  'if it is meant for later, ask whether to start it now' \
  'a reconfirmation is a save too' ; do
  check "onboard says: $phrase" "$ob" has "$phrase"
done
check "onboard: no approval on the person's behalf (core §4-D)" "$ob" has "§4-D"

echo "workflow.config.example — documents every key"
cfg="$(cat workflow.config.example 2>/dev/null)"
for k in $KEYS; do
  check "$k defined (uncommented)" "$(printf "%s\n" "$cfg" | grep -E "^$k=")" has "$k="
done
check "config example is valid shell" "$(bash -n workflow.config.example 2>&1 && echo OK)" has "OK"
header="$(sed -n '4p' workflow.config.example)"
config_grammar='Inside single quotes, $, backticks and \ are literal; a single-quoted value cannot contain a single quote.'
check "config header states the real single-quote grammar" "$header" has "$config_grammar"
echo "team layout"
echo "canonical install namespace and guidance"
for file in "$T_ROOT/README.md" "$T_ROOT/README.ar.md" "$T_ROOT/docs/configuration.md"; do
  check "$file names the canonical root" "$(cat "$file")" has '.burhan/'
  check "$file offers the optional Claude Code plugin" "$(cat "$file")" has '/plugin install superpowers@claude-plugins-official'
done
for mark in '<!-- burhan:start -->' '<!-- burhan:end -->'; do
  check "configuration documents exact Markdown marker $mark" "$(cat "$T_ROOT/docs/configuration.md")" has "$mark"
done
check "configuration names the namespaced skill" "$(cat "$T_ROOT/docs/configuration.md")" has '.claude/skills/burhan-verify/SKILL.md'
for rule in /local/ /work/ /discovery/; do
  check "configuration documents scoped ignore rule $rule" "$(cat "$T_ROOT/docs/configuration.md")" has "\`$rule\`"
done
check_eq "guidance has no hook-removal or folder-moving choices" "$(grep -n -i -E 'keep both|remove-mine|moveDocs|AI_SPEC|ولا تشيل بتوعك' "$T_ROOT"/README*.md "$T_ROOT/docs/configuration.md" SETUP.md)" ''
check "state file default is per developer" "$(grep -E '^WF_STATE_FILE=' workflow.config.example)" has ".burhan/local/PROGRESS.md"
check "work defaults are private" "$(grep -E '^WF_DOCS_DIR=' workflow.config.example)" has ".burhan/work"
check "discovery defaults are private" "$(grep -E '^WF_DISCOVERY_DIR=' workflow.config.example)" has ".burhan/discovery"
check "memory entry stays inside the namespace" "$(cat phases/memory.md)" has '.burhan/PROJECT.md'
check "memory areas stay inside the namespace" "$(cat templates/project.md)" has '.burhan/context/stack.md'
check "verify skill is namespaced" "$(cat skills/claude/burhan-verify/SKILL.md 2>/dev/null)" has 'name: burhan-verify'
check "memory IDs are slugs, not sequential" "$(cat templates/context-area.md)" lacks "<AREA>-01"
echo "project memory format (project-scan-and-memory SU1)"
proj="$(cat templates/project.md)"; area="$(cat templates/context-area.md)"; story_t="$(cat templates/story.md)"
check "PROJECT template: the Baseline line starts as Draft" "$proj" has '- **Baseline:** Draft'
check "PROJECT template: the Approved form" "$proj" has '`Approved — <name> · YYYY-MM-DD`'
check "PROJECT template: the Waived form" "$proj" has '`Waived — <name> · YYYY-MM-DD`'
check "PROJECT template: the old field is gone" "$proj" lacks 'Memory status'
for line in '## Coverage' '- **Inspected:**' '- **Sampled:**' '- **Not inspected:**'; do
  check "PROJECT template: $line" "$proj" has "$line"
done
check "context template: evidence carries a whole-file hash" "$area" has '`path/to/file` sha256:<16 hex>'
check "context template: Verified is date @ commit" "$area" has 'YYYY-MM-DD @ <commit>'
check "context template: the hash covers the whole file" "$area" has 'The hash covers the whole file'
check "story template: the Baseline line" "$story_t" has '- **Baseline:** <Approved — <name> · YYYY-MM-DD | Waived — <name> · YYYY-MM-DD | n/a (greenfield)>'
baseline_row="$(grep -F '| `Baseline` |' phases/files.md)"
check "Fields table: the Baseline row" "$baseline_row" has '| `Baseline` |'
for form in '`Draft`' '`Approved — <name> · YYYY-MM-DD`' '`Waived — <name> · YYYY-MM-DD`' '`n/a (greenfield)`' 'no `<` or `·`' '`Memory status: Approved YYYY-MM-DD` counts as Approved' 'any other `Memory status:` value counts as `Draft`'; do
  check "Fields table: Baseline names $form" "$baseline_row" has "$form"
done
check "context template: Verified header uses the @ form" "$area" has 'Verified (date @ commit)'
check "context template: evidence items are space-separated, hash in lower-case hex" "$area" has 'separated by a space; the hash is lower-case hex'
check "context template: a row with < is a placeholder" "$area" has 'a row whose ID still contains `<` is a placeholder'
check "context template: evidence without a hash is accepted, freshness unchecked" "$area" has 'Evidence without a hash is accepted; its freshness is `unchecked`'
check "context template: the older Verified form is still read" "$area" has 'older files may use `YYYY-MM-DD · <commit>`'
check "context template: the hash counts CRLF as LF" "$area" has 'line endings counted as LF'
check "docs index is marked generated" "$(head -1 templates/docs-index.md)" has "generated by burhan status"
check "WORKFLOW explains team use" "$wf" has "Team use"
check "WORKFLOW: concurrent items are one per session" "$wf" has "Several items may be in flight, one per session"
check "WORKFLOW: state edits stay in the owner's block" "$wf" has "Edit only your own block; never rewrite the file"
check "close-out: concurrent items are one per session" "$(cat phases/close-out.md)" has "several may be in flight, one per session"
check "no old command names left in the kit" "$(grep -rl 'feat-e2e\|qc-review' . 2>/dev/null)" lacks "."
echo "provenance, escapes, timing, independence"
check "QC template records who performed it" "$(cat templates/qc.md)" has "**Performed by:**"
check "QC template: replacing the placeholders leaves the exact form (no note after the value)" "$(grep -F '**Performed by:**' templates/qc.md | sed -E 's/<[^>]*>/x/g')" has '**Performed by:** x · x · x'
check_eq "...and nothing after it" "$(grep -F '**Performed by:**' templates/qc.md | sed -E 's/<[^>]*>/x/g; s/.*x · x · x//')" ''
check "review template records who performed it" "$(cat templates/review.md)" has "**Performed by:**"
check "plan template has Reopened after PASS" "$(cat templates/plan.md)" has "**Reopened after PASS:**"
check "plan template has a Phase log" "$(grep -E '^## ([0-9]+\. *)?Phase log$' templates/plan.md)" has "Phase log"
check "story template has Escapes" "$(cat templates/story.md)" has "**Escapes:**"
check "QC command demands a fresh context" "$(cat commands/qc.md)" has "Fresh context"
check "WORKFLOW states the independence rule" "$wf" has "Independent QC"
check "config example documents the reviewer model" "$(grep -E '^WF_MODEL_CLAUDE_REVIEWER=' workflow.config.example)" has "WF_MODEL_CLAUDE_REVIEWER="
echo "review sized by risk, one file per item"
check "review template is one file per item" "$(head -1 templates/review.md)" has "# Review — <slug>"
check "review template has short and full" "$(cat templates/review.md)" has "short | full"
check "review checklist explains the sizing" "$(cat phases/review.md)" has "Sized by risk"
check "files table names the single review file" "$(cat phases/files.md)" has "reviews/<slug>-review.md"
check "story records the mode" "$(cat templates/story.md)" has "**Mode:**"
check "state file records the mode" "$(cat templates/progress.md)" has "**Mode:**"
echo "agent-guided setup (kit/SETUP.md)"
setup="$(cat SETUP.md 2>/dev/null)"
check "SETUP: confirms the agents (.claude/ and .codex/) with the user" "$setup" has "Confirm the agents"
for k in WF_CHECK_CMD WF_CODE_REGEX WF_TEST_REGEX WF_EVIDENCE_REGEX WF_SENSITIVE_REGEX WF_SENSITIVE_NOTE WF_DOCS_DIR; do
  check "SETUP proposes $k" "$setup" has "$k"
done
check "SETUP: regexes go in single quotes (double quotes cannot hold \\ or \$)" "$setup" has "in single quotes"
check "SETUP: a sandbox-blocked install goes to the human with the exact command" "$setup" has "BLOCKED"
check "SETUP: discovery changes nothing" "$setup" has "change nothing"
check "SETUP: the reminder needs WF_SENSITIVE_NOTE with the regex" "$setup" has "no reminder without the note"
check "SETUP: regexes are extended (grep -E), no PCRE shorthands" "$setup" has "extended regular expressions"
check "SETUP: WF_CHECK_TIMEOUT also needs upgrade" "$setup" has "WF_CHECK_TIMEOUT"
check "SETUP: every proposed value cites file:line" "$setup" has "file:line"
check "SETUP: only business questions" "$setup" has "Ask only business questions"
check "SETUP: config shown as a diff, written after approval" "$setup" has "as a diff"
check "SETUP: proves the check with output and exit code" "$setup" has "exit code"
check "SETUP: runs the doctor" "$setup" has "doctor"
check "SETUP: Codex trust is the user's, through /hooks" "$setup" has "/hooks"
check "SETUP: never grants Codex trust itself" "$setup" has "never approve the hooks yourself"
for s in "Hooks need review" "Review hooks" "Project config" "press \`t\`" "Trust all and continue" "Trusted" "Modified since last trusted"; do
  check "SETUP tells the human the Codex trust step: $s" "$setup" has "$s"
done
conf="$(cat "$T_ROOT/docs/configuration.md")"
check "configuration.md has the section 'Codex: trust the hooks'" "$conf" has "## Codex: trust the hooks"
for s in "Hooks need review" "Review hooks" "press \`t\`" "Trust all and continue" "Continue without trusting" "Modified since last trusted" "trusted_hash" "no error" "burhan upgrade"; do
  check "configuration.md trust section: $s" "$(sed -n '/^## Codex: trust the hooks/,/^## /p' "$T_ROOT/docs/configuration.md")" has "$s"
done
sec="$(sed -n '/^## Codex: trust the hooks/,/^## /p' "$T_ROOT/docs/configuration.md")"
for e in SessionStart UserPromptSubmit PreToolUse PostToolUse Stop; do
  check "configuration.md trust section names the event $e" "$sec" has "$e"
  check "SETUP Codex step names the event $e" "$(sed -n '/^## 7\. Codex/,/^## 8/p' SETUP.md)" has "$e"
done
for s in "Project config -" "Trusted" "Continue without trusting" "the Trust line in Codex is what counts"; do
  check "configuration.md trust section: $s" "$sec" has "$s"
done
check "SETUP: what a doctor warning after trusting means" "$setup" has "the Trust line in Codex is what counts"
check "the trust docs do not claim how Codex keys or hashes the trust" "$sec" lacks "keyed by"
for f in README.md README.ar.md; do
  check "$f links the Codex trust steps" "$(cat "$T_ROOT/$f")" has "docs/configuration.md#codex-trust-the-hooks"
done
check "SETUP: local/ git-ignored" "$setup" has ".burhan/local/"
check "SETUP: the understanding is never started automatically" "$setup" has "never start it on your own"
step8="$(sed -n '/^## 8\. Close/,$p' SETUP.md)"
check "SETUP step 8: relay setup's Step 3 block" "$step8" has 'relay the "Step 3" block'
check "SETUP step 8: the understanding runs in a NEW agent session" "$step8" has 'NEW agent session'
check "SETUP step 8: no baseline offer in this session" "$step8" lacks 'offer a read-only baseline'
check "SETUP: upgrade instead of init when installed" "$setup" has "upgrade"
check "SETUP constraint: no commit without a / b / c" "$setup" has "Never commit without asking (a) / (b) / (c)"
check "SETUP constraint: no global config edits" "$setup" has "Never edit global"
check "SETUP constraint: no credentials" "$setup" has "credentials"
echo "modes are step and auto (plan-only removed before 0.1.0)"
check_eq "plan-only appears nowhere in the kit's text (gates.txt included)" "$(grep -rl --exclude='*.sh' 'plan-only' . | sort | tr '\n' ' ')" ""
check "...only the session-start hook names it, as removed" "$(grep -l 'plan-only is no longer a mode' "$T_ROOT/src/hooks/core/session-gates.mts")" has "session-gates.mts"
check "lifecycle: plan only is a stopping point that closes at Plan ready" "$(cat phases/lifecycle.md)" has "close the item at \`Plan ready\`"
check "lifecycle: the route sets the stops, not the mode" "$(cat phases/lifecycle.md)" has "The route sets how many stops"
echo "pull request only on request"
check "close-out: a PR only when the human asks" "$(cat phases/close-out.md)" has "Pull request — only when the human asks"
check "close-out names the PR body command" "$(cat phases/close-out.md)" has "burhan pr-body --item <slug>"
check "e2e names the kit command for use and changed" "$(cat commands/e2e.md)" has 'npx burhan-kit use <slug>'
check "e2e says the kit command comes from the bindings" "$(cat commands/e2e.md)" has 'the kit command'
check "e2e: push or PR only when asked" "$(cat commands/e2e.md)" has "Push or open a pull request only when the human asks"
check "qc: PR only if asked" "$(cat commands/qc.md)" has "a pull request only if"
echo "fixed-form fields (the user's ruling)"
fields="$(sed -n '/^## Fields the hooks and stats read/,/^## /p' phases/files.md)"
for f in '`Route`' '`Mode`' '`Read-only`' '`Accepted by`' '`Reopened after PASS`' '`Performed by`'; do
  check "files.md · Fields lists $f" "$fields" has "| $f |"
done
check "state template carries Route, Read-only and Mode in the fixed form" "$(cat templates/progress.md)" has '**Route:** <type> / <scope> · **Read-only:** <yes|no> · **Mode:** <step|auto>'
check "e2e writes the bold Read-only field" "$(cat commands/e2e.md)" has '`**Read-only:** yes`'
check "lifecycle writes the bold Read-only field" "$(cat phases/lifecycle.md)" has '`**Read-only:** yes`'
check "qc.md: same session in the full fixed form" "$(cat commands/qc.md)" has '`<agent> · <model> · same session`'
check "qc.md: Accepted by in the fixed form" "$(cat commands/qc.md)" has '`<name> · YYYY-MM-DD`'
check "the reviewer writes the fixed Performed by" "$(cat agents/claude/burhan-reviewer.md)" has '`claude · <your model> · fresh subagent`'
check "the reviewer reads order from the evidence ledger" "$(cat agents/claude/burhan-reviewer.md)" has "evidence --item"
check "the review checklist points at the ledger" "$(cat templates/review.md)" has "burhan evidence --item"
echo "role agents and cross-agent review"
for r in planner builder explorer; do check "role agent template: $r" "$(cat agents/claude/burhan-$r.md 2>/dev/null)" has "name: burhan-$r"; done
check "e2e delegates to role agents when they exist" "$(cat commands/e2e.md)" has "burhan-builder"
check "qc describes the cross-agent reviewer" "$(cat commands/qc.md)" has "WF_REVIEWER_AGENT"
check "cross-agent QC closes stdin (a piped stdin hangs codex exec)" "$(cat commands/qc.md)" has "< /dev/null"
check "cross-agent reviewer is chosen before the subagent" "$(sed -n "/^1\\. \\*\\*Another agent/p" commands/qc.md)" has "WF_REVIEWER_AGENT"
check "a delegated QC gets the adversarial-pass answer up front (a non-interactive reviewer cannot ask)" "$(cat commands/qc.md)" has "pass the answer in the prompt"
t_summary
