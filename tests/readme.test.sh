#!/usr/bin/env bash
# Contract for the redesigned public README pair.
. "$(dirname "$0")/lib.sh"
cd "$T_ROOT" || exit 1

EN=README.md
AR=README.ar.md

en_sections=(); while IFS= read -r line; do en_sections+=("$line"); done < <(sed -n 's/^## //p' "$EN")
ar_sections=(); while IFS= read -r line; do ar_sections+=("$line"); done < <(sed -n 's/^## //p' "$AR")
expected_en=('Problem and answer' 'A 60-second tour' 'Quick start' 'Your first task' 'What burhan puts in your project' 'How burhan works' 'Life of a task' 'Routes' 'What only you decide' 'Reviews' 'Proof' 'Reference' 'License')
expected_ar=('المشكلة والحل' 'جولة في دقيقة' 'ابدأ بسرعة' 'أول مهمة ليك' 'إيه اللي برهان بيحطه في مشروعك' 'برهان بيشتغل إزاي' 'حياة المهمة' 'المسارات' 'إيه اللي إنت بس بتقرره' 'المراجعات' 'الإثبات' 'مرجع' 'الرخصة')
check_eq 'English section sequence' "${en_sections[*]}" "${expected_en[*]}"
check_eq 'Arabic section sequence' "${ar_sections[*]}" "${expected_ar[*]}"
check_eq 'same section count' "${#en_sections[@]}" "${#ar_sections[@]}"
en_subsections=(); while IFS= read -r line; do en_subsections+=("$line"); done < <(sed -n 's/^### //p' "$EN")
ar_subsections=(); while IFS= read -r line; do ar_subsections+=("$line"); done < <(sed -n 's/^### //p' "$AR")
expected_sub_ar=('الإعدادات' 'الأوامر' 'ذاكرة المشروع' 'بين Claude Code وCodex' 'الأمان والرجوع' 'الحدود' 'أسئلة شائعة' 'الوثائق')
check_eq 'same reference subsection count' "${#en_subsections[@]}" "${#ar_subsections[@]}"
check_eq 'Arabic reference subsection sequence' "${ar_subsections[*]}" "${expected_sub_ar[*]}"

section_rows() { awk -v h="## $2" 'index($0,h)==1 { on=1; next } /^## / { if (on) exit } on && /^\|/ { n++ } END { print n+0 }' "$1"; }
en_tables=('Problem and answer' 'How burhan works' 'Routes' 'What only you decide' 'Reviews' 'Proof' 'Your first task')
ar_tables=('المشكلة والحل' 'برهان بيشتغل إزاي' 'المسارات' 'إيه اللي إنت بس بتقرره' 'المراجعات' 'الإثبات' 'أول مهمة ليك')
for i in "${!en_tables[@]}"; do check_eq "table rows align: ${en_tables[$i]}" "$(section_rows "$EN" "${en_tables[$i]}")" "$(section_rows "$AR" "${ar_tables[$i]}")"; done
check_eq '11 route rows plus heading and separator in English' "$(section_rows "$EN" 'Routes')" 13
check_eq '11 route rows plus heading and separator in Arabic' "$(section_rows "$AR" 'المسارات')" 13

count_fences() { grep -cE '^```' "$1" || true; }
check_eq 'same fenced block count' "$(count_fences "$EN")" "$(count_fences "$AR")"
for f in "$EN" "$AR"; do
  body="$(cat "$f")"
  check "$f uses absolute repository links" "$(grep -oE '!{0,1}\[[^]]*\]\([^)]*\)' "$f" | sed -E 's/^!?\[[^]]*\]\(([^ )]+).*/\1/' | grep -vE '^https://github.com/ahmedkamaldabour/burhan-kit/|^https://www.npmjs.com/package/burhan-kit$|^https://img.shields.io/' || true)" lacks '.'
  check "$f has no relative Markdown targets" "$(grep -oE '!{0,1}\[[^]]*\]\([^)]*\)' "$f" | sed -E 's/^!?\[[^]]*\]\(([^ )]+).*/\1/' | grep -vE '^https://|^#' || true)" lacks '.'
  check "$f has no Mermaid" "$(grep -in 'mermaid' "$f" || true)" lacks ':'
  check "$f has no raw HTML" "$(grep -nE '<[[:alpha:]][^>]*>|</[[:alpha:]][^>]*>' "$f" | grep -vE '<slug>|<task>' || true)" lacks ':'
  check "$f has no version number in prose" "$(grep -nE '(^|[^0-9.])0\.[0-9]+\.[0-9]+' "$f" || true)" lacks ':'
  check "$f states Node 22+" "$body" has 'Node 22+'
  check "$f has the recorded slugify run" "$body" has 'slugify'
  check "$f has all six hook names" "$body" has 'turn-audit'
  if [ "$f" = "$EN" ]; then
    check "$f says hooks never block" "$body" has 'never block'
  else
    check "$f says hooks never block" "$body" has 'عمرها ما بتمنع'
  fi
done

while IFS= read -r target; do
  [ -n "$target" ] || continue
  path="${target#https://github.com/ahmedkamaldabour/burhan-kit/blob/main/}"
  path="${path#https://github.com/ahmedkamaldabour/burhan-kit/tree/main/}"
  path="${path%%\#*}"
  check "link target exists: $path" "$( [ -e "$path" ] && echo yes)" has yes
done < <(for f in "$EN" "$AR"; do grep -oE '!{0,1}\[[^]]*\]\(https://github.com/ahmedkamaldabour/burhan-kit/(blob|tree)/main/[^ )]+' "$f" | sed -E 's/^!?\[[^]]*\]\((.*)$/\1/'; done | sort -u)

for needle in 'all 6 hooks wired' 'WF_DOCS_DIR' 'WF_DISCOVERY_DIR' 'VERIFICATION GATE' 'WF_FULL_TEST_REGEX' 'windows-latest' 'WF_ITEM_CONTRACT=on' 'WORKFLOW.md SETUP.md VERSION'; do
  check "English has $needle" "$(cat "$EN")" has "$needle"
  check "Arabic has $needle" "$(cat "$AR")" has "$needle"
done
for needle in '2.1.139' 'npm i -D burhan-kit' 'npm i -g burhan-kit' 'kit command'; do
  check "English has $needle" "$(cat "$EN")" has "$needle"
  check "Arabic has $needle" "$(cat "$AR")" has "$needle"
done
for f in "$EN" "$AR"; do
  n="$(count_fences "$f")"
  check "$f has balanced fences" "$((n % 2))" has 0
done

# The command set: every form `burhan --help` lists is named in both READMEs, and the README says every command has --help.
help_forms="$(node dist/cli.js --help 2>&1 | sed -n 's/^  \([a-z][a-z-]*\)\( [a-z][a-z-]*\)\{0,1\}\( .*\)\{0,1\}$/\1\2/p' | sort -u)"
n_forms=0
while IFS= read -r form; do
  [ -n "$form" ] || continue
  n_forms=$((n_forms + 1))
  case "$form" in *' '*) needle="$form" ;; *) needle="\`$form" ;; esac
  check "English names the command form: $form" "$(cat "$EN")" has "$needle"
  check "Arabic names the command form: $form" "$(cat "$AR")" has "$needle"
done <<< "$help_forms"
check "the help lists at least 30 command forms (never a pass on an empty list)" "$([ "$n_forms" -ge 30 ] && echo yes)" has yes

# What 0.9.x does, in plain words: the install tree, the task folder, the skills, the decision model, the state commands.
for needle in 'skills/' '.claude/skills/' 'NNN-slug' '--help' 'burhan-story' 'burhan-plan' 'burhan-build' 'burhan-debug' 'burhan-review' 'burhan-done' \
  'finding decide' 'deviation add' '--apply' 'deviation done' 'item close' '--already-satisfied' 'Legacy' 'state show' 'burhan state' 'item list'; do
  check "English has $needle" "$(cat "$EN")" has "$needle"
  check "Arabic has $needle" "$(cat "$AR")" has "$needle"
done
# The uninstall list: every kit folder `uninstall` removes (the KIT list in src/lib/uninstall.ts) is named in both READMEs.
kit_dirs="$(sed -n "s/^const KIT = \[\(.*\)\];.*/\1/p" src/lib/uninstall.ts | tr -d "' " | tr ',' '\n')"
n_kit=0
while IFS= read -r name; do
  [ -n "$name" ] || continue
  n_kit=$((n_kit + 1))
  check "English names the uninstalled kit entry \`$name\`" "$(cat "$EN")" has "\`$name\`"
  check "Arabic names the uninstalled kit entry \`$name\`" "$(cat "$AR")" has "\`$name\`"
done <<< "$kit_dirs"
check "the uninstall list has 8 kit entries (never a pass on an empty list)" "$n_kit" has 8

# The task folder, the terms, the state and verify rules.
for needle in 'NNN-slug-story.md' 'NNN-slug-verify.jsonl' 'NNN-slug-state-notes.md' 'NNN-slug-already-satisfied.md' \
  '| Finding |' '| Decision |' '| Legacy |' '| Deviation, applied |' '| Deviation, open |' \
  'WF_STACK_SETUP' 'WF_MODE_DEFAULT' 'WF_MODEL_CLAUDE_REVIEWER' 'WF_REVIEWER_AGENT' 'WF_EVIDENCE_LEDGER' 'docs/configuration.md#workflowconfig'; do
  check "English has $needle" "$(cat "$EN")" has "$needle"
  check "Arabic has $needle" "$(cat "$AR")" has "$needle"
done
check "English says verify refuses an item before build" "$(cat "$EN")" has 'has not reached build'
check "Arabic says verify refuses an item before build" "$(cat "$AR")" has 'ماوصلتش للـ build'
check "English says a hand edit of the state file is still possible" "$(cat "$EN")" has 'a hand edit is still possible and nothing stops it'
check "Arabic says a hand edit of the state file is still possible" "$(cat "$AR")" has 'التعديل اليدوي لسه ممكن ومفيش حاجة بتمنعه'
for gone in 'Superpowers' 'superpowers' 'WF_SKILLS' 'work/<task>/' '--allow-outside-settings'; do
  check "English lacks $gone" "$(cat "$EN")" lacks "$gone"
  check "Arabic lacks $gone" "$(cat "$AR")" lacks "$gone"
done
for f in "$EN" "$AR"; do
  # The first task names the stops: the commands a person meets from the request to the commit.
  first_task="$(awk 'index($0,"## ")==1 { if (on) exit } index($0,"## Your first task")==1 || index($0,"## أول مهمة ليك")==1 { on=1 } on' "$f")"
  for needle in 'item new' 'approve story' 'approve plan' 'finding decide' 'deviation add' '--apply' 'verify' 'approve qc' 'item finish' 'state close' 'guide'; do
    check "$f: the first task names $needle" "$first_task" has "$needle"
  done
done
for f in "$EN" "$AR"; do
  # The first task is short: the section from its heading to the next one.
  first_task_lines="$(awk 'index($0,"## ")==1 { if (on) exit } index($0,"## Your first task")==1 || index($0,"## أول مهمة ليك")==1 { on=1 } on && NF { n++ } END { print n+0 }' "$f")"
  check "$f: the first-task section is there and short (lines: $first_task_lines)" "$([ "$first_task_lines" -ge 8 ] && [ "$first_task_lines" -le 28 ] && echo yes)" has yes
done

# The handbook: one sentence in each README links the PDF to read and names the HTML path for a clone.
check "English README links the handbook PDF" "$(cat "$EN")" has 'blob/main/handbook/en/burhan-handbook-en.pdf'
check "English README names the handbook HTML path" "$(cat "$EN")" has '`handbook/en/handbook.html`'
check "Arabic README links the handbook PDF" "$(cat "$AR")" has 'blob/main/handbook/burhan-handbook.pdf'
check "Arabic README names the handbook HTML path" "$(cat "$AR")" has '`handbook/handbook.html`'

t_summary
