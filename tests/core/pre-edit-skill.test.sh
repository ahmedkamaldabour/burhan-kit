#!/usr/bin/env bash
# The pre-write check: before a story, plan or code file is written without its skill, the same skill line, once.
. "$(dirname "$0")/../lib.sh"; . "$(dirname "$0")/helpers.sh"
S=pre-edit-skill
# w <file> [skills-json] [assistant-text] [session]: a write event for <file> (relative to the project unless it starts with /)
w() {
  local f="$1"; case "$f" in /*) ;; *) f="$P/$f" ;; esac
  core $S "$(ev "$(jq -cn --arg f "$f" --argjson s "${2:-[]}" --arg t "${3:-}" --arg id "${4:-s1}" \
    '{event:"pre_edit",file:$f,session:$id,turn:{skills_used:$s,assistant_text:$t}}')")" | jq -r '.message // empty'
}
echo "pre-edit-skill"

P="$(proj "WF_CODE_REGEX='\\.src\$'" "WF_TEST_REGEX='\\.test\\.src\$'")"
mkdir -p "$P/.burhan/work/foo" "$P/.burhan/local"; printf '# s\n## Now\n### foo\n' > "$P/.burhan/local/PROGRESS.md"
check "a new story without burhan-story -> the line" "$(w .burhan/work/foo/foo-story.md)" has "Skill (story): invoke burhan-story"
check "the line says where to read the skill" "$(w .burhan/work/foo/foo-story.md '[]' '' s2)" has "read .burhan/skills/burhan-story/SKILL.md"
check_eq "the same write again in the session -> silent (once)" "$(w .burhan/work/foo/foo-story.md)" ""
check_eq "the skill was used this turn -> silent" "$(w .burhan/work/foo/foo-story.md '["burhan-story"]' '' s3)" ""
check "a new plan without burhan-plan -> the line" "$(w .burhan/work/foo/foo-implementation-plan.md '[]' '' s4)" has "invoke burhan-plan"
printf '# s\n' > "$P/.burhan/work/foo/foo-story.md"
check_eq "editing an existing story -> silent" "$(w .burhan/work/foo/foo-story.md '[]' '' s5)" ""
check "code without test-first or debugging -> the line" "$(w app.src '[]' '' s6)" has "invoke burhan-build"
check_eq "code with burhan-build this turn -> silent" "$(w app.src '["burhan-build"]' '' s7)" ""
check_eq "code with burhan-debug this turn -> silent" "$(w app.src '["burhan-debug"]' '' s8)" ""
check_eq "a test file -> silent" "$(w app.test.src '[]' '' s9)" ""
printf '# s\n## Now\n### foo\n- **Route:** change / patch\n' > "$P/.burhan/local/PROGRESS.md"
check_eq "a patch-lane turn with a patch route -> silent" "$(w app.src '[]' 'patch — a typo' s10)" ""
printf '# s\n## Now\n### foo\n- **Route:** change / bounded\n' > "$P/.burhan/local/PROGRESS.md"
check "a patch claim on a bounded item -> the line" "$(w app.src '[]' 'patch — a typo' s18)" has "Skill (build)"
P2="$(proj "WF_CODE_REGEX='\\.src\$'" 'WF_STATE_FILE=STATE.md' 'WF_DISCOVERY_DIR=disc')"; P0="$P"; P="$P2"
check_eq "a state file outside .burhan -> silent" "$(w STATE.md '[]' '' s23)" ""
check_eq "the discovery folder -> silent" "$(w disc/a.src '[]' '' s24)" ""
check "control: another code file in that project gets the line" "$(w other.src '[]' '' s25)" has "Skill (build)"
P="$P0"
check_eq "the state file -> silent" "$(w .burhan/local/PROGRESS.md '[]' '' s11)" ""
check_eq "a file inside .burhan/ -> silent" "$(w .burhan/phases/x.src '[]' '' s12)" ""
check "a review file without burhan-review -> the line" "$(w .burhan/work/foo/reviews/foo-review.md '[]' '' s13)" has "Skill (review): invoke burhan-review"
check_eq "a QC report is not a review -> silent" "$(w .burhan/work/foo/reviews/foo-qc.md '[]' '' s19)" ""
check_eq "a verification report is not a review -> silent" "$(w .burhan/work/foo/reviews/foo-verification.md '[]' '' s20)" ""
check_eq "inside a subagent (agent_id) -> silent" "$(core $S "$(ev "$(jq -cn --arg f "$P/app.src" '{event:"pre_edit",file:$f,session:"s21",agent_id:"a1",turn:{skills_used:[],assistant_text:""}}')")" | jq -r '.message // empty')" ""
check "the same write without agent_id -> the line (control)" "$(w app.src '[]' '' s22)" has "Skill (build)"
check_eq "a file outside the project -> silent" "$(w /tmp/elsewhere.src '[]' '' s14)" ""
check_eq "a non-code, non-item file -> silent" "$(w notes.txt '[]' '' s15)" ""

P="$(proj 'WF_DOCS_DIR=AI_SPEC/docs')"; mkdir -p "$P/AI_SPEC/docs/foo"
check "a docs folder that is not the default" "$(w AI_SPEC/docs/foo/foo-story.md '[]' '' s16)" has "invoke burhan-story"

t_summary
