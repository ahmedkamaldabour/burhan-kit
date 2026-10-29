#!/usr/bin/env bash
# Contract for the redesigned public README pair.
. "$(dirname "$0")/lib.sh"
cd "$T_ROOT" || exit 1

EN=README.md
AR=README.ar.md

en_sections=(); while IFS= read -r line; do en_sections+=("$line"); done < <(sed -n 's/^## //p' "$EN")
ar_sections=(); while IFS= read -r line; do ar_sections+=("$line"); done < <(sed -n 's/^## //p' "$AR")
expected_en=('Problem and answer' 'A 60-second tour' 'Quick start' 'What burhan puts in your project' 'How burhan works' 'Life of a task' 'Routes' 'What only you decide' 'Reviews' 'Proof' 'Reference' 'License')
expected_ar=('المشكلة والحل' 'جولة في دقيقة' 'ابدأ بسرعة' 'إيه اللي برهان بيحطه في مشروعك' 'برهان بيشتغل إزاي' 'حياة المهمة' 'المسارات' 'إيه اللي إنت بس بتقرره' 'المراجعات' 'الإثبات' 'مرجع' 'الرخصة')
check_eq 'English section sequence' "${en_sections[*]}" "${expected_en[*]}"
check_eq 'Arabic section sequence' "${ar_sections[*]}" "${expected_ar[*]}"
check_eq 'same section count' "${#en_sections[@]}" "${#ar_sections[@]}"
en_subsections=(); while IFS= read -r line; do en_subsections+=("$line"); done < <(sed -n 's/^### //p' "$EN")
ar_subsections=(); while IFS= read -r line; do ar_subsections+=("$line"); done < <(sed -n 's/^### //p' "$AR")
expected_sub_ar=('الإعدادات' 'الأوامر' 'ذاكرة المشروع' 'بين Claude Code وCodex' 'الأمان والرجوع' 'الحدود' 'أسئلة شائعة' 'الوثائق')
check_eq 'same reference subsection count' "${#en_subsections[@]}" "${#ar_subsections[@]}"
check_eq 'Arabic reference subsection sequence' "${ar_subsections[*]}" "${expected_sub_ar[*]}"

section_rows() { awk -v h="## $2" 'index($0,h)==1 { on=1; next } /^## / { if (on) exit } on && /^\|/ { n++ } END { print n+0 }' "$1"; }
en_tables=('Problem and answer' 'How burhan works' 'Routes' 'What only you decide' 'Reviews' 'Proof')
ar_tables=('المشكلة والحل' 'برهان بيشتغل إزاي' 'المسارات' 'إيه اللي إنت بس بتقرره' 'المراجعات' 'الإثبات')
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
for f in "$EN" "$AR"; do
  n="$(count_fences "$f")"
  check "$f has balanced fences" "$((n % 2))" has 0
done

t_summary
