#!/usr/bin/env bash
# User prompt: suggest the phase (and, when a skills plugin is bound, the skill) the request
# calls for — BEFORE the agent acts. English and Arabic keywords.
# Capped at 2 suggestions, most specific first: a wall of bullets gets skipped.
. "$(dirname "$0")/lib.sh"
wf_init

raw="$(wf_get .prompt)"
[ -n "$raw" ] || wf_emit
case "$raw" in
  *"SYSTEM NOTIFICATION"*|*"task-notification"*|*"local-command-caveat"*) wf_emit ;;
esac
p="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"

skills=0; wf_skills_on && skills=1
# Arabic has no \b in grep; bound Arabic words by whitespace/ASCII punctuation instead, so that
# e.g. "المعدل" does not match "عدل" and "مخلص" does not match "خلص".
AB='(^|[[:space:][:punct:]])'; AE='([[:space:][:punct:]]|$)'
W='(^|[^[:alnum:]_])'; WE='([^[:alnum:]_]|$)'
n=0; out=""
add() {
  [ "$n" -ge 2 ] && return 0
  local line="$1"
  [ "$skills" = 1 ] && [ -n "$2" ] && line="$line Skill: $2."
  out="${out:+$out$'\n'}$line"; n=$((n + 1))
}
m() { printf '%s' "$p" | grep -qE -- "$1"; }

# Most specific first — the cap means order decides what survives.
# An explicit mode switch is an instruction about the flow itself: it comes first.
# Mode switches: only phrases aimed at the flow. "end to end tests" is a request, "on your own branch"
# is not about the flow, and a negated phrase ("don't go end to end") is no switch. When a step phrase
# appears at all, step wins — the safer gate.
p_flow="$(printf '%s' "$p" | sed -E 's/end[- ]to[- ]end[- ](tests?|testing|suite|specs?)//g; s/end-to-end/end to end/g')"
neg_auto=0
printf '%s' "$p_flow" | grep -qE "${W}(don.?t|do not|never|not)[[:space:]]+(go|run|do|finish|continue|keep going)[^.,;]*end to end|متعملش|ماتعملش|مش لوحدك" && neg_auto=1
neg_step=0
printf '%s' "$p" | grep -qE "${W}(don.?t|do not|no need to|never)[[:space:]]+(wait for|ask me)" && neg_step=1
if [ "$neg_step" = 0 ] && m "${W}(wait for (my )?approval|(go|work|proceed|do it) step by step|one step at a time|ask me before)${WE}|استن[ىي] موافقتي|(امشي|نمشي|اشتغل) خطو[ةه] خطو[ةه]"; then
  step_switch=1
  add "• Mode switch → write \`**Mode:** step\` in the story and the state file: stop after every sub-unit for the human." ""
elif [ "$neg_auto" = 0 ] && printf '%s' "$p_flow" | grep -qE -- "${W}((go|run|do|finish|carry on|continue|keep going)( it| this| the item)? end to end|on your own([[:space:]]*([,.!?؟—-]|and|then|$))|don.?t wait|do not wait|without waiting|no need to wait)${WE}|(كمل|كمّل|اشتغل|خلص|خلّص|امشي|اعمل[هاـ]*)[^.،]*لوحدك|من غير ما تستن[اىي]|متستناش|ماتستناش"; then
  add "• Mode switch → write \`**Mode:** auto\` in the story and the state file: run the sub-units without pausing. Brakes (scope escalator, discovery, plan change, the same test failing twice, an irreversible action) and the commit checkpoint still stop." ""
fi
# "Plan only" is not a mode but a stopping point (phases/lifecycle.md · Modes); a step phrase wins.
PO_END='[[:space:]]*([,.!?؟،—-]|please|for |$)'
if [ "${step_switch:-0}" = 0 ] && m "^[[:space:]]*(plan only|only the plan)${PO_END}|${W}(just|only) (the|a) plan${PO_END}|${W}plan only${PO_END}|خط[ةه] بس(${PO_END}|[[:space:]]+من غير)"; then
  add "• Plan only → a stopping point, not a mode: stop after the plan is approved, close the item at Plan ready, write no code." ""
fi
if m "${W}(permissions?|roles?|authoriz[a-z]*|authenticat[a-z]*|visibility|access control|access rules?|tenants?|row-level|record-level)${WE}|صلاحي|اذونات|أذونات"; then
  add "• Access/visibility work → record-level visibility is the highest-consequence check: a missing filter returns everything. Test allowed AND denied cases; verify as the affected identity (.workflow/phases/review.md)." ""
fi
# A scope escalator word means it is not a patch, however small it sounds.
if m "${W}(typos?|spelling|one[- ]line|one-liner|wording|rename)${WE}|إملائي|املائي|سطر واحد" \
   && ! m "${W}(migrations?|columns?|schema|tables?|permissions?|roles?|auth[a-z]*|payments?|money|api|endpoints?)${WE}|صلاحي|مايجريشن"; then
  add "• Trivial change → the patch lane only if no scope escalator and nothing sensitive: a routing line (patch — reason), the change, evidence after it, the (a)/(b)/(c) checkpoint. Any escalator or any doubt → bounded." ""
fi
if m "${W}(investigate|investigation|why does|how does|what causes|understand)${WE}|ليه بيحصل|${AB}(ازاي|إزاي|افهم|فهمني|تحقيق)${AE}"; then
  add "• Investigation → read-only route (WORKFLOW §3): evidence → findings → limitations → conclusion. No application code changes (.workflow/phases/lifecycle.md)." "superpowers:systematic-debugging"
fi
if m "${W}(bug|fix|error|broken|fail|fails|failing|crash|regress|exception|wrong|incorrect)${WE}|not work|doesn.t work|مش شغال|${AB}(مشكلة|مشكله|خطأ|غلط|باظ|باظت|عطل)${AE}"; then
  add "• Bug → reproduce and find the root cause with evidence before proposing a fix; then a failing regression test first." "superpowers:systematic-debugging, then superpowers:test-driven-development"
fi
if m "burhan:e2e|burhan:qc|${W}(story|subtasks?|sub-units?)${WE}|ستوري|سب.?تاسك"; then
  add "• Work-item flow → burhan:e2e <slug>, then burhan:qc <slug>; read the state file first." ""
fi
if m "${W}(build|implement|feature|refactor|add|new|create|support|modify|change|update|enable|rename)${WE}|${AB}(بناء|اضف|أضف|ضيف|ميزة|فيتشر|انشئ|عدل|عدّل|غيّر)${AE}"; then
  add "• New/changed behaviour → route it (type + scope + reason), then the gates it requires before any code (.workflow/phases/lifecycle.md)." "superpowers:brainstorming → superpowers:writing-plans → superpowers:test-driven-development"
fi
if m "${W}(review|done|finish|finished|complete|commit|ship)${WE}|${AB}(راجع|مراجعة|خلص|خلصت|خلصنا|سلّم|سلم)${AE}"; then
  add "• Wrapping up → review (.workflow/phases/review.md), then run the checks and SHOW the output before claiming done; commit only after the (a)/(b)/(c) checkpoint (.workflow/phases/close-out.md)." "superpowers:requesting-code-review, then superpowers:verification-before-completion"
fi
if m "${W}(merge|branch)${WE}|pull request|دمج|فرع|ميرج"; then
  add "• Finishing a branch → merge / PR / cleanup is the human's decision." "superpowers:finishing-a-development-branch"
fi
if [ -z "$out" ]; then
  [ "$skills" = 1 ] && out="• No phase keyword matched — run superpowers:using-superpowers before acting."
fi
[ -n "$out" ] && wf_say "⚑ Router — before acting:"$'\n'"$out"
wf_emit
