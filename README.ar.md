# برهان (Burhan)

الـ AI coding agents بتقول “done” من غير دليل. burhan بيحط جوّه مشروعك اتفاق شغل مكتوب وhooks، وبيطلب من الـ agent يتفق معاك على الشغل الأول، ويبني خطوات بتتعمل لها review، ويورّيك إيه اللي شغّله فعلًا. لـ Claude Code وCodex: `npx burhan-kit`.

- **اتفق الأول:** الـ story والخطة محتاجين موافقتك قبل أي كود.
- **الدليل:** التعديلات والأوامر بتتسجل؛ و“done” من غير check ناجح بياخد تحذير.
- **إنت اللي بتعمل commit:** قبل كل commit بتختار: دلوقتي، أو بعدين، أو بنفسك.

[English](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/README.md)

## الـ flow في لمحة

```text
 1. Intake     the agent restates your request and picks a route: type + scope + a one-line reason
 2. Story      what and why, with acceptance criteria         <- you approve
 3. Plan       how, in small steps called sub-units           <- you approve
 4. Build      one sub-unit at a time, test first             <- `step` mode pauses here
 5. Review     a fresh reviewer checks that sub-unit          (repeat 4 and 5 per sub-unit)
 6. Verify     a real end-to-end check                        <- asks: you or the agent?
 7. QC         the final independent check, on the routes that need it   <- you accept the verdict
 8. Knowledge  lessons worth keeping                          <- you promote or reject them
 9. Commit     you choose: now, later, or yourself            <- always stops
```

كل طلب بيتصنّف الأول: type + scope + a one-line reason. ده الـ **route** بتاعه: الـ agent بيعلنه في الأول وتقدر تغيّره، وهو اللي بيحدد الخطوات اللي بعده، فالـ feature والـ bug مش بيمشوا في نفس المسار. النوع `feature` أو `bug` أو `change` (تغيير في سلوك موجود) أو `refactor` أو `release` أو `investigation`. الـ scope يا `bounded` (محلي ومفهوم كويس)، يا `architectural` (بيمس أكتر من جزء في المشروع، أو بيلمس الأمان أو الداتا أو الفلوس أو واجهة غيرك معتمد عليها)، يا `patch` (تعديل واحد واضح). وفي الشغل الـ bounded الـ story والخطة موافقة واحدة.

| بتطلب | بيتصنّف | المسار |
| --- | --- | --- |
| feature جديد | feature / bounded | story + plan (موافقة واحدة) → build → review → verify → QC → knowledge |
| bug | bug / bounded | story + plan (موافقة واحدة؛ الـ story فيها الـ root cause بدليل قبل أي إصلاح) → build (بيبدأ بـ failing regression test) → review → verify → knowledge؛ من غير QC |
| typo | change / patch | التعديل، وcheck ناجح بيتشغّل بعده، والـ commit؛ من غير story ولا خطة |
| feature أو bug أو change بيلمس، مثلًا، الأمان أو الصلاحيات أو الـ data model أو الفلوس أو public API | architectural | story وخطة كموافقتين → build → review → verify → QC → knowledge |
| سؤال محتاج تحقيق | investigation | للقراءة بس: findings من غير كود |

الـ **story** هي إيه وليه مع شروط القبول؛ والـ **plan** هي إزاي على خطوات صغيرة. الـ **gate** نقطة الـ agent بيقف فيها عندك (كل سهم `<-` فوق، وبعد كل sub-unit في مود `step`)؛ والـ **QC** هو الفحص الأخير بواسطة reviewer جديد ومستقل. الـ refactor والـ release ليهم مسارات أقصر ([الجدول الكامل](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/features.md#agree-before-you-build)).

الـ route هو اللي بيحدد كام موافقة في المهمة؛ والمود بيحدد بس هل الـ build بيقف بين الـ sub-units. لمهمة فيها 3 sub-units:

| مهمة فيها 3 sub-units | `step` (الافتراضي) | `auto` |
| --- | --- | --- |
| story + plan | بتوافق | بتوافق، مرة واحدة |
| build + review لكل sub-unit | بيقف بعد كل واحد من التلاتة | بيكمّل لحد الآخر |
| verify | بيسأل إنت اللي تشغّله ولا هو | بيسأل مرة واحدة في البداية |
| verdict الـ QC (على الـ routes اللي فيها QC) | إنت بتقبله | إنت بتقبله |
| commit | إنت بتختار | إنت بتختار |

في `auto` الـ agent بيرجع يسألك عند **brake**: scope escalator (المهمة طلعت بتلمس الأمان أو الداتا أو الفلوس أو واجهة غيرك معتمد عليها)، أو discovery (حاجة اتلقت والمهمة ما طلبتهاش)، أو تغيير في الخطة، أو نفس الاختبار بيفشل مرتين، أو إجراء irreversible. الـ commit بيقف دايمًا في المودين. بدّل المود في أي وقت بكلام عادي (“go end to end” أو “wait for my approval”)؛ و“plan only” بيقف أول ما الخطة تتوافق عليها ومش بيكتب كود.

## شوفه شغّال

مقتطف من run حقيقي (Claude Code، مهمة من function واحدة، مختصر بـ `…`؛ والـ walkthrough الكامل في [docs/first-task.md](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/first-task.md)):

```text
you    /burhan:e2e slugify — add a function slugify(text) in src/slugify.js … with a test
agent  burhan needs one thing before it can check your work: …
         Check before commit   `npm test` (runs `node --test` …) …
       ● Use these   ○ Change something
you    Use these.
agent  **Route:** feature / bounded. It's one pure function with no scope escalator, so it gets one combined story and plan gate. …
       **Waiting on you:** reply "approved" to approve both the story and the plan … I won't write code before then.
```

الـ block بتاع `Check before commit` فوق طلع في run بدأ بـ `/burhan:e2e`؛ وبعد خطوات التثبيت اللي تحت، تنبيه بداية الـ session بيطلبه من الـ agent في أول جلسة (الخطوة 3)، طول ما الـ checks لسه مش متظبطة.

الـ **hook** سكريبت صغير الـ agent بيشغّله في لحظات محددة (بداية الـ session، رسالتك، قبل الـ commit، بعد تعديل، نهاية الـ turn). في run تاني الـ agent عدّل ملف، ما قدرش يشغّل الـ check، وقال “Done.” الـ hook اللي في نهاية الـ turn رد، والـ agent سحب كلامه. والـ **ledger** هو السجل الخاص بكل تعديل وأمر؛ و`npx burhan-kit evidence` بيطبعه، وهنا `npm test` بتاع الـ run ده — اترفض من الـ permission prompt بتاع الـ agent نفسه، مش من burhan — متعلّم `blocked`:

```text
⚠ VERIFICATION GATE: completion was claimed, but the last run of `npm test 2>&1 | tail -15` was blocked and never ran. Run it, show the output — or retract the claim.
2026-10-22T09:29:59Z  claude  …/… #2  cmd  exit ?  blocked  npm test 2>&1 | tail -15  (pipeline: exit is the last command's)  [slugify]
```

## هتاخد إيه

**[اتفق قبل ما تبني](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/features.md#agree-before-you-build)**
- الـ agent بيعمل route لكل طلب الأول، فالـ typo مش بياخد إجراءات تقيلة، وتغيير الصلاحيات عمره ما يتحسب “صغير”.
- الـ agent بيطلب موافقتك على الـ story والخطة قبل الكود؛ ومود `step` أو `auto` بيحدد بيقف فين تاني.
- قبل كل commit بيشغّل الـ check بتاعك وبيطلب منك تختار: دلوقتي، أو بعدين، أو بنفسك.

**[أثبت اللي اتعمل](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/features.md#prove-what-was-done)**
- “done” من غير check ناجح بعد آخر تعديل في الكود بياخد تحذير (الـ check اتشغّل قبله، أو فشل، أو ما اتشغّلش)، بعد ما مشروعك يحدد إيه الكود وإيه الـ check.
- الـ ledger بيسرد كل تعديل وأمر، مع exit code على Claude Code، برّه مشروعك.
- reviewer جديد (subagent في Claude Code، أو الـ agent التاني لو اخترت كده: Claude بيبني وCodex بيراجع، أو العكس) بيراجع كل خطوة والشغل اللي خلص، وكل review بيسجل مين عمله.
- التقارير بتتبني من السجلات: وصف pull request للمهمة، وكام QC كان مستقل، والـ escaped defects.

**[الذاكرة والفريق](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/features.md#memory-and-team)**
- الـ agent بيفهم مشروعك مرة واحدة وبيوريك فهم إيه؛ كل fact بيقول جه من أنهي ملف، و`memory status` بيكشف الـ facts اللي الملف اللي بتستند عليه اتغيّر. الفهم والإعدادات بتتشارك عن طريق git، وكمان ملفات المهام لو اخترت الفولدر المشترك؛ وحالتك الشخصية بتفضل عندك.

**[بيشتغل فين](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/features.md#where-it-runs)**
- Claude Code وCodex، وبيسيب الـ hooks اللي عندك؛ و`doctor` بيفحص الإعداد، وتوثيق Codex كمان.
- آمن تجرّبه: `init` و`upgrade` و`uninstall` كلهم dry run لحد `--apply`؛ و`init` و`upgrade` عمرهم ما بيكتبوا فوق `workflow.config` بتاعك؛ والـ `uninstall` بيشيل بس اللي burhan كتبه وبيسيب `workflow.config` و`bindings.md` إلا لو ضفت `--all`.

## التثبيت في 3 خطوات

**أستخدم أنهي جزء؟**

| عايز… | استخدم |
|---|---|
| تكتب الأوامر بنفسك في terminal | الجزء 1 |
| تنسخ برومت والـ agent يشغّل الـ setup | الجزء 2 |

**الجزء 1 — تثبيت يدوي (إنت اللي بتكتب الأوامر)**

### الخطوة 1 — Superpowers (موصى بيه)

Superpowers اختياري، لكن موصى به بقوة: burhan مش بيسطّبه خالص. لو موجود، burhan بيستخدم الـ skills بتاعته في كل مرحلة (brainstorming قبل الـ story، وTDD وإنت بتبني، وتأكيد قبل “done”). عايز تجرّب burhan الأول؟ ابدأ من الخطوة 2.

Claude Code — اكتب ده جوّه Claude Code:

```text
/plugin install superpowers@claude-plugins-official
```

Codex — لو لسه مش متسطّب: شغّل `/plugins`، دوّر على `superpowers`، واختار Install Plugin.

المفروض تشوف: في ملخص الخطوة 2 جملة “Superpowers found” (Claude Code بس؛ الـ setup مش بيدوّر في Codex).

### الخطوة 2 — جهّز burhan

في مشروعك، بـ Node 22 أو أحدث، شغّل الأمر ده في terminal. هيسألك أربع أسئلة (خمسة لو بتستخدم الـ agents الاتنين): أنهي agents، والـ agent يرجعلك إمتى، وملفات المهام تتحفظ فين، والملاحظات الجانبية (discoveries) تتحفظ فين، ولو بتستخدم الـ agents الاتنين ومين يراجع. وبيوريك ملخص ومش بيكتب حاجة قبل ما تأكد. الـ setup بيضيف hooks لإعدادات الـ agent وبيسيب اللي عندك.

```bash
npx burhan-kit
```

وبعدين اتأكد من الـ setup:

```bash
npx burhan-kit doctor
```

Codex بس — وثّق hooks بتاعت burhan في `/hooks` وإلا مش هتشتغل ([الخطوات](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md#codex-trust-the-hooks))؛ و`doctor` بيحذّرك لو مش موثّقة.

المفروض تشوف: قايمة الملفات اللي اتعملت، و`npx burhan-kit doctor` بيطبع آخر سطر فيه بيبدأ بـ `0 fail`.

### الخطوة 3 — خلّي الـ agent يفهم مشروعك

مرة واحدة، افتح جلسة agent جديدة (الـ **session** يعني محادثة واحدة مع الـ agent) في المشروع واكتب أي رسالة، مثلًا `ابدأ`.

تنبيهات burhan بتقول للـ agent يظبط الأول أمر الفحص بتاع مشروعك لو لسه مش متظبط (بتوافق عليه مرة واحدة). وبعدين الـ agent يقرا المشروع كله، ويوريك مسودة وإيه اللي ما قدرش يفحصه، ومش بيحفظها غير بعد موافقتك: الـ **baseline** بتاعك.

ولو الـ agent رد بتحية بس، أو عايز تروح للفهم على طول، اكتب الأمر ده بدل الرسالة. Claude Code:

```text
/burhan:onboard
```

Codex:

```text
Follow .burhan/commands/onboard.md
```

شغّله مرة واحدة: الفهم المعتمد مش بيتكرر، والمسودة بتتكمّل.

المفروض تشوف: مسودة بتقول المشروع ده إيه وبيعمل إيه، والأسئلة اللي الـ agent معرفش يجاوبها. مفيش حاجة بتتحفظ قبل ما تقرر.

**الجزء 2 — التثبيت عن طريق الـ agent (إنت بتنسخ والـ agent بينفّذ)**

انسخ ده للـ agent بتاعك، في مشروعك.

```text
شغّل `npx burhan-kit setup --agent` وامشي على اللي بيطبعه. اسألني الأسئلة اللي بيدّيهالك، سؤال سؤال، وبعدين وريني الملخص. متطبّقش حاجة غير بعد موافقتي.
```

ولما الـ setup يخلص: لو بتستخدم Codex، وثّق hooks بتاعت burhan الأول في `/hooks` (زي الخطوة 2). وبعدين انسخ ده في جلسة agent جديدة في المشروع، أو اكتب أي رسالة هناك وخلاص:

```text
اظبط أمر الفحص بتاع المشروع ده لو لسه مش متظبط، وبعدين اتبع `.burhan/commands/onboard.md`: وريني المسودة وإيه اللي ما قدرتش تفحصه، ومتحفظش حاجة غير بعد موافقتي.
```

## أول مهمة ليك

ابدأ تغيير صغير بـ `/burhan:e2e <slug>` (عنوان قصير يكفي). لو checks المشروع لسه مش متظبطة، الـ agent بيجهّزها الأول (block واحد بتوافق عليه). وبعدين بيكتب story وخطة ويقف عند “approved” بتاعك. بترد على أسئلته القليلة، وهو بيبني test-first، وreviewer جديد بيراجع الشغل، وبيسألك قبل ما يعمل commit. ولو عندك أكتر من مهمة مفتوحة، `npx burhan-kit use <slug>` بيربط الـ session بواحدة. الـ run المسجّل كله، كل رسالة وكل تحذير، في [docs/first-task.md](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/first-task.md).

## الفرق والذاكرة

- بيتعملها commit ومراجعة زي الكود: `.burhan/PROJECT.md` و`.burhan/context/` و`.burhan/bindings.md` (أوامر مشروعك وفولدراته) و`.burhan/workflow.config` وفولدر كل مهمة. بتاعك إنت بس، وgit بيتجاهله: `.burhan/local/`.
- لو اتنين ضافوا facts لنفس الـ area ممكن يحصل conflict نصي: سيب كل row؛ و`npx burhan-kit memory check` بيكشف الـ IDs المكررة. متستخدمش `merge=union` على الملفات دي.
- الـ evidence ledger مخزّن برّه المشروع (`~/.local/state/burhan/evidence/`): أوامر وexit codes بس، ومش الـ output بتاعها أبدًا. وتقدر تمسحه وقت ما تحب.

## الحدود

- burhan بيبلّغ ويوجّه ومبيمنعش. الموافقات والـ test-first قواعد الـ agent مطلوب منه يمشي عليها.
- بيشوف بس التعديلات والأوامر اللي الـ agent بيبلّغ بيها؛ وتعديل الـ shell بيظهر بس من خلال `>` و`>>` و`tee`.
- تحذير “done” محتاج `WF_CODE_REGEX` و`WF_EVIDENCE_REGEX` (إعدادات في `.burhan/workflow.config`)؛ الـ agent بيقترحهم أول استخدام، وبعد ما أول استخدام يخلص `doctor` بيحذّر لو الـ code pattern فاضي.
- Codex بيشغّل hooks المشروع بعد ما توثّقها في `/hooks` بس، ومبيقولش حاجة لو مش موثّقة. وعلى Codex ممكن الأمر اللي خلص يبقى من غير exit code متسجّل، وده بيتحسب دليل ناجح ([فجوة معروفة](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/ROADMAP.md)).
- Windows: الـ hooks بتشتغل على Node والـ CI بيغطي `windows-latest`. لسه مش متحقق منه: Windows بـ PowerShell بس، وجلسة Claude Code أو Codex حقيقية على Windows.

## الأوامر واللينكات

| الأمر | بيعمل إيه |
| --- | --- |
| `npx burhan-kit` · `npx burhan-kit setup --agent` | إعداد موجّه (مش بيكتب حاجة قبل ما تأكد) · الأسئلة اللي الـ agent هيسألها |
| `npx burhan-kit doctor` | فحص صحة للقراءة بس |
| `npx burhan-kit status` · `npx burhan-kit evidence --item <slug>` | فهرس المهام · الـ ledger بتاع مهمة |
| `npx burhan-kit memory check` · `npx burhan-kit inspect` | فحص ذاكرة المشروع (للـ CI كمان) · نظرة بالأسماء بس على المشروع |
| `npx burhan-kit use <slug>` | بيتحقق من المهمة؛ والـ session بتتربط لما الـ turn يخلص |
| `npx burhan-kit upgrade` · `npx burhan-kit uninstall` | تحديث · إزالة (dry run لحد `--apply`) |

[الإعدادات](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md) · [المميزات بالتفصيل](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/features.md) · [أول مهمة، مسجّلة](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/first-task.md) · [الترقية والرجوع](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/upgrading.md) · [الـ CI وWindows](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/ci-and-windows.md) · [Changelog](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/CHANGELOG.md) · [Roadmap](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/ROADMAP.md) · [Issues](https://github.com/ahmedkamaldabour/burhan-kit/issues)

## الرخصة

MIT. شوف [LICENSE](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/LICENSE).
