/** User prompt phase suggestions (port of prompt-router.sh). */
import { ere } from './ere.mjs';
import type { Check } from './lib.mjs';
import { skillLine, skillLineText } from './skill-line.mjs';
import { clearStateSnapshot } from './store.mjs';
import { reminderLine, undecided } from './understanding.mjs';

// Arabic has no \b in grep; bound Arabic words by whitespace/ASCII punctuation instead, so that
// e.g. "المعدل" does not match "عدل" and "مخلص" does not match "خلص".
const AB = '(^|[[:space:][:punct:]])';
const AE = '([[:space:][:punct:]]|$)';
const W = '(^|[^[:alnum:]_])';
const WE = '([^[:alnum:]_]|$)';

/** The port's ERE matcher intentionally has no RegExp source/flags API. Validate the unchanged ERE first;
 * these two sed expressions use only syntax shared with JS, then apply their global replacement. */
function sedGlobal(text: string, src: string, replacement: string): string {
  if (ere(src) === null) return text;
  return text.replace(new RegExp(src, 'g'), replacement);
}

export const promptRouter: Check = (ctx) => {
  const { ev, cfg } = ctx;
  // A new turn starts: a state-file baseline left by an interrupted turn (no Stop ran) must not carry over (multi-session-safety).
  clearStateSnapshot(ctx.project, ev.get('.session'), { ...ctx.env, ...cfg });
  const raw = ev.get('.prompt');
  if (raw === '') return [];
  if (raw.includes('SYSTEM NOTIFICATION') || raw.includes('task-notification') || raw.includes('local-command-caveat')) return [];
  const p = raw.toLowerCase();
  const skills = cfg.WF_SKILLS === 'superpowers';
  let n = 0;
  let out = '';
  const add = (line: string, skill: string): void => {
    if (n >= 2) return;
    if (skills && skill !== '') line += ` Skill: ${skill}.`;
    out += (out === '' ? '' : '\n') + line;
    n++;
  };
  const m = (src: string): boolean => ere(src)?.test(p) ?? false;

  // Most specific first — the cap means order decides what survives.
  // An explicit mode switch is an instruction about the flow itself: it comes first.
  // Mode switches: only phrases aimed at the flow. "end to end tests" is a request, "on your own branch"
  // is not about the flow, and a negated phrase ("don't go end to end") is no switch. When a step phrase
  // appears at all, step wins — the safer gate.
  let pFlow = sedGlobal(p, 'end[- ]to[- ]end[- ](tests?|testing|suite|specs?)', '');
  pFlow = sedGlobal(pFlow, 'end-to-end', 'end to end');
  // "auto mode" / "step mode" count after a verb or preposition only, so "what is auto mode?" is no switch.
  const modeEnd = '([^[:alnum:]_-]|$)';
  const named = (w: string): string => `${W}(use|using|switch(ed)?([[:space:]]+from[^,.;]*)?[[:space:]]+to|go|run|work|continue|proceed|in|on|with)[[:space:]]+(the[[:space:]]+)?${w}[- ]?mode${modeEnd}`
    + `|${W}mode[[:space:]]*[:=]?[[:space:]]*${w}${modeEnd}|${AB}و?(استخدم|استعمل|خليها|خليه|خلي|اشتغل|نشتغل|امشي|كمل|بال|ب|في|ف)[[:space:]]*${w}[- ]?mode${modeEnd}`;
  const negated = (w: string): string => `${W}(don.?t|do not|never|not|no)[[:space:]]+((use|run|go|switch)[[:space:]]+)?((to|in)[[:space:]]+)?(the[[:space:]]+)?${w}[- ]?mode`
    + `|${AB}(مش|بلاش|من غير)[[:space:]]*(ب|بال)?[[:space:]]*${w}[- ]?mode`;
  // A negated mode word cancels only its own phrase; the older phrases keep their own negations.
  const namedMode = (w: string, text: string): boolean => (ere(named(w))?.test(text) ?? false) && !(ere(negated(w))?.test(text) ?? false);
  let negAuto = false;
  if (ere(`${W}(don.?t|do not|never|not)[[:space:]]+(go|run|do|finish|continue|keep going)[^.,;]*end to end|متعملش|ماتعملش|مش لوحدك`)?.test(pFlow) ?? false) negAuto = true;
  let negStep = false;
  if (ere(`${W}(don.?t|do not|no need to|never)[[:space:]]+(wait for|ask me)`)?.test(p) ?? false) negStep = true;
  let stepSwitch = false;
  if ((!negStep && m(`${W}(wait for (my )?approval|(go|work|proceed|do it) step by step|one step at a time|ask me before)${WE}|استن[ىي] موافقتي|(امشي|نمشي|اشتغل) خطو[ةه] خطو[ةه]`)) || namedMode('step', p)) {
    stepSwitch = true;
    add('• Mode switch → write `**Mode:** step` in the story and the state file: stop after every sub-unit for the human.', '');
  } else if ((!negAuto && (ere(`${W}((go|run|do|finish|carry on|continue|keep going)( it| this| the item)? end to end|on your own([[:space:]]*([,.!?؟—-]|and|then|$))|don.?t wait|do not wait|without waiting|no need to wait)${WE}|(كمل|كمّل|اشتغل|خلص|خلّص|امشي|اعمل[هاـ]*)[^.،]*لوحدك|من غير ما تستن[اىي]|متستناش|ماتستناش`)?.test(pFlow) ?? false)) || namedMode('auto', pFlow)) {
    add('• Mode switch → write `**Mode:** auto` in the story and the state file: run the sub-units without pausing. Brakes (scope escalator, discovery, plan change, the same test failing twice, an irreversible action) and the commit checkpoint still stop.', '');
  }
  // "Plan only" is not a mode but a stopping point (phases/lifecycle.md · Modes); a step phrase wins.
  const PO_END = '[[:space:]]*([,.!?؟،—-]|please|for |$)';
  if (!stepSwitch && m(`^[[:space:]]*(plan only|only the plan)${PO_END}|${W}(just|only) (the|a) plan${PO_END}|${W}plan only${PO_END}|خط[ةه] بس(${PO_END}|[[:space:]]+من غير)`)) {
    add('• Plan only → a stopping point, not a mode: stop after the plan is approved, close the item at Plan ready, write no code.', '');
  }
  if (m(`${W}(permissions?|roles?|authoriz[a-z]*|authenticat[a-z]*|visibility|access control|access rules?|tenants?|row-level|record-level)${WE}|صلاحي|اذونات|أذونات`)) {
    add('• Access/visibility work → record-level visibility is the highest-consequence check: a missing filter returns everything. Test allowed AND denied cases; verify as the affected identity (.burhan/phases/review.md).', '');
  }
  // A scope escalator word means it is not a patch, however small it sounds.
  if (m(`${W}(typos?|spelling|one[- ]line|one-liner|wording|rename)${WE}|إملائي|املائي|سطر واحد`)
    && !m(`${W}(migrations?|columns?|schema|tables?|permissions?|roles?|auth[a-z]*|payments?|money|api|endpoints?)${WE}|صلاحي|مايجريشن`)) {
    add('• Trivial change → the patch lane only if no scope escalator and nothing sensitive: a routing line (patch — reason), the change, evidence after it, the (a)/(b)/(c) checkpoint. Any escalator or any doubt → bounded.', '');
  }
  if (m(`${W}(investigate|investigation|why does|how does|what causes|understand)${WE}|ليه بيحصل|${AB}(ازاي|إزاي|افهم|فهمني|تحقيق)${AE}`)) {
    add('• Investigation → read-only route (WORKFLOW §3): evidence → findings → limitations → conclusion. No application code changes (.burhan/phases/lifecycle.md).', 'superpowers:systematic-debugging');
  }
  if (m(`${W}(bug|fix|error|broken|fail|fails|failing|crash|regress|exception|wrong|incorrect)${WE}|not work|doesn.t work|مش شغال|${AB}(مشكلة|مشكله|خطأ|غلط|باظ|باظت|عطل)${AE}`)) {
    add('• Bug → reproduce and find the root cause with evidence before proposing a fix; then a failing regression test first.', 'superpowers:systematic-debugging, then superpowers:test-driven-development');
  }
  if (m(`burhan:e2e|burhan:qc|${W}(story|subtasks?|sub-units?)${WE}|ستوري|سب.?تاسك`)) {
    add('• Work-item flow → burhan:e2e <slug>, then burhan:qc <slug>; read the state file first.', '');
  }
  if (m(`${W}(build|implement|feature|refactor|add|new|create|support|modify|change|update|enable|rename)${WE}|${AB}(بناء|اضف|أضف|ضيف|ميزة|فيتشر|انشئ|عدل|عدّل|غيّر)${AE}`)) {
    add('• New/changed behaviour → route it (type + scope + reason), then the gates it requires before any code (.burhan/phases/lifecycle.md).', 'superpowers:brainstorming → superpowers:writing-plans → superpowers:test-driven-development');
  }
  if (m(`${W}(review|done|finish|finished|complete|commit|ship)${WE}|${AB}(راجع|مراجعة|خلص|خلصت|خلصنا|سلّم|سلم)${AE}`)) {
    add('• Wrapping up → review (.burhan/phases/review.md), then run the checks and SHOW the output before claiming done; commit only after the (a)/(b)/(c) checkpoint (.burhan/phases/close-out.md).', 'superpowers:requesting-code-review, then superpowers:verification-before-completion');
  }
  if (m(`${W}(merge|branch)${WE}|pull request|دمج|فرع|ميرج`)) {
    add('• Finishing a branch → merge / PR / cleanup is the human\'s decision.', 'superpowers:finishing-a-development-branch');
  }
  if (out === '' && skills) out = '• No phase keyword matched — run superpowers:using-superpowers before acting.';
  const found = out === '' ? [] : [`⚑ Router — before acting:\n${out}`];
  // The understanding reminder is its own line, outside the two-line cap; not while the person runs the onboarding.
  let state: ReturnType<typeof undecided> = null;
  if (!m(`burhan:onboard|commands/onboard\\.md|${W}understand (this|the) project${WE}|${AB}(افهم|فهم) المشروع${AE}`)) {
    try { state = undecided(ctx); } catch { state = null; }
  }
  // The skill line is its own line too, outside the two-line cap: the phase comes from the item's files, not from the words.
  const sk = skillLine(ctx);
  const lines = sk === null ? found : [...found, skillLineText(sk)];
  return state === null ? lines : [...lines, reminderLine(state)];
};
