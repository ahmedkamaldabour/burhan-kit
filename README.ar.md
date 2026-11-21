# برهان burhan

الـ coding agents بتقول “done” من غير دليل.

‏burhan هو **spec-driven development (SDD)** لـ Claude Code وCodex. الـ story والـ plan هما الـ spec: إنت بتوافق عليهم قبل الكود، وكل acceptance criterion مربوط بـ test، وأي خطوة بتخرج عنهم بتتسجّل: مشكلة محتاجة قرارك بتوقّف الشغل، ومشكلة حلها معروف بتتصلّح وتتسجّل. كل خطوة بتتراجع، والأوامر والـ hooks (scripts صغيرة بتبلّغ في لحظات محددة) بتحتفظ بدليل للي اتشغّل.

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

**المتطلبات:** Node 22+؛ و Claude Code 2.1.139 أو أحدث و/أو Codex بعد ما توافق على الـ hooks بتاعته؛ والـ kit مسطّب في المشروع (`npm i -D burhan-kit`) أو على الـ PATH (`npm i -g burhan-kit`). في الوثائق دي `burhan` معناها الـ kit command بتاع المشروع، اللي مكتوب في `.burhan/bindings.md`: `npx burhan-kit` بيشغّل النسخة المسطّبة في المشروع، و`burhan` لوحدها بتشتغل بس لو موجودة على الـ PATH. burhan عمره ما بيشغّل npm: ولو الـ setup ما لقاش الـ kit command بيطبع لك أمر التسطيب وإنت اللي تشغّله.

1. مفيش حاجة تسطّبها الأول: burhan جاي بـ process skills بتاعته (story وplan وbuild وdebug وreview وdone) والخطوة 2 بتسطّبها.

2. في جذر المشروع، ومعاك Node 22 أو أحدث، شغّل:

   ```bash
   npx burhan-kit
   npx burhan-kit doctor
   ```

   الـ setup بيسأل أسئلة، ويعرض summary، ومابيكتبش غير بعد موافقتك. الـ hooks الموجودة بتفضل. في Codex، [ثق في project hooks](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md#codex-trust-the-hooks) من `/hooks`؛ غير كده مش هتشتغل. setup السليم يقول `all 6 hooks wired`.

3. افتح **session جديدة** للـ agent جوه المشروع. اكتب `start` (أي رسالة أولى تنفع)؛ أو `/burhan:onboard` في Claude Code؛ أو `Follow .burhan/commands/onboard.md` في Codex. الـ agent يقترح checks وفهم للمشروع عشان توافق عليهم.

ابدأ مهمة بـ `/burhan:e2e <slug>` في Claude Code. في Codex اتبع command file جوه `.burhan/commands/`. القسم اللي بعده بيمشّيك في أول مهمة؛ والأقسام اللي بعده بتشرح كل جزء، وقسم مرجع في الآخر للبحث.

## أول مهمة ليك

بعد الـ setup، اطلب حاجة صغيرة، زي function ومعاها test. الـ agent بيمشي في الوقفات اللي تحت وبيستناك عند كل واحدة؛ العمود الأخير هو اللي بيشغّله (كل command ليه `--help` بيطبع طريقة استخدامه). في وضع `step`، وهو الافتراضي، بتشوف كل وقفة.

| الوقفة | إنت بتقرر | الـ agent بيشغّل |
| --- | --- | --- |
| 1 · Intake | الـ route (type وscope والسبب) مناسب ولا لأ | `item new <slug> --type feature --scope bounded`، وبعدها `guide <slug>` |
| 2 · Story وplan | تجاوب على أسئلته، وتقرا الكارت اللي في شاشة واحدة، وتقول آه، وبعدها تشغّل إنت `approve story <slug> --by <name>` و`approve plan <slug> --by <name>` باسمك (الـ agent بيوريك الأمر) | بيكتب story وplan وbuild spec، وبعدها `item check <slug>` |
| 3 · Sub-unit واحدة | تكمّل ولا لأ (`step` بيقف بعد كل واحدة) | الـ test الأول ومتشاف بيفشل (RED)، وبعدين الكود، وبعدين نفس الـ test بينجح (GREEN)، وfast check؛ و`item set <slug> unit 1 in-progress` قبل، و`item set <slug> unit 1 implemented` بعد |
| 4 · Review | كل finding: اتصلّحت، أو discovery، أو مقبولة بسببك | reviewer جديد: `review add <slug> --kind review --unit 1 --by "<agent · model · context>"` و`finding add`؛ وإنت بترد بـ `finding decide`؛ وبعدين `item set <slug> unit 1 reviewed` |
| 5 · A surprise (في أي وقفة) | بس المشكلة اللي محتاجة قرار هي اللي بتوقّف الشغل | حل معروف بيتصلّح ويتسجّل بـ `deviation add <slug> … --apply` والبناء يكمّل؛ واختيار حقيقي بـ `deviation add <slug> …` ووقفة لحد ما تشغّل `deviation resolve` |
| 6 · Verify | مين يعمل الفحص الحقيقي (الـ agent بيسأل الأول) | `verify <slug> -- npm test` (أمر مشروعك إنت)، وبعدها `review add <slug> --kind verification` |
| 7 · QC | تقبل PASS، أو ترجّع المهمة للـ build | reviewer جديد: `review add <slug> --kind qc --verdict PASS` و`finding add <slug> --in qc --none`؛ وإنت بتقبلها بـ `approve qc <slug> --by <name>` |
| 8 · الإقفال | أي دروس تتحفظ؛ commit دلوقتي أو بعدين أو بنفسك | `item finish <slug>` (بيسمّي كل gate لسه مفتوح؛ وتعلّم واحد بـ `gate tick <slug> <gate> --evidence <proof>`) وبعدها `state close <slug> --outcome <state> --commit <id> --folder <path>` |

الـ route الأصغر بتعدّي على الوقفات اللي مش محتاجاها (شوف المسارات). وفي أي لحظة `burhan guide <slug>` بيقول المرحلة، وتعديل الكود مسموح ولا لأ، والخطوة الجاية.

## إيه اللي برهان بيحطه في مشروعك

```text
.burhan/
  WORKFLOW.md SETUP.md VERSION phases/ templates/ commands/ skills/ hooks/  kit-owned; upgrade refreshes
  bindings.md workflow.config                                     بتوعك؛ يتعمل لهم commit وreview
  PROJECT.md context/                                             project memory مشتركة، بعد onboarding
  local/PROGRESS.md                                               لكل developer؛ git-ignored
  work/NNN-slug/                                                  task files؛ خاصة مع init، وفي git لو اخترت كده في setup
  discovery/                                                      findings جانبية؛ خاصة مع init، وفي git لو اخترت كده في setup
  .gitignore                                                      بيتجاهل local/, work/, discovery/
.claude/ or .codex/                                               hook settings وagent bindings
.claude/skills/burhan-*/                                          Claude Code بس: نسخ managed من الـ skills
CLAUDE.md or AGENTS.md                                            marked burhan block؛ النص برا يفضل بتاعك
```

ماتعدّلش ملفات الـ kit. `upgrade` بيجدّدها. خليك عامل version control لـ `bindings.md` و`workflow.config` وmemory وtask files المشتركة.

فولدر الـ task اسمه `NNN-slug`، مثلًا `work/012-slugify/`: `item new` بياخد الرقم اللي بعده (أعلى رقم زائد واحد)، وكل command بيقبل الرقم أو الـ slug لوحده أو الاسم الكامل. الفولدر اللي اتعمل قبل الترقيم بيفضل باسمه. `skills/` فيه الـ process skills الستة اللي جاية مع الـ kit (شوف مرجع)؛ وskill بتاعتك بنفس الاسم في `.claude/skills/` عمرها ما بتتكتب فوقها.

`init` بيخلّي work وdiscovery خاصين؛ والـ setup wizard بيقترح تحطهم في git. في الحالتين `WF_DOCS_DIR` و`WF_DISCOVERY_DIR` بيحدّدوا المجلدات، مثلًا `docs/burhan/work` و`docs/burhan/discovery`؛ راجع [configuration](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md#workflowconfig).

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
| Deviation | خطوة ما مشيتش زي ما الـ build spec قال، بتتسجّل كصف في الـ plan |
| Deviation, applied | مشكلة حلها معروف: الـ agent بيصلّحها وبيسجّلها بـ `deviation add --apply`، والبناء يكمّل |
| Deviation, open | مشكلة محتاجة قرار: الشغل بيقف لحد ما تقرر فيها |
| Finding | مشكلة الـ review أو الـ QC بتبلّغ عنها، ومعاها severity: Critical أو Important أو Minor |
| Decision | ردك المسجّل على finding: اتصلّحت، أو discovery، أو مقبولة بسبب (عمرها ما تتقبل لو Critical) |
| Discovery | حاجة اتلقت والمهمة ما طلبتهاش؛ بتروح لملف لوحدها وبتتعمل كمهمة لوحدها |
| Legacy | حالة مهمة قديمة خلصت من غير سطر route ولا ملف QC؛ الفهرس بيطويها في block واحد |
| RED / GREEN | ‏test بيفشل زي المتوقع / نفس الـ test بينجح |
| Hook | ‏script صغير بيبلّغ في لحظة محددة |
| Ledger | سجل التعديلات والأوامر اللي الـ agent بيبلّغ بيها |
| Scope escalator | سمة خطر عالي (مذكورة تحت في Routes) بتخلّي المهمة architectural |

```text
you ask → Intake → Story ✋ → Plan ✋ → ┌ Build → Review ┐ → Verify ✋ → QC ✋ → Knowledge ✋ → Commit ✋
                                      └ repeats per sub-unit ┘

✋  دايماً إنت، في الـ modes الاتنين: توافق، تختار، تقبل
step  ⏸ كمان بيقف بعد build وreview كل sub-unit
auto  بيكمّل اللوب وبيحافظ على وقفات ✋؛ وكمان بيقف عند brake ⚠: مشكلة محتاجة قرارك
      (تغيير في النية، اختيار حقيقي، security، data، فلوس، خطوة مش بترجع)؛
      ومشكلة حلها معروف بتتصلّح وتتسجّل والبناء يكمّل
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
work/NNN-slug/
  NNN-slug-story.md                Draft → Approved                 approve story
  NNN-slug-implementation-plan.md  Draft → Approved → In progress → Completed   approve plan; item set; item finish
  NNN-slug-build-spec.md           tests, code, commands بالضبط     تعتمد مع plan
  NNN-slug-verify.jsonl            كل تشغيل إثبات: command وexit code ووقت   verify
  reviews/                         reports للـ review وverification وQC، كل واحدة فيها findings table   review add; finding add
  sources/                         الأصلي اللي إنت اديته للـ agent؛ مابيتعدلش
  repro/                           scripts وlogs بتوع الـ agent
  NNN-slug-state-notes.md          النص الكامل لسطور الـ state اللي state compact قصّرها (لو اتستخدم)
  NNN-slug-already-satisfied.md    سببك المكتوب، لو الكود كان محقق الـ story أصلًا (لو اتستخدم)
.burhan/local/PROGRESS.md          block حالة حالي لكل task
```

كل sub-unit بتمشي **Draft → Approved → In progress → Implemented → Reviewed**. `item set` بيسمح بدرجة واحدة كل مرة. لازم section review قبل `Reviewed`.

الـ plan ملفين: القرارات (ومعاها coverage لمعايير القبول وrulings) وbuild spec. الـ spec بتدي لكل sub-unit الملفات وtest وcode كاملين وأوامر RED وGREEN والـ expected output والـ interfaces. الـ sub-unit بتبقى خطوة لوحدها بس لسبب: بتلمس مسار حساس، أو بتكتب قرارك أو gate، أو سلوكها محتاج failing test لوحده. `item check` بيبلّغ عن sub-unit من غير سبب، وعن plan فيها أكتر من ست sub-units ومش قايلة ليه.

نفّذ الـ spec بالضبط. لو RED ما فشلش زي المتوقع، أو GREEN فشل، أو ملف مختلف، الـ agent الأول بيسأل نفسه: القرار محتاج ولا لأ. لو مش محتاج (كلام الـ spec مش مطابق للكود، أو review finding جوه المهمة وإصلاحها بيحافظ على الـ story)، بيصلّح المشكلة وبيسجّلها بـ `deviation add … --apply` وسبب مكتوب، والبناء يكمّل؛ و`guide` و`item finish` بيعرضوا لك كل صف من دول. أما تغيير النية المعتمدة أو الـ scope، أو اختيار حقيقي، أو security أو data أو فلوس، أو حاجة مش بترجع، أو تعديل test قديم، فمحتاج قرارك: الـ agent بيسجّل صف `deviation add` مفتوح وبيسألك، و`guide` بيقول إن تعديل الكود غير مسموح لحد ما تقرر بـ `deviation resolve`، والـ deviation المعتمدة بتحدّث الـ plan والـ spec الأول، وبعدين الكود. أول ما التغيير المعتمد يتنفّذ، `deviation done` بيكتب أنهي sub-unit نفّذته، و`item finish` بيرفض صف معتمد من غير الأثر ده.

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
| ‏finding في review أو QC | `finding decide` بيسجل ردك: اتصلّحت، أو discovery، أو مقبولة بسببك (عمرها ما تتقبل لو Critical)؛ و`item finish` و`approve qc` بيستنوا كل قرار |
| ‏deviation أو discovery | مشكلة محتاجة قرارك بتوقّف الشغل؛ ومشكلة حلها معروف بتتصلّح وتتعرض عليك؛ وfinding منفصلة ماتتصلحش في السر |
| قفل task الكود محققها أصلًا | `item close` مع `--already-satisfied` وسبب مكتوب واسمك؛ واسم agent بيترفض |
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

الـ review أو report الـ QC بتخلص بجدول findings: `finding add` بيكتب صف، أو سطر `No findings.`. كل صف بيستنى قرارك (شوف إيه اللي إنت بس بتقرره). ‏QC بتقترح `PASS` أو `FAIL — N issues`، ومعاها findings Critical أو Important أو Minor. PASS دليل مش ضمان. FAIL بترجع المهمة للـ build؛ QC الجاية تأكد الإصلاح أو توسع المراجعة.

## الإثبات

الـ hooks بتبلّغ وبتفشل open؛ عمرها ما بتمنع. task commands بترفض خطوة lifecycle غلط، لكن الـ agent يقدر يتخطاهم.
البلوك اللي بيكتبه `burhan init` في `CLAUDE.md` و`AGENTS.md` بيطلب من الـ agent يشغّل `burhan guide` قبل أي تعديل ويمشي على ردّه، والـ `guide` بيرد حتى لو مفيش item. ده تعليمة مش قفل: التعديل المباشر وكتابة الـ shell وهوية اللي وافق مش بتتمنع. `burhan verify <slug> -- <command>` بيشغّل أمر الإثبات بنفسه ويسجّل الـ exit code وحالة الكود اللي اشتغل عليها، و`item finish` بيقبل السجل ده، فالمشروع اللي من غير hooks بياخد إثبات مسجّل، أو يذكر إثبات بـ `--evidence`. السجل بيقول إن الأمر اشتغل وخلص إزاي، مش إنه بيختبر الحاجة الصح. `verify` بيرفض item ماوصلتش للـ build: لسه مفيش حاجة اتبنت، فأي إثبات دلوقتي مايثبتش حاجة، ومفيش حاجة بتتسجّل.

| اللحظة | Hook | الوظيفة |
| --- | --- | --- |
| بداية session | `session-gates` | ‏gates وحالة المهمة وأول setup والمهام المفتوحة وغياب الـ kit command |
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

الـ ledger برا المشروع في `~/.local/state/burhan/evidence/`. بتسجل reported edits وcommand lines وexit codes والترتيب وربط المهمة؛ مش command output. بتتكتب لما الـ turn بيخلص، فخطوات الـ turn الحالي لسه مش فيها. `evidence --item <slug>` بيعرضها.

‏whole-suite run ناجح بعد آخر code edit يقدر يكفي verification وQC وcommit. استخدمه تاني لحد ما code أو tests تتغير. `guide` بيعرض حالة `full run:`.

## مرجع

ارجع هنا للبحث؛ مش محتاجه في أول مهمة ليك.

### الإعدادات

‏`WF_CHECK_CMD` هو fast pre-commit check. `WF_CODE_REGEX` و`WF_TEST_REGEX` بيحددوا code وtests. `WF_EVIDENCE_REGEX` بيقول أي commands تعتبر proof. `WF_FULL_TEST_REGEX` بيحدد whole suite. `WF_SENSITIVE_REGEX` و`WF_SENSITIVE_NOTE` بيضيفوا تذكير للمسار الحساس. لو code أو proof patterns فاضيين، تحذير “done” مش هيشتغل. المشروع اللي اتعمل بـ `burhan init` فيه task-file checks شغالة (`WF_ITEM_CONTRACT=on`). `burhan setup --set` بيحفظ الـ check وإعدادات code وtests وproof وwhole-suite والمسار الحساس من غير تعديل يدوي.

`WF_STACK_SETUP` بيقول لو أول setup لسه مستني. `WF_MODE_DEFAULT` هو `step` أو `auto`؛ ومفتاح زي `WF_MODE_BUG_BOUNDED=auto` بيظبط route واحدة. `WF_MODEL_CLAUDE_PLANNER` و`WF_MODEL_CLAUDE_BUILDER` و`WF_MODEL_CLAUDE_EXPLORER` و`WF_MODEL_CLAUDE_REVIEWER` بيختاروا model لكل role في Claude Code؛ ولو فاضيين بيفضل model الـ session. `WF_REVIEWER_AGENT` بيقول مين بيشغّل QC. `WF_EVIDENCE_LEDGER` و`WF_EVIDENCE_DIR` بيشغّلوا الـ ledger ويحرّكوه. [Configuration](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md#workflowconfig) فيه كل المفاتيح.

### الأوامر

كل command ليه `--help` (`burhan item --help` و`burhan finding add --help`)؛ بيطبع طريقة الاستخدام بس. في الجدول، `<slug>` هو الاسم المختصر للمهمة أو رقمها أو اسم الفولدر الكامل.

| إنت بتعمل إيه | الأوامر |
| --- | --- |
| ابدأ ودوّر على طريقك | `item new` بينشئ files على شكل route وblock المهمة في الـ state file بتاعك؛ `guide` بيقول المرحلة، وتعديل الكود مسموح ولا لأ، والـ skill اللي تتشغّل، والخطوة الجاية؛ `use <slug>` بيربط session بمهمة؛ `item list` بيطبع سطر لكل مهمة (id وroute وstate) ومابيكتبش حاجة |
| قرر (بتاعك) | `approve` بيسجل موافقتك على story أو plan أو QC؛ `finding decide` و`finding discover` بيردوا على الـ findings؛ `deviation resolve` بيحسم deviation مفتوحة؛ `item close <slug> --already-satisfied` بيقفل مهمة الكود محققها أصلًا؛ وكلهم بياخدوا اسمك بـ `--by` وبيرفضوا اسم agent |
| سجّل الشغل | `item set` بينقل status مسموح؛ `gate tick` بيعلّم gate لما دليلها يبقى موجود؛ `review add` بيكتب review أو QC أو verification مع reviewer provenance؛ `finding add` و`finding list`؛ `deviation add` (مع `--apply` لمشكلة مش محتاجة قرار) و`deviation done`؛ `verify <slug> -- <command>`؛ `item finish` يحتاج units Reviewed وgates معلّمة ومن غير deviation مفتوحة وproof حديث؛ `item check` بيسمّي كل مشكلة في task files |
| الـ state file بتاعك | `state show` بيطبع block مهمتك؛ و`state set` و`state close` بيغيّروا بس الـ block ده، تحت lock؛ `state compact` بيقصّر سطور المهام المقفولة (dry run لحد `--apply`) |
| تقارير read-only | `status` (ومعاه `--write` بيكتب فهرس المهام) و`stats` و`evidence` و`changed` و`pr-body` و`memory` و`inspect` و`doctor` |
| التسطيب | `init` و`upgrade` و`uninstall` (dry runs لحد `--apply`)؛ و`setup` مع `--stack` أو `--set` أو `--agent` أو `--answers` |

الـ agent بيغيّر block بتاعه في الـ state file بس عن طريق `burhan state`؛ والتعديل اليدوي لسه ممكن ومفيش حاجة بتمنعه. في `status`، المهمة القديمة اللي خلصت من غير سطر route ولا ملف QC بتظهر `Legacy` ومطوية في block واحد معدود. الـ agent بيشغّلهم كـ `npx burhan-kit` وبعده الـ command؛ وإنت تقدر كمان. كل command ما عدا `init` بيلاقي المشروع من أي مجلد فرعي زي git: بيطلع لأقرب مجلد فيه `.burhan/WORKFLOW.md` وبيكتب اسمه على stderr.

### ذاكرة المشروع

‏Onboarding بيمسح المشروع ويعمل draft لـ `.burhan/PROJECT.md` وfact files في `.burhan/context/`. إنت توافق أو تصحح أو تعمل waive للـ baseline. كل fact فيها path وshort hash، مش محتوى الملف. `memory status` يقول fresh أو changed أو missing أو unchecked؛ و`memory check` ينفع للـ CI؛ و`memory affected` بيسمّي الـ facts اللي ملفاتها اتغيّرت من git ref. knowledge review بتقترح دروس ثابتة عشان تقرر فيها.

### بين Claude Code وCodex

‏Claude Code بيستخدم `/burhan:e2e` و`/burhan:qc` و`/burhan:onboard`؛ Codex بيتبع command files المثبتة من خلال `AGENTS.md`. نتائج Codex hooks محتاجة trust. command من غير نتيجة مسجلة مش passing.

‏burhan جاي بستة process skills وبيسطّبهم مع الـ kit، فمفيش حاجة تضيفها من برا. كل واحدة checklist قصيرة الـ agent بيفتحها في أول phase، قبل ما يتصرف؛ والقواعد بتفضل في ملفات الـ phase.

| Skill | الـ agent بيفتحها | وظيفتها |
| --- | --- | --- |
| `burhan-story` | طلب بيضيف أو يغيّر سلوك، قبل الـ story | جولة أسئلة واحدة، والـ route، وstory تقدر توافق عليها في قراءة واحدة |
| `burhan-plan` | الـ story اتعتمدت، قبل الـ plan والـ build spec | plan الـ builder يمشي عليها كلمة كلمة، في أقل عدد sub-units |
| `burhan-build` | قبل كود sub-unit | الـ test الأول ومتشاف بيفشل |
| `burhan-debug` | bug أو test بيفشل أو QC فشلت | دوّر على الـ root cause قبل أي إصلاح |
| `burhan-review` | sub-unit اتنفّذت | راجع الـ diff وسجّل الـ findings |
| `burhan-done` | قبل ما تقول done أو fixed أو passing | مفيش claim من غير command اتشغّل دلوقتي |

بتنزل في `.burhan/skills/` للـ agent-ين وفي Claude Code كمان كنسخ managed في `.claude/skills/`؛ وCodex بيقرا الملف اللي في `.burhan/skills/` لما الـ phase تبدأ. وskill بتاعتك بنفس الاسم عمرها ما بتتكتب فوقها، و`uninstall` بيمسح بس اللي burhan كتبه. الـ skill المتخطية بتتبلّغ في آخر الـ turn ومابتمنعش.

Claude Code يقدر يولّد roles planner وbuilder وexplorer وreviewer على models متظبطة. Codex بيستخدم model config بتاعتك؛ burhan ما بيكتبهاش.

‏sessions كتير تقدر تشتغل على tasks منفصلة. خليك task واحدة لكل session. الإعدادات والـ memory وtask folders المشتركة يعدوا على review؛ `.burhan/local/` شخصية.

### الأمان والرجوع

‏`init` و`upgrade` و`uninstall` dry runs لحد `--apply`. setup بتتحقق قبل أول write. upgrade بتجدّد kit files وبتدمج exact hook entries من غير ما تكتب فوق `workflow.config` أو `bindings.md`. write من خلال link خارج المشروع بيتمنع إلا لو إنت سمحت.

‏uninstall بيمسح kit folders كاملة تحت `.burhan/`: `WORKFLOW.md` و`SETUP.md` و`VERSION` و`phases` و`templates` و`commands` و`skills` و`hooks`. وتحت `.claude/` بيمسح بس الملفات اللي عليها علامة burhan: نسخ الـ skills والـ commands والـ agents اللي burhan كتبها؛ وملف بتاعك عمره ما بيتمسح. بيسيب `workflow.config` و`bindings.md` و`.burhan/local/` وtask files إلا مع `--all`. الـ `--all` بتمسح `work/` و`discovery/` الخاصين؛ وtask folder مشترك وجّهت `WF_DOCS_DIR` ليه عمره ما بيتمسح.

### الحدود

- ‏Hooks عمرها ما بتمنع؛ task commands بترفض خطوة غلط؛ والـ agent يقدر يتخطى الاتنين.
- ‏قايمة البداية في ملف الـ agent تعليمة؛ مفيش حاجة بتمنع agent بيتجاهلها.
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
