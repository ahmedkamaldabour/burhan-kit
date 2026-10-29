# برهان burhan

الـ coding agents بتقول “done” من غير دليل.

‏burhan هو **spec-driven development (SDD)** لـ Claude Code وCodex. الـ story والـ plan هما الـ spec: إنت بتوافق عليهم قبل الكود، وكل acceptance criterion مربوط بـ test، والشغل اللي بيخرج عنهم بيقف وبيتسجّل. كل خطوة بتتراجع، والأوامر والـ hooks (scripts صغيرة بتبلّغ في لحظات محددة) بتحتفظ بدليل للي اتشغّل.

- **اتفق الأول:** وافق على الـ story (إيه وليه) والـ plan (إزاي) قبل الكود.
- **ورّي الدليل:** سجّل التعديلات والأوامر؛ وعلّم على “done” من غير check ناجح.
- **إنت تعمل commit:** تختار دلوقتي، بعدين، أو بنفسك.

[![npm version](https://img.shields.io/npm/v/burhan-kit.svg)](https://www.npmjs.com/package/burhan-kit) [![CI](https://github.com/ahmedkamaldabour/burhan-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/ahmedkamaldabour/burhan-kit/actions/workflows/ci.yml) [![MIT license](https://img.shields.io/github/license/ahmedkamaldabour/burhan-kit.svg)](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/LICENSE) **Node 22+**

[English](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/README.md)

## المشكلة والحل

| الـ agent لوحده ممكن | ‏burhan بيساعده |
| --- | --- |
| يكتب قبل ما تتفقوا على المهم | يقف لحد ما توافق على الـ story والـ plan |
| يقول الشغل خلص من غير دليل حديث | يحذر لو آخر تعديل كود معندوش check ناجح |
| يراجع من ذاكرته هو | يخلّي reviewer منفصل يفحص كل خطوة، لما ينفع |
| يضيّع السجل في الشات | يحتفظ بملفات المهمة وسجل بالتعديلات والأوامر اللي الـ agent بيبلّغ بيها (الـ ledger) |
| يبدأ كل session من غير سياق | يوجّهه لـ project memory وحالة المهمة |

استخدم burhan لما قراراتك كشخص، وسجل تقدر تراجعه، وprocess على قد الشغل يفرقوا. مش هيمنع الـ agent بالقوة أو يثبت شغل مااتبلغش عنه.

## جولة في دقيقة

ده run حقيقي مختصر من [شرح أول مهمة](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/first-task.md).

```text
you    /burhan:e2e slugify — add a function slugify(text) in src/slugify.js … with a test
agent  burhan needs one thing before it can check your work: …
         Check before commit   `npm test` (runs `node --test` …) …
       ● Use these   ○ Change something
you    Use these.
agent  **Route:** feature / bounded. It's one pure function with no scope escalator, so it gets one combined story and plan gate. …
       **Waiting on you:** reply "approved" to approve both the story and the plan … I won't write code before then.
```

إنت بتختار الـ checks المقترحة. الـ agent بيسمي الـ route (كام process المهمة دي بتاخد) ويكتب story وplan. `approved` منك يخلّيه يبدأ build، لكن لسه بيقف عند قراراتك اللي بعد كده. أول block هو setup أول استخدام: المهام اللي بعده بتبدأ من الـ route. الـ gate والـ route والـ scope escalator في جدول المصطلحات تحت.

## ابدأ بسرعة

1. اختياري ومُوصى بيه: ثبّت Superpowers الأول، عشان الـ setup يقدر يشغّل الـ skills بتاعته. burhan عمره ما بيثبّته. في Claude Code اكتب `/plugin install superpowers@claude-plugins-official`؛ في Codex استخدم `/plugins` وادوّر على `superpowers` وثبّته؛ وبعد الخطوة 2 حط كمان `WF_SKILLS='superpowers'` في `.burhan/workflow.config` (الـ setup مش بيشوف plugins Codex). Superpowers plugin فيها process skills للـ agent؛ burhan بيربط مراحله بيها.

2. في جذر المشروع، ومعاك Node 22 أو أحدث، شغّل:

   ```bash
   npx burhan-kit
   npx burhan-kit doctor
   ```

   الـ setup بيسأل أسئلة، ويعرض summary، ومابيكتبش غير بعد موافقتك. الـ hooks الموجودة بتفضل. في Codex، [ثق في project hooks](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md#codex-trust-the-hooks) من `/hooks`؛ غير كده مش هتشتغل. setup السليم يقول `all 6 hooks wired`.

3. افتح **session جديدة** للـ agent جوه المشروع. اكتب `start` (أي رسالة أولى تنفع)؛ أو `/burhan:onboard` في Claude Code؛ أو `Follow .burhan/commands/onboard.md` في Codex. الـ agent يقترح checks وفهم للمشروع عشان توافق عليهم.

ابدأ مهمة بـ `/burhan:e2e <slug>` في Claude Code. في Codex اتبع command file جوه `.burhan/commands/`.

## إيه اللي برهان بيحطه في مشروعك

```text
.burhan/
  WORKFLOW.md SETUP.md VERSION phases/ templates/ commands/ hooks/  kit-owned; upgrade refreshes
  bindings.md workflow.config                                     بتوعك؛ يتعمل لهم commit وreview
  PROJECT.md context/                                             project memory مشتركة، بعد onboarding
  local/PROGRESS.md                                               لكل developer؛ git-ignored
  work/<task>/                                                    task files خاصة افتراضيًا
  discovery/                                                      findings جانبية خاصة افتراضيًا
  .gitignore                                                      بيتجاهل local/, work/, discovery/
.claude/ or .codex/                                               hook settings وagent bindings
CLAUDE.md or AGENTS.md                                            marked burhan block؛ النص برا يفضل بتاعك
```

ماتعدّلش ملفات الـ kit. `upgrade` بيجدّدها. خليك عامل version control لـ `bindings.md` و`workflow.config` وmemory وtask files المشتركة.

افتراضيًا work وdiscovery خاصين. لو عايز تشاركهم، خلّي `WF_DOCS_DIR` لمسار زي `docs/burhan/work` و`WF_DISCOVERY_DIR` لـ `docs/burhan/discovery`؛ راجع [configuration](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md#workflowconfig).

## برهان بيشتغل إزاي

| المصطلح | المعنى |
| --- | --- |
| Story | إيه وليه، ومعاها acceptance criteria |
| Plan | إزاي: القرارات، ومعاها build spec (الـ tests والكود بالظبط) |
| Route | نوع المهمة وscope وسبب في سطر؛ بتحدد الخطوات |
| Intake | الـ agent بيعيد طلبك ويختار الـ route |
| Task (item) | شغل واحد له folder خاص؛ اسمه المختصر هو الـ `<slug>` |
| Gate | نقطة الـ agent بيستناك فيها |
| Sub-unit | خطوة build صغيرة مخطط لها |
| QC | فحص الجودة المستقل الأخير |
| Knowledge review | الـ agent بيقترح دروس تستاهل تتحفظ؛ إنت تحتفظ بيها أو ترفضها |
| Baseline | سجلك المعتمد (أو المتنازل عنه) لفهم الـ agent للمشروع |
| Deviation | خطوة خرجت عن الـ plan المعتمدة |
| RED / GREEN | ‏test بيفشل زي المتوقع / نفس الـ test بينجح |
| Hook | ‏script صغير بيبلّغ في لحظة محددة |
| Ledger | سجل التعديلات والأوامر اللي الـ agent بيبلّغ بيها |
| Scope escalator | سمة خطر عالي (مذكورة تحت في Routes) بتخلّي المهمة architectural |

```text
you ask → Intake → Story ✋ → Plan ✋ → ┌ Build → Review ┐ → Verify ✋ → QC ✋ → Knowledge ✋ → Commit ✋
                                      └ repeats per sub-unit ┘

✋  دايماً إنت، في الـ modes الاتنين: توافق، تختار، تقبل
step  ⏸ كمان بيقف بعد build وreview كل sub-unit
auto  بيكمّل اللوب وبيحافظ على وقفات ✋؛ وكمان بيقف عند brake ⚠: ظهر scope escalator،
      أو حاجة محدش طلبها، أو الـ plan لازم يتغيّر، أو نفس الـ test فشل مرتين،
      أو خطوة مش بترجع فيها
```

الـ route بيختار gates. الـ mode بيختار الوقفات بين sub-units؛ مش permission للـ agent.

| مهمة فيها 3 sub-units | step | auto |
| --- | --- | --- |
| ‏Story وplan | إنت توافق | توافق مرة في bounded work |
| ‏Build وreview | يقف بعد كل واحدة | يكمل بينهم |
| Verification | يسأل لما يجهز | يسأل مرة في البداية |
| ‏QC وcommit | إنت تقرر | إنت تقرر |

‏`step` هو الافتراضي. قول “كمّل لوحدك” لـ `auto`، أو “استنى موافقتي” لـ `step`. `plan only` بينهي بعد plan معتمدة من غير كود.

## حياة المهمة

```text
work/<task>/
  <task>-story.md                Draft → Approved                 approve story
  <task>-implementation-plan.md  Draft → Approved → In progress → Completed   approve plan; item set; item finish
  <task>-build-spec.md           tests, code, commands بالضبط     تعتمد مع plan
  reviews/                       reports للـ review وverification وQC   review add
  sources/                       الأصلي اللي إنت اديته للـ agent؛ مابيتعدلش
  repro/                         scripts وlogs بتوع الـ agent
.burhan/local/PROGRESS.md        block حالة حالي لكل task
```

كل sub-unit بتمشي **Draft → Approved → In progress → Implemented → Reviewed**. `item set` بيسمح بدرجة واحدة كل مرة. لازم section review قبل `Reviewed`.

الـ plan ملفين: القرارات (ومعاها coverage لمعايير القبول وrulings) وbuild spec. الـ spec بتدي لكل sub-unit الملفات وtest وcode كاملين وأوامر RED وGREEN والـ expected output والـ interfaces.

نفّذ الـ spec بالضبط. لو RED ما فشلش زي المتوقع، أو GREEN فشل، أو ملف مختلف، قف. `deviation add` بيسجل الفرق. لحد ما تحله، `guide` بيقول إن تعديل الكود غير مسموح؛ والـ deviation المعتمدة بتحدّث الـ plan والـ spec الأول، وبعدين الكود.

## المسارات

كل طلب بياخد route قبل الشغل: type وscope وسبب في سطر. تقدر تصححه. أي واحدة من دول بتخلّي المهمة architectural مهما كان حجمها، واسمها **scope escalator**: security أو privacy impact · authorization أو visibility rules · persistent data-model أو migration changes · money أو accounting correctness · derived state مشترك بين modules · external integration contracts أو public APIs · irreversible behaviour · concurrency أو transaction rules. الـ `patch` موجودة بس لـ change أو bug أو refactor.

| Route | المشوار المطلوب | نقطة مهمة |
| --- | --- | --- |
| Feature, bounded | story + plan, build, review, verify, QC, knowledge | موافقة واحدة للـ story والـ plan |
| Feature, architectural | story, plan, build, review, verify, QC, knowledge | الـ plan فيها design options |
| Change, bounded | story + plan, build, review, verify, knowledge | من غير QC |
| Change, architectural | story, plan, build, review, verify, QC, knowledge | موافقتين |
| Bug, bounded | story + plan, build, review, verify, knowledge | ‏root cause وfailing regression test الأول |
| Bug, architectural | story, plan, build, review, verify, QC, knowledge | موافقتين |
| Refactor, bounded | plan, build, review, verify | ‏tests تحافظ على السلوك الأول |
| Refactor, architectural | plan, build, review, verify, knowledge | الـ plan فيها options |
| Release | plan, verify, review | ‏architectural release فيها rollback |
| Patch | routing line, change, proof, commit checkpoint | تغيير واحد واضح وآمن؛ من غير story أو plan |
| Investigation | findings, knowledge | ‏read-only؛ مفيش application code |

## إيه اللي إنت بس بتقرره

| القرار | ‏burhan بيحفظه إزاي |
| --- | --- |
| ‏Story وplan | ‏`approve` يسجل اسمك ويرفض اسم agent؛ القرار فضل بتاعك |
| Baseline | الـ agent بيكتبها بس بعد ما توافق أو تصحح أو تتنازل |
| مين يعمل verification | الـ agent لازم يسأل قبل verification حقيقي |
| ‏verdict الـ QC | ‏QC تقترح PASS أو FAIL؛ إنت تقبله |
| ‏deviation أو discovery | الشغل يقف؛ finding منفصلة ماتتصلحش في السر |
| Commit | دلوقتي أو بعدين أو بنفسك؛ “finish” مش موافقة |
| ‏Push أو pull request | بس لما تطلب |
| Codex hook trust | إنت تديه؛ burhan عمره ما بيديه |

## المراجعات

| Review | إمتى | بتثبت إيه |
| --- | --- | --- |
| Sub-unit | بعد build وقبل اللي بعدها | إن التغيير الصغير المخطط سليم |
| Review group | بعد مجموعة متخطط لها | ‏review قصيرة لمنطقة واحدة مش حساسة |
| Re-review | بعد findings | الإصلاح والـ findings القديمة؛ تتوسع عند اللزوم |
| Verification | بعد ما sub-units تبقى `Reviewed` | تمر على كل acceptance criterion |
| ‏QC نهائي | ‏routes اللي محتاجاه | ‏convergence review جديدة وadversarial |

الـ reviewer بيقرأ task files والـ diff والـ ledger، وبعدها يكتب report. كل review تسجل `Performed by`: agent وmodel وcontext. الـ agent التاني يقدر يراجع لو متظبط. QC في نفس session بتتعلم وبتتحسب self-review.

‏QC بتقترح `PASS` أو `FAIL — N issues`، ومعاها findings Critical أو Important أو Minor. PASS دليل مش ضمان. FAIL بترجع المهمة للـ build؛ QC الجاية تأكد الإصلاح أو توسع المراجعة.

## الإثبات

الـ hooks بتبلّغ وبتفشل open؛ عمرها ما بتمنع. task commands بترفض خطوة lifecycle غلط، لكن الـ agent يقدر يتخطاهم.

| اللحظة | Hook | الوظيفة |
| --- | --- | --- |
| بداية session | `session-gates` | ‏gates وحالة المهمة وأول setup والمهام المفتوحة |
| رسالتك | `prompt-router` | اقتراح phase وmode وتذكير baseline |
| قبل commit | `pre-commit-check` | ‏fast check واختيارك للـ commit |
| قبل write | `pre-edit-skill` | ‏skill ناقصة وstate block بتاعة session تانية |
| بعد edit | `post-edit-reminder` | تذكير test-first وsensitive path |
| آخر turn | `turn-audit` | ‏audit للدليل والـ lifecycle وcompletion |

الـ audit بتعلّم على “done” من غير proof ناجح بعد آخر code edit. كمان بتعلّم على state قديمة، وكود قبل baseline محسومة، وكود read-only، وskills متخطية، وQC provenance ضعيفة، وtask-file contracts مكسورة.

```text
⚠ VERIFICATION GATE: completion was claimed, but the last run of `npm test 2>&1 | tail -15` was blocked and never ran. Run it, show the output — or retract the claim.
```

الـ [run المسجل](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/first-task.md) بيورّي التحذير ده وهو بيخلّي agent يسحب “Done.”

الـ ledger برا المشروع في `~/.local/state/burhan/evidence/`. بتسجل reported edits وcommand lines وexit codes والترتيب وربط المهمة؛ مش command output. `evidence --item <slug>` بيعرضها.

‏whole-suite run ناجح بعد آخر code edit يقدر يكفي verification وQC وcommit. استخدمه تاني لحد ما code أو tests تتغير. `guide` بيعرض حالة `full run:`.

## مرجع

### الإعدادات

‏`WF_CHECK_CMD` هو fast pre-commit check. `WF_CODE_REGEX` و`WF_TEST_REGEX` بيحددوا code وtests. `WF_EVIDENCE_REGEX` بيقول أي commands تعتبر proof. `WF_FULL_TEST_REGEX` بيحدد whole suite. `WF_SENSITIVE_REGEX` و`WF_SENSITIVE_NOTE` بيضيفوا تذكير للمسار الحساس. لو code أو proof patterns فاضيين، تحذير “done” مش هيشتغل. المشروع اللي اتعمل بـ `burhan init` فيه task-file checks شغالة (`WF_ITEM_CONTRACT=on`).

### الأوامر

‏`item new` بينشئ files على شكل route. `approve` بيسجل قرار شخص. `item set` بينقل status مسموح. `review add` يحتاج reviewer provenance. `deviation add` بيجمّد code authorization لحد الحل. `item finish` يحتاج units Reviewed وgates ومن غير deviation مفتوحة وproof حديث. `item check` بيبلغ عن مشاكل task files. `state compact` بيقصّر سطور المهام المقفولة في الـ state file (dry run لحد `--apply`).

تقارير read-only: `status` (ومعاه `--write` بيكتب فهرس المهام) و`stats` و`evidence` و`changed` و`pr-body` و`memory` و`inspect` و`doctor`. `use <slug>` بيربط session بمهمة. الـ agent بيشغّلهم كـ `npx burhan-kit <command>`؛ وإنت تقدر كمان. شغّل `doctor` من project root: من مجلد فرعي بيقول إن burhan مش متثبّت.

### ذاكرة المشروع

‏Onboarding بيمسح المشروع ويعمل draft لـ `.burhan/PROJECT.md` وfact files في `.burhan/context/`. إنت توافق أو تصحح أو تعمل waive للـ baseline. كل fact فيها path وshort hash، مش محتوى الملف. `memory status` يقول fresh أو changed أو missing أو unchecked؛ و`memory check` ينفع للـ CI. knowledge review بتقترح دروس ثابتة عشان تقرر فيها.

### بين Claude Code وCodex

‏Claude Code بيستخدم `/burhan:e2e` و`/burhan:qc` و`/burhan:onboard`؛ Codex بيتبع command files المثبتة من خلال `AGENTS.md`. نتائج Codex hooks محتاجة trust. command من غير نتيجة مسجلة مش passing.

‏Superpowers اختياري. لما يتفعل، burhan بيربط المراحل بـ skills brainstorming وplanning وtest-first وdebugging وreview وverification. Claude Code يقدر يولّد roles planner وbuilder وexplorer وreviewer على models متظبطة. Codex بيستخدم model config بتاعتك؛ burhan ما بيكتبهاش.

‏sessions كتير تقدر تشتغل على tasks منفصلة. خليك task واحدة لكل session. الإعدادات والـ memory وtask folders المشتركة يعدوا على review؛ `.burhan/local/` شخصية.

### الأمان والرجوع

‏`init` و`upgrade` و`uninstall` dry runs لحد `--apply`. setup بتتحقق قبل أول write. upgrade بتجدّد kit files وبتدمج exact hook entries من غير ما تكتب فوق `workflow.config` أو `bindings.md`. write من خلال link خارج المشروع بيتمنع إلا لو إنت سمحت.

‏uninstall بيمسح kit folders كاملة تحت `.burhan/`: `WORKFLOW.md` و`SETUP.md` و`VERSION` و`phases` و`templates` و`commands` و`hooks`. بيسيب `workflow.config` و`bindings.md` و`.burhan/local/` وtask files إلا مع `--all`. الـ `--all` بتمسح `work/` و`discovery/` الخاصين؛ وtask folder مشترك وجّهت `WF_DOCS_DIR` ليه عمره ما بيتمسح.

### الحدود

- ‏Hooks عمرها ما بتمنع؛ task commands بترفض خطوة غلط؛ والـ agent يقدر يتخطى الاتنين.
- ‏Hooks بتشوف بس النشاط اللي الـ agent بلّغ عنه. shell edits بتبان بـ `>` و`>>` و`tee` بس.
- ‏Codex hooks محتاجة trust. command من غير recorded result مش بتمر.
- ‏Windows CI بتشغّل Node suite على `windows-latest` وNode 24، من غير bash أو `jq`. ده مش coverage لـ PowerShell بس أو session agent حقيقية.
- الـ ledger بتكبر لحد ما تمسحها. مش بتثبت نشاط برا reported tool calls.

### أسئلة شائعة

**كل task لازم تمشي في كل stage؟** لأ. الـ route بتختار المسار على قد الشغل؛ patch بتعدي من غير story وplan.

‏**burhan محتاجة لغة أو framework؟** لأ. إنت بتظبط checks وpatterns لمشروعك.

‏**burhan بتبعت project data على network؟** source بتاعها مفيهوش network client calls. تثبيت package ممكن يستخدم network.

### الوثائق

[Features and routes](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/features.md) · [Configuration](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md) · [Recorded first task](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/first-task.md) · [Upgrading](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/upgrading.md) · [CI and Windows](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/ci-and-windows.md) · [Changelog](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/CHANGELOG.md) · [Roadmap](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/ROADMAP.md) · [Issues](https://github.com/ahmedkamaldabour/burhan-kit/issues)

## الرخصة

‏MIT. شوف [LICENSE](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/LICENSE).
