#!/usr/bin/env bash
# The public README contract (readme-pro): a first-time reader meets a promise, a flow, a real recorded run,
# the features, a three-step install, a first task, honest limits and a command table — on GitHub and on npm.
. "$(dirname "$0")/lib.sh"
cd "$T_ROOT" || exit 1

GH='https://github.com/ahmedkamaldabour/burhan-kit/blob/main'
EN=README.md
AR=README.ar.md

en_sections=('The flow at a glance' 'See it work' 'What you get' 'Install in 3 steps' 'Your first task' 'Teams and project memory' 'Limits' 'Commands and links' 'License')
ar_sections=('الـ flow في لمحة' 'شوفه شغّال' 'هتاخد إيه' 'التثبيت في 3 خطوات' 'أول مهمة ليك' 'الفرق والذاكرة' 'الحدود' 'الأوامر واللينكات' 'الرخصة')

# Exact line match by index() and length(), never `==`. On macOS (Apple awk 20200816) the Arabic section grew to 56 lines
# and 13 bullets, as if several all-Arabic headings compared equal; the likely cause is locale collation in `==`
# (a hypothesis that fits every number, proved only by macOS CI turning green; macOS CI log 2026-10-22).
section() { awk -v h="## $2" 'index($0, h) == 1 && length($0) == length(h) { on=1; next } /^## / { on=0 } on' "$1"; }
step() { awk -v a="$2" -v b="$3" 'index($0, a) == 1 && length($0) == length(a) { on=1; next } b != "" && index($0, b) == 1 && length($0) == length(b) { on=0 } on' "$1"; }
hero() { awk 'NR == 1 { next } /^## / { exit } { print }' "$1" | grep -vF "$GH/README"; }
markdown_targets() { grep -oE '!{0,1}\[[^]]*\]\([^)]*\)' "$1" 2>/dev/null | sed -E 's/^!?\[[^]]*\]\(([^ )]+).*\)$/\1/'; }
raw_html_tags() { grep -nE '<[[:alpha:]][[:alnum:]-]*([[:space:]][^>]*)?>|</[[:alpha:]][[:alnum:]-]*[[:space:]]*>' "$1" | grep -vE '<slug>|<name>|<cmd|<re>|<p;q>|<ref>|<id>' || true; }

# The bullets under a heading, counted once; when the count is not 8 to 10 the output says what this machine saw
# (macOS BSD grep/awk once disagreed with Linux on the Arabic section; the numbers below say where).
feature_count() {
  local n; n="$(section "$1" "$2" | grep -c '^- ')"
  if [ "$n" -lt 8 ] || [ "$n" -gt 10 ]; then
    {
      echo "        diag: $1 under '$2': $n bullets, $(section "$1" "$2" | wc -l | tr -d ' ') lines; $(uname -s); $(awk --version 2>&1 | head -1)"
      section "$1" "$2" | awk '/^- / { print "        diag: line " NR ": " substr($0, 1, 12) }'
    } >&2
  fi
  echo "$n"
}

echo "structure: same headings in English and Arabic, short, no raw HTML"
for i in "${!en_sections[@]}"; do
  check "$EN has ## ${en_sections[$i]}" "$(grep -F -x "## ${en_sections[$i]}" $EN)" has "## ${en_sections[$i]}"
  check "$AR has ## ${ar_sections[$i]}" "$(grep -F -x "## ${ar_sections[$i]}" $AR)" has "## ${ar_sections[$i]}"
done
check_eq "same number of H2 headings (en/ar)" "$(grep -c '^## ' $AR)" "$(grep -c '^## ' $EN)"
check_eq "same number of H3 headings (en/ar)" "$(grep -c '^### ' $AR)" "$(grep -c '^### ' $EN)"
check_eq "README.md is at most 150 lines" "$([ "$(wc -l < $EN)" -le 150 ] && echo yes)" yes
check_eq "README.ar.md is at most 155 lines" "$([ "$(wc -l < $AR)" -le 155 ] && echo yes)" yes
for f in $EN $AR; do
  check "$f has no raw HTML tags" "$(raw_html_tags "$f")" lacks ':'
  check "$f has no image, GIF or badge" "$(grep -nE '!\[|shields\.io|badge' "$f")" lacks ':'
  check "$f has no mermaid" "$(grep -n -i 'mermaid' "$f")" lacks ':'
  check "$f omits retired product terms" "$(grep -inE 'WF_SINGLE_TEST_HINT|never-run|never run|forbidden command|resource rule' "$f")" lacks ':'
  check "$f has no npm-rendering meta text" "$(grep -inE 'npm rendering|شكل npm' "$f")" lacks ':'
  check "$f names no burhan version number" "$(grep -nE '(^|[^0-9.])0\.[0-9]+\.[0-9]+' "$f")" lacks ':'
  check "$f has no speed or time promise" "$(grep -inE '[0-9]+ ?(x|×) faster|in (under )?[0-9]+ minutes|دقايق' "$f")" lacks ':'
  check "$f does not say burhan stops or blocks things" "$(grep -inE 'what burhan stops|burhan stops|burhan blocks|بيوقف إيه' "$f")" lacks ':'
  check "$f links only absolute repository URLs" "$(markdown_targets "$f" | grep -vE '^https://github.com/ahmedkamaldabour/burhan-kit/|^#' )" lacks '.'
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    check "$f links a file that exists in the repository: $path" "$([ -e "$path" ] && echo yes)" has yes
  done < <(markdown_targets "$f" | sed -n 's|^https://github.com/ahmedkamaldabour/burhan-kit/blob/main/||p' | sed 's/#.*//')
  check "$f first screen has the install command" "$(head -40 "$f")" has 'npx burhan-kit'
  check "$f first screen has its language link" "$(head -40 "$f")" has "$GH/README"
  check "$f first screen has the flow diagram (first and last step)" "$(head -40 "$f")" has '1. Intake'
  check "$f first screen has the commit step" "$(head -40 "$f")" has '9. Commit'
  w=$(hero "$f" | wc -w | tr -d ' ')
  check_eq "$f hero (promise, bullets, try it) is at most 80 words (got $w)" "$([ "$w" -le 80 ] && echo yes)" yes
done

echo "the flow: nine steps, who acts at each, the modes and their brakes"
for f in $EN $AR; do
  flow="$(section "$f" "$([ "$f" = $EN ] && echo 'The flow at a glance' || echo 'الـ flow في لمحة')")"
  for st in '1. Intake' '2. Story' '3. Plan' '4. Build' '5. Review' '6. Verify' '7. QC' '8. Knowledge' '9. Commit'; do
    check "$f flow step: $st" "$flow" has "$st"
  done
  check "$f flow: where you approve" "$flow" has '<- you approve'
  check "$f flow: where step mode pauses" "$flow" has '<- `step` mode pauses here'
  check "$f flow: the commit always stops" "$flow" has '<- always stops'
  check "$f flow: both modes are named" "$flow" has '`auto`'
  check "$f flow: the five brakes" "$flow" has 'scope escalator'
  check "$f flow: brake, out-of-scope discovery" "$flow" has 'discovery'
  check "$f flow: brake, the same test failing twice" "$flow" has "$([ "$f" = $EN ] && echo 'failing twice' || echo 'بيفشل مرتين')"
  check "$f flow: brake, irreversible action" "$flow" has 'irreversible'
  check "$f flow: plan only" "$flow" has 'plan only'
  check "$f flow: switching modes in plain words" "$flow" has 'go end to end'
  check "$f flow: how much a task gets depends on the route" "$flow" has 'route'
done
for f in $EN $AR; do
  flow="$(section "$f" "$([ "$f" = $EN ] && echo 'The flow at a glance' || echo 'الـ flow في لمحة')")"
  check "$f flow: every request is classified first (type + scope + one-line reason)" "$flow" has 'type + scope + a one-line reason'
  for r in 'feature / bounded' 'bug / bounded' 'change / patch' 'architectural' 'investigation'; do check "$f flow: route row $r" "$flow" has "| $r |"; done
  check "$f flow: the bug path starts from the root cause" "$flow" has 'root cause'
  check "$f flow: the bug path starts from a failing regression test" "$flow" has 'failing regression test'
  check "$f flow: a feature gets QC" "$(printf '%s\n' "$flow" | grep -F '| feature / bounded |')" has 'QC'
  check "$f flow: a bug on bounded work gets no QC" "$(printf '%s\n' "$flow" | grep -F '| bug / bounded |')" lacks 'QC →'
done
check "$EN flow: route table header" "$(section $EN 'The flow at a glance')" has '| You ask for | Classified as | Path |'
check "$AR flow: route table header" "$(section $AR 'الـ flow في لمحة')" has '| بتطلب | بيتصنّف | المسار |'
check "$EN flow: a feature and a bug do not take the same path" "$(section $EN 'The flow at a glance')" has 'a feature and a bug do not take the same path'
check "$AR flow: a feature and a bug do not take the same path" "$(section $AR 'الـ flow في لمحة')" has 'الـ feature والـ bug مش بيمشوا في نفس المسار'
check "$EN flow: the mode table compares step and auto on a task with three sub-units" "$(section $EN 'The flow at a glance')" has '| A task with three sub-units | `step` (default) | `auto` |'
check "$AR flow: the mode table compares step and auto on a task with three sub-units" "$(section $AR 'الـ flow في لمحة')" has '| مهمة فيها 3 sub-units | `step` (الافتراضي) | `auto` |'
check "$EN flow: auto approves the story and plan once" "$(section $EN 'The flow at a glance')" has 'you approve, once'
check "$AR flow: the commit always stops" "$(section $AR 'الـ flow في لمحة')" has 'بيقف دايمًا'
check "docs/features.md has the route table" "$(cat docs/features.md)" has '| patch |'
check "docs/features.md route table: architectural" "$(cat docs/features.md)" has '| architectural |'
check "docs/features.md route table: read-only" "$(cat docs/features.md)" has '| investigation |'

echo "exact route rows and mode rows (a wrong cell must fail), review I-3"
en_rows=(
'| a new feature | feature / bounded | story + plan (one approval) → build → review → verify → QC → knowledge |'
'| a bug | bug / bounded | story + plan (one approval; the story holds the root cause, found with evidence before any fix) → build (starting from a failing regression test) → review → verify → knowledge; no QC |'
'| a typo | change / patch | the change, a passing check run after it, the commit; no story or plan |'
'| a feature, bug or change touching, for example, security, permissions, the data model, money or a public API | architectural | story and plan as two approvals → build → review → verify → QC → knowledge |'
'| a question to investigate | investigation | read-only: findings, no code |'
'| story + plan | you approve | you approve, once |'
'| build + review of each sub-unit | stops after each of the three | runs straight through |'
'| verify | asks whether you or the agent runs it | asked once, at the start |'
'| QC verdict (on routes with QC) | you accept it | you accept it |'
'| commit | you choose | you choose |')
ar_rows=(
'| feature جديد | feature / bounded | story + plan (موافقة واحدة) → build → review → verify → QC → knowledge |'
'| bug | bug / bounded | story + plan (موافقة واحدة؛ الـ story فيها الـ root cause بدليل قبل أي إصلاح) → build (بيبدأ بـ failing regression test) → review → verify → knowledge؛ من غير QC |'
'| typo | change / patch | التعديل، وcheck ناجح بيتشغّل بعده، والـ commit؛ من غير story ولا خطة |'
'| feature أو bug أو change بيلمس، مثلًا، الأمان أو الصلاحيات أو الـ data model أو الفلوس أو public API | architectural | story وخطة كموافقتين → build → review → verify → QC → knowledge |'
'| سؤال محتاج تحقيق | investigation | للقراءة بس: findings من غير كود |'
'| story + plan | بتوافق | بتوافق، مرة واحدة |'
'| build + review لكل sub-unit | بيقف بعد كل واحد من التلاتة | بيكمّل لحد الآخر |'
'| verify | بيسأل إنت اللي تشغّله ولا هو | بيسأل مرة واحدة في البداية |'
'| verdict الـ QC (على الـ routes اللي فيها QC) | إنت بتقبله | إنت بتقبله |'
'| commit | إنت بتختار | إنت بتختار |')
for r in "${en_rows[@]}"; do check "$EN flow row: ${r:0:60}…" "$(cat $EN)" has "$r"; done
for r in "${ar_rows[@]}"; do check "$AR flow row: ${r:0:60}…" "$(cat $AR)" has "$r"; done
ft=(
'| feature | story + plan · build · review · verify · QC · knowledge | story · plan (with options) · build · review · verify · QC · knowledge |'
'| change | story + plan · build · review · verify · knowledge | story · plan · build · review · verify · QC · knowledge |'
'| bug | story + plan (root cause in it) · build (failing regression test first) · review · verify · knowledge | story · plan · build · review · verify · QC · knowledge |'
'| refactor | plan · build · review · verify | plan (with options) · build · review · verify · knowledge |'
'| release | plan (checklist) · verify · review | plan (checklist and rollback) · verify · review |'
'| investigation | read-only: findings, no application code | read-only |'
'| patch | routing line · the change · evidence after it · commit (no story or plan) | — |')
for r in "${ft[@]}"; do check "docs/features.md route row: ${r:0:50}…" "$(cat docs/features.md)" has "$r"; done

echo "cold-read fixes (a reader with an empty context)"
check "$EN hero: says what is installed" "$(hero $EN)" has 'burhan installs a working agreement and hooks in your project'
check "$EN hero: asks the agent, does not claim to make it" "$(hero $EN)" has 'asking your agent to agree the work with you first'
check "$EN hero: the command to try is in the promise" "$(hero $EN)" has 'For Claude Code and Codex: `npx burhan-kit`'
check "$AR hero: says what is installed" "$(hero $AR)" has 'اتفاق شغل مكتوب وhooks'
check "$AR hero: says where" "$(hero $AR)" has 'جوّه مشروعك'
check "$AR hero: the command to try is in the promise" "$(hero $AR)" has 'لـ Claude Code وCodex: `npx burhan-kit`'
check "$AR hero: reviewed steps, not reversed ones" "$(cat $AR)" lacks 'خطوات متراجعة'
check "$AR hero: reviewed steps" "$(hero $AR)" has 'بتتعمل لها review'
check "$EN the types are named, change included" "$(cat $EN)" has '`change` (to existing behaviour)'
check "$AR the types are named, change included" "$(cat $AR)" has '`change` (تغيير في سلوك موجود)'
check "$EN you can override the route" "$(cat $EN)" has 'you can override it'
check "$AR you can override the route" "$(cat $AR)" has 'تقدر تغيّره'
check "$EN who the fresh reviewer is" "$(cat $EN)" has 'a subagent in Claude Code, or the other agent if you choose that'
check "$AR who the fresh reviewer is" "$(cat $AR)" has 'subagent في Claude Code، أو الـ agent التاني لو اخترت كده'
check "$EN limits: where the settings live" "$(section $EN 'Limits')" has 'settings in `.burhan/workflow.config`'
check "$AR limits: where the settings live" "$(section $AR 'الحدود')" has 'إعدادات في `.burhan/workflow.config`'
check "$AR no odd words (the finished command / work)" "$(cat $AR)" lacks 'الخلصان'
check "$AR no cryptic phrase about the questions" "$(cat $AR)" lacks 'أسئلة، علشان'
check "$AR the local folder wording" "$(cat $AR)" lacks 'ليك وحدك ومتجاهَل'

echo "confirmation-pass fixes (N-1, N-2, N-3)"
check "$EN a gate is every arrow in the diagram" "$(cat $EN)" has 'every `<-` above, and after every sub-unit in `step` mode'
check "$AR a gate is every arrow in the diagram" "$(cat $AR)" has 'كل سهم `<-` فوق، وبعد كل sub-unit في مود `step`'

echo "strong features in What you get (owner ask, 2026-10-22)"
for f in $EN $AR; do
  h="$([ "$f" = $EN ] && echo 'What you get' || echo 'هتاخد إيه')"
  w="$(section "$f" "$h")"
  check "$f what you get: still 8 to 10 feature lines" "$(feature_count "$f" "$h" | awk '$1 >= 8 && $1 <= 10 { print "yes" }')" has yes
done
w="$(section $EN 'What you get')"
check "$EN the warning also covers a check that ran before the edit, failed or never ran" "$w" has 'the check ran before it, failed, or never ran'
check "$EN cross-agent QC" "$w" has 'Claude builds and Codex reviews, or the reverse'
check "$EN reports from the records: pull-request description" "$w" has 'a pull-request description for a task'
check "$EN reports from the records: independent reviews" "$w" has 'how many QC reviews were independent'
check "$EN reports from the records: escaped defects" "$w" has 'escaped defects'
check "$EN memory: each fact names its file" "$w" has 'each fact names the file it came from'
check "$EN memory: status finds the stale facts" "$w" has '`memory status` tells you which facts cite a file that has changed since'
check "$EN safe to try: dry runs" "$w" has 'are dry runs until `--apply`'
check "$EN safe to try: config never overwritten" "$w" has '`init` and `upgrade` never overwrite your `workflow.config`'
check "$EN safe to try: uninstall removes only its own files" "$w" has '`uninstall` removes only what burhan wrote and keeps your `workflow.config` and `bindings.md` unless you add `--all`'
w="$(section $AR 'هتاخد إيه')"
check "$AR the warning also covers a check that ran before the edit, failed or never ran" "$w" has 'اتشغّل قبله، أو فشل، أو ما اتشغّلش'
check "$AR cross-agent QC" "$w" has 'Claude بيبني وCodex بيراجع، أو العكس'
check "$AR reports from the records: pull-request description" "$w" has 'وصف pull request للمهمة'
check "$AR reports from the records: independent reviews" "$w" has 'كام QC كان مستقل'
check "$AR reports from the records: escaped defects" "$w" has 'escaped defects'
check "$AR memory: each fact names its file" "$w" has 'كل fact بيقول جه من أنهي ملف'
check "$AR memory: status finds the stale facts" "$w" has '`memory status` بيكشف الـ facts اللي الملف اللي بتستند عليه اتغيّر'
check "$AR safe to try: dry runs" "$w" has 'dry run لحد `--apply`'
check "$AR safe to try: config never overwritten" "$w" has 'عمرهم ما بيكتبوا فوق `workflow.config`'
check "$AR safe to try: uninstall removes only its own files" "$w" has 'بيشيل بس اللي burhan كتبه وبيسيب `workflow.config` و`bindings.md` إلا لو ضفت `--all`'

echo "cold-read round 2"
check "$EN the blocked line is the agent's own permission refusal, not burhan" "$(cat $EN)" has "refused by the agent's own permission prompt, not by burhan"
check "$AR the blocked line is the agent's own permission refusal, not burhan" "$(cat $AR)" has 'اترفض من الـ permission prompt بتاع الـ agent نفسه، مش من burhan'
check "$EN bindings.md is explained where it is named" "$(cat $EN)" has '`.burhan/bindings.md` (your project'"'"'s commands and folders)'
check "$AR bindings.md is explained where it is named" "$(cat $AR)" has '`.burhan/bindings.md` (أوامر مشروعك وفولدراته)'
check "$AR no stiff word for ceremony" "$(cat $AR)" lacks 'مش مراسم'

echo "review fixes: wording that must stay true (readme-pro review I-1, I-2, M-1…M-14)"
check "$EN a gate is steps 2, 3, 9 and after every sub-unit in step mode" "$(cat $EN)" has 'after every sub-unit in `step` mode'
check "$AR a gate is steps 2, 3, 9 and after every sub-unit in step mode" "$(cat $AR)" has 'وبعد كل sub-unit في مود `step`'
check "$EN doctor ends with a line that starts with 0 fail" "$(cat $EN)" has 'a last line that starts with `0 fail`'
check "$AR doctor ends with a line that starts with 0 fail" "$(cat $AR)" has 'آخر سطر فيه بيبدأ بـ `0 fail`'
for f in $EN $AR; do
  check "$f Codex: a finished command may have no recorded exit code" "$(section $f "$([ "$f" = $EN ] && echo 'Limits' || echo 'الحدود')")" has "$GH/ROADMAP.md"
  check "$f scope is explained in the flow section" "$(cat $f)" has '`bounded`'
  check "$f a brake is named in bold" "$(cat $f)" has '**brake**'
done
check "$EN hero: the first bullet" "$(hero $EN)" has 'story and plan need your yes before code'
check "$EN doctor warns once first use is done" "$(cat $EN)" has 'once first use is done'
check "$EN Codex gap in the limits" "$(section $EN 'Limits')" has 'no recorded exit code'
check "$EN task files travel through git only in the shared folder" "$(cat $EN)" has 'when you chose the shared folder'
check "$EN use validates the task and links at the end of the turn" "$(cat $EN)" has 'the session is linked when the turn ends'
check "$EN Node 22 is said in the install step" "$(cat $EN)" has 'with Node 22 or newer'
check "$EN scope escalator explained" "$(cat $EN)" has 'the task turns out to touch'
check "$EN discovery explained" "$(cat $EN)" has 'something found that the task did not ask for'
check "$AR doctor warns once first use is done" "$(cat $AR)" has 'بعد ما أول استخدام يخلص'
check "$AR Codex gap in the limits" "$(section $AR 'الحدود')" has 'exit code'
check "$AR Node 22 is said in the install step" "$(cat $AR)" has 'بـ Node 22 أو أحدث'
check "$AR no unnatural wording about the agent rules" "$(cat $AR)" lacks 'متقال يمشي عليها'
check "$AR no doubled language in the brakes" "$(cat $AR)" lacks '(failing twice)'
check "$EN restored: the Codex route sentence" "$(cat $EN)" has 'if it is not installed yet: run `/plugins`, search `superpowers`, choose Install Plugin'
check "$AR restored: the Codex route sentence" "$(cat $AR)" has 'لو لسه مش متسطّب: شغّل `/plugins`، دوّر على `superpowers`، واختار Install Plugin'
check "$EN restored: once, approved is not repeated, a draft is completed" "$(cat $EN)" has 'Run it once: an approved understanding is not repeated, and a draft is completed'
check "$AR restored: once, approved is not repeated, a draft is completed" "$(cat $AR)" has 'شغّله مرة واحدة: الفهم المعتمد مش بيتكرر، والمسودة بتتكمّل'
check "$EN restored: the three questions" "$(cat $EN)" has 'which agents, when the agent comes back to you, where the task files live'
check "$AR restored: the three questions" "$(cat $AR)" has 'أنهي agents، والـ agent يرجعلك إمتى، وملفات المهام تتحفظ فين'
check "docs/features.md names the optional extras" "$(cat docs/features.md)" has '### Optional extras'
for p in 'WF_MODEL_CLAUDE_' 'burhan-verify' 'burhan:start' '--lang ar'; do check "docs/features.md optional extras: $p" "$(sed -n '/### Optional extras/,/^## /p' docs/features.md)" has "$p"; done
check "docs/features.md: Codex exit code limit" "$(cat docs/features.md)" has 'no recorded exit code'
check "docs/features.md: doctor warning needs first use done" "$(cat docs/features.md)" has 'once first-use setup is done'
check "docs/features.md: discovery folder is the person's choice" "$(cat docs/features.md)" has 'in your discovery folder'
check "docs/features.md: use validates and the hook links" "$(cat docs/features.md)" has 'the session is linked when the turn ends'

echo "terms are defined where they first appear (one bold definition each)"
for term in story plan route gate QC hook ledger baseline session; do
  for f in $EN $AR; do
    check "$f defines **$term**" "$(grep -c "\*\*$term\*\*" "$f" | awk '$1 >= 1 { print "yes" }')" has yes
  done
done

echo "the promise and the three bullets"
check "$EN promise" "$(hero $EN)" has 'say “done” without proof'
for b in '**Agree first:**' '**Show proof:**' '**You commit:**'; do check "$EN bullet $b" "$(hero $EN)" has "$b"; done
check "$AR promise" "$(hero $AR)" has 'بتقول “done” من غير دليل'
for b in '**اتفق الأول:**' '**الدليل:**' '**إنت اللي بتعمل commit:**'; do check "$AR bullet $b" "$(hero $AR)" has "$b"; done
for f in $EN $AR; do check "$f says it is for Claude Code and Codex" "$(hero $f)" has 'Claude Code'; check "$f names Codex in the hero" "$(hero $f)" has 'Codex'; done

echo "see it work: output copied from a real run"
for f in $EN $AR; do
  see="$(section "$f" "$([ "$f" = $EN ] && echo 'See it work' || echo 'شوفه شغّال')")"
  check "$f example: the request" "$see" has '/burhan:e2e slugify'
  check "$f example: the first-use block" "$see" has 'Check before commit'
  check "$f example: the verification gate message, word for word" "$see" has '⚠ VERIFICATION GATE: completion was claimed, but the last run of `npm test 2>&1 | tail -15` was blocked and never ran. Run it, show the output — or retract the claim.'
  check "$f example: the ledger line of the refused run" "$see" has 'cmd  exit ?  blocked  npm test 2>&1 | tail -15'
  check "$f example: says it is shortened" "$see" has '…'
done
check "$EN example: says it is a real run" "$(section $EN 'See it work')" has 'real run'
check "$AR example: says it is a real run" "$(section $AR 'شوفه شغّال')" has 'run حقيقي'

echo "what you get: four groups, each linking to docs/features.md"
for a in agree-before-you-build prove-what-was-done memory-and-team where-it-runs; do
  check "$EN links features#$a" "$(cat $EN)" has "$GH/docs/features.md#$a"
  check "$AR links features#$a" "$(cat $AR)" has "$GH/docs/features.md#$a"
  check "docs/features.md has the heading for #$a" "$(grep -c "^## $(echo "$a" | sed 's/-/ /g' | awk '{ $1 = toupper(substr($1,1,1)) substr($1,2); print }')$" docs/features.md | awk '$1 == 1 { print "yes" }')" has yes
done
check_eq "$EN lists 8 to 10 feature lines" "$(feature_count $EN 'What you get' | awk '$1 >= 8 && $1 <= 10 { print "yes" }')" yes
check_eq "$AR lists 8 to 10 feature lines" "$(feature_count $AR 'هتاخد إيه' | awk '$1 >= 8 && $1 <= 10 { print "yes" }')" yes
check_eq "$AR what you get stops at its own next heading (no bullets from Teams and project memory)" "$(section $AR 'هتاخد إيه' | grep -c 'merge=union')" 0
check_eq "$EN what you get stops at its own next heading (no bullets from Teams and project memory)" "$(section $EN 'What you get' | grep -c 'merge=union')" 0

echo "install: three headed steps, in order, each ends with what you should see"
S1='### Step 1 — Superpowers (recommended)'; S2='### Step 2 — Set up burhan'; S3='### Step 3 — Let the agent understand your project'
A1='### الخطوة 1 — Superpowers (موصى بيه)'; A2='### الخطوة 2 — جهّز burhan'; A3='### الخطوة 3 — خلّي الـ agent يفهم مشروعك'
for f in $EN $AR; do
  if [ "$f" = $EN ]; then h=('Install in 3 steps' "$S1" "$S2" "$S3"); else h=('التثبيت في 3 خطوات' "$A1" "$A2" "$A3"); fi
  inst="$(section "$f" "${h[0]}")"
  order="$(printf '%s\n' "$inst" | grep -nxF -e "${h[1]}" -e "${h[2]}" -e "${h[3]}" | cut -d: -f2- | tr '\n' '|')"
  check_eq "$f three step headings in order" "$order" "${h[1]}|${h[2]}|${h[3]}|"
  s1="$(printf '%s\n' "$inst" | step /dev/stdin "${h[1]}" "${h[2]}")"
  s2="$(printf '%s\n' "$inst" | step /dev/stdin "${h[2]}" "${h[3]}")"
  s3="$(printf '%s\n' "$inst" | step /dev/stdin "${h[3]}" "")"
  check "$f step 1: the Claude Code command" "$s1" has '/plugin install superpowers@claude-plugins-official'
  check "$f step 1: the conditional Codex route" "$s1" has '`/plugins`'
  check "$f step 2: run it yourself" "$s2" has 'npx burhan-kit'
  check "$f step 2: or let the agent run it" "$s2" has 'npx burhan-kit setup --agent'
  check "$f step 2: doctor" "$s2" has 'npx burhan-kit doctor'
  check "$f step 2: the Codex trust step" "$s2" has '/hooks'
  check "$f step 3: the Claude Code command" "$s3" has '/burhan:onboard'
  check "$f step 3: the Codex sentence" "$s3" has 'Follow .burhan/commands/onboard.md'
  for n in 1 2 3; do
    eval "body=\$s$n"
    check "$f step $n ends with what you should see" "$body" has "$([ "$f" = $EN ] && echo 'You should see' || echo 'المفروض تشوف')"
  done
done
check "$EN step 1: strongly recommended, optional, never installed" "$(cat $EN)" has 'optional, but strongly recommended: burhan never installs it'
check "$AR step 1: strongly recommended, optional, never installed" "$(cat $AR)" has 'اختياري، لكن موصى به بقوة: burhan مش بيسطّبه خالص'
check "$EN step 1: start at step 2 to try first" "$(cat $EN)" has 'Want to try burhan first? Start at Step 2.'
check "$AR step 1: start at step 2 to try first" "$(cat $AR)" has 'عايز تجرّب burhan الأول؟ ابدأ من الخطوة 2.'
check "$EN step 2: the question count" "$(cat $EN)" has 'three questions (four when you use both agents)'
check "$AR step 2: the question count" "$(cat $AR)" has 'تلات أسئلة (أربعة لو بتستخدم الـ agents الاتنين)'
check "$EN step 3: a new session" "$(cat $EN)" has 'open a NEW agent session'
check "$AR step 3: a new session" "$(cat $AR)" has 'افتح جلسة agent جديدة'
check "$EN step 3: once" "$(cat $EN)" has 'Run it once'
check "$AR step 3: once" "$(cat $AR)" has 'شغّله مرة واحدة'

echo "first task and team"
for f in $EN $AR; do
  first="$(section "$f" "$([ "$f" = $EN ] && echo 'Your first task' || echo 'أول مهمة ليك')")"
  check "$f first task: the command" "$first" has '/burhan:e2e <slug>'
  check "$f first task: the long walkthrough" "$first" has "$GH/docs/first-task.md"
  team="$(section "$f" "$([ "$f" = $EN ] && echo 'Teams and project memory' || echo 'الفرق والذاكرة')")"
  for p in '.burhan/PROJECT.md' '.burhan/context/' '.burhan/local/'; do check "$f team: $p" "$team" has "$p"; done
  check "$f team: use <slug>" "$team$first" has 'use <slug>'
done
check "$EN team: the conflict rule" "$(section $EN 'Teams and project memory')" has 'keep each row'
check "$AR team: the conflict rule" "$(section $AR 'الفرق والذاكرة')" has 'سيب كل row'
check "$EN ledger privacy line" "$(section $EN 'Teams and project memory')" has 'outside your project'
check "$EN ledger privacy: command lines and exit codes only" "$(section $EN 'Teams and project memory')" has 'command lines and exit codes only'
check "$EN ledger privacy: never output" "$(section $EN 'Teams and project memory')" has 'never their output'
check "$AR ledger privacy line" "$(section $AR 'الفرق والذاكرة')" has 'برّه المشروع'
check "$AR ledger privacy: command lines and exit codes only" "$(section $AR 'الفرق والذاكرة')" has 'أوامر وexit codes بس'

echo "limits: short and honest"
for f in $EN $AR; do
  lim="$(section "$f" "$([ "$f" = $EN ] && echo 'Limits' || echo 'الحدود')")"
  check_eq "$f limits are at most 8 lines" "$(printf '%s\n' "$lim" | grep -c . | awk '$1 <= 8 { print "yes" }')" yes
  check "$f limits: Codex" "$lim" has 'Codex'
  check "$f limits: PowerShell" "$lim" has 'PowerShell'
  check "$f limits: the pattern settings" "$lim" has 'WF_CODE_REGEX'
done
check "$EN limits: reports and guides" "$(section $EN 'Limits')" has 'burhan reports and guides — it does not block'
check "$EN limits: only what the agent reports" "$(section $EN 'Limits')" has 'only sees the edits and commands the agent reports'
check "$EN limits: Windows not verified" "$(section $EN 'Limits')" has 'Not verified yet'
check "$AR limits: reports and guides" "$(section $AR 'الحدود')" has 'بيبلّغ ويوجّه ومبيمنعش'
check "$AR limits: Windows not verified" "$(section $AR 'الحدود')" has 'لسه مش متحقق منه'

echo "commands and links"
for f in $EN $AR; do
  c="$(section "$f" "$([ "$f" = $EN ] && echo 'Commands and links' || echo 'الأوامر واللينكات')")"
  for cmd in 'npx burhan-kit setup --agent' 'npx burhan-kit doctor' 'npx burhan-kit status' 'npx burhan-kit evidence' 'npx burhan-kit memory check' 'npx burhan-kit inspect' 'npx burhan-kit use <slug>' 'npx burhan-kit upgrade' 'npx burhan-kit uninstall'; do
    check "$f command table: $cmd" "$c" has "$cmd"
  done
  for l in docs/configuration.md docs/features.md docs/first-task.md docs/upgrading.md docs/ci-and-windows.md CHANGELOG.md ROADMAP.md; do check "$f links $l" "$c" has "$GH/$l"; done
done

echo "the four new docs files"
for d in features first-task upgrading ci-and-windows; do
  check "docs/$d.md exists" "$([ -f docs/$d.md ] && echo yes)" has yes
  check "docs/$d.md has no raw HTML" "$(raw_html_tags docs/$d.md)" lacks ':'
  check "docs/$d.md has no mermaid or image" "$(grep -n -i 'mermaid\|!\[' docs/$d.md)" lacks ':'
  check "docs/$d.md links the repository only by absolute URL or anchor" "$(markdown_targets docs/$d.md | grep -vE '^https://|^#')" lacks '.'
  check "docs/$d.md is not shipped in the package (package.json files unchanged)" "$(grep -F "docs/$d.md" package.json)" lacks "docs/$d.md"
done
check "package.json still ships docs/configuration.md" "$(cat package.json)" has 'docs/configuration.md'
f="$(cat docs/features.md)"
for p in 'Glossary' 'What it is' 'When it shows up' 'Example' 'Limit' 'holds only ledger files' "exit of its last command" 'WF_CODE_REGEX' 'burhan use'; do check "docs/features.md has: $p" "$f" has "$p"; done
t="$(cat docs/first-task.md)"
for p in '/burhan:e2e slugify' 'npx burhan-kit setup --set check=' '⚠ VERIFICATION GATE: completion was claimed' 'Pre-commit gate — measured: PASS' 'npx burhan-kit evidence' 'Claude Code 2.1.296' 'not recorded' 'Superpowers'; do check "docs/first-task.md has: $p" "$t" has "$p"; done
u="$(cat docs/upgrading.md)"
for p in 'npx burhan-kit upgrade --apply' 'npx burhan-kit uninstall --apply' '--allow-outside-settings' '0.2.2' 'Codex'; do check "docs/upgrading.md has: $p" "$u" has "$p"; done
w="$(cat docs/ci-and-windows.md)"
for p in 'npx burhan-kit doctor' 'memory check' 'windows-latest' 'Not verified' 'PowerShell'; do check "docs/ci-and-windows.md has: $p" "$w" has "$p"; done

t_summary
