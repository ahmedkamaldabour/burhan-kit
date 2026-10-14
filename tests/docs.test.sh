#!/usr/bin/env bash
# Public README contract: safe on both GitHub and npm, brief enough for first use.
. "$(dirname "$0")/lib.sh"
cd "$T_ROOT" || exit 1

required_sections=(
  'Install / Quick start'
  'What happens in your first task'
  'How it works'
  'Settings'
  'Scripts and CI'
  'Supported agents'
  'Limits'
  'Links'
  'License'
)
ar_sections=(
  'التثبيت / ابدأ بسرعة'
  'إيه اللي بيحصل في أول مهمة؟'
  'بيشتغل إزاي'
  'الإعدادات'
  'Scripts و CI'
  'الـ agents المدعومة'
  'الحدود'
  'لينكات'
  'الرخصة'
)

first_screen() { head -40 "$1"; }
quick_start() { awk -v heading="$2" '$0 == "## " heading { on=1; next } /^## / { on=0 } on' "$1"; }
markdown_targets() {
  grep -oE '!{0,1}\[[^]]*\]\([^)]*\)' "$1" 2>/dev/null | sed -E 's/^!?\[[^]]*\]\(([^ )]+).*\)$/\1/'
}
bad_targets() {
  markdown_targets "$1" | while IFS= read -r target; do
    case "$target" in
      https://github.com/ahmedkamaldabour/burhan-kit/*) ;;
      *) printf '%s\n' "$target" ;;
    esac
  done
}
repository_paths() {
  markdown_targets "$1" | sed -n 's|^https://github.com/ahmedkamaldabour/burhan-kit/blob/main/||p' | sed 's/#.*//'
}
raw_html_tags() {
  grep -nE '<[[:alpha:]][[:alnum:]-]*([[:space:]][^>]*)?>|</[[:alpha:]][[:alnum:]-]*[[:space:]]*>' "$1" \
    | grep -vE '<slug>' || true
}

echo "README first screen and structure"
for i in "${!required_sections[@]}"; do
  check "README.md has ${required_sections[$i]}" "$(grep -F -x "## ${required_sections[$i]}" README.md)" has "## ${required_sections[$i]}"
  check "README.ar.md has ${ar_sections[$i]}" "$(grep -F -x "## ${ar_sections[$i]}" README.ar.md)" has "## ${ar_sections[$i]}"
done
for f in README.md README.ar.md; do
  screen="$(first_screen "$f")"
  check "$f first screen has the install command" "$screen" has 'npx burhan-kit'
  check "$f first screen has its language link" "$screen" has 'https://github.com/ahmedkamaldabour/burhan-kit/blob/main/README'
  check "$f has no raw HTML tags" "$(raw_html_tags "$f")" lacks ':'
  check "$f has only absolute repository URLs" "$(bad_targets "$f")" lacks '.'
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    check "$f links only package-shipped repository files: $path" "$(grep -F ""$path"" package.json)" has ""$path""
  done < <(repository_paths "$f")
done

echo "Quick start and accurate first-use facts"
for f in README.md README.ar.md; do
  heading='Install / Quick start'; [ "$f" = README.ar.md ] && heading='التثبيت / ابدأ بسرعة'
  quick="$(quick_start "$f" "$heading")"
  steps="$(printf '%s\n' "$quick" | grep -Ec '^[1-5]\. ')"
  check "$f quick start has at most five steps" "$([ "$steps" -le 5 ] && [ "$steps" -gt 0 ] && echo yes)" has 'yes'
  fence="$(printf '\140')"
  check_eq "$f quick start has one fenced command block" "$(printf '%s\n' "$quick" | grep -c "^$fence$fence$fence")" '2'
  check "$f quick start tells the reader how to check setup" "$quick" has 'doctor'
done
for phrase in 'Which coding agents' 'When should the agent come back' "Where should burhan save each task's story, plan and reviews" 'In git, for the team — docs/burhan/work/' 'npx burhan-kit setup --agent' 'Project checks are proposed by the agent on first use' 'docs/burhan/work/' '.burhan/' 'burhan use <slug>' 'Superpowers is optional' 'existing hooks'; do
  check "README.md states: $phrase" "$(cat README.md)" has "$phrase"
done
for phrase in 'أنهي أدوات AI' 'الـ agent يرجعلك إمتى' 'الـ story والخطة والـ reviews بتاعة كل مهمة' 'في git للفريق — docs/burhan/work/' 'npx burhan-kit setup --agent' 'الـ project checks بيقترحها الـ agent أول استخدام' 'docs/burhan/work/' '.burhan/' 'burhan use <slug>' 'Superpowers اختياري' 'الـ hooks الموجودة'; do
  check "README.ar.md states: $phrase" "$(cat README.ar.md)" has "$phrase"
done

echo "Public-page safety"
for f in README.md README.ar.md; do
  check "$f omits retired product terms" "$(grep -inE 'WF_SINGLE_TEST_HINT|never-run|never run|forbidden command|resource rule' "$f")" lacks ':'
  check "$f has no image or GIF" "$(grep -inE '!\[' "$f")" lacks ':'
done

echo "Review fixes: workflow, proof, and concise setup"
for phrase in \
  'No “done” without proof' \
  'Two active tasks, one session' \
  '### Basic workflow' \
  'A real first task' \
  'but no verification command ran this turn.'; do
  check "README.md keeps review fix: $phrase" "$(cat README.md)" has "$phrase"
done
for phrase in \
  'مفيش “done” من غير دليل' \
  'مهمتين شغالين، وجلسة واحدة' \
  '### مسار الشغل الأساسي' \
  'مثال حقيقي لأول مهمة' \
  'but no verification command ran this turn.'; do
  check "README.ar.md keeps review fix: $phrase" "$(cat README.ar.md)" has "$phrase"
done
for f in README.md README.ar.md; do
  check "$f has no npm-rendering meta text" "$(grep -inE 'npm rendering|شكل npm' "$f")" lacks ':'
done

t_summary
