# برهان (burhan)

مفيش “done” من غير دليل: اتفقوا على الشغل الأول، ابنوا خطوة بخطوة مع مراجعة، وورّوا إيه اللي اتشغّل.

- اتفاق شغل وhooks جوّه المشروع لـ Claude Code وCodex.
- موافقة الـ story والخطة، والمراجعة، والتأكد يفضلوا واضحين بدل ما يبقوا وعود في الشات.
- Evidence ledger بيسجل التعديلات والأوامر، فادعاء إن الشغل خلص يبقى وراه دليل.

[English](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/README.md)

## burhan بيوقف إيه؟

- الـ agent يقول “done” بعد تعديل من غير ما يشغّل check. → الـ hook بيقول: “code changed and completion was claimed, but no verification command ran this turn.”
- الـ agent يبدأ يكتب كود من غير الموافقة المطلوبة. → البوابة المشتركة بتقول: “no code before the approved story/plan the route requires.”
- مهمتين شغالين، وجلسة واحدة. → شغّل `burhan use <slug>` علشان الـ turn يرتبط بالمهمة الصح.
- commit هيحصل. → burhan بيسألك تختار: تعمل commit دلوقتي، أو تكمل وتعمله بعدين، أو تعمله بنفسك.

## التثبيت / ابدأ بسرعة

أول تشغيل تلات خطوات، بالترتيب ده.

### الخطوة 1 — Superpowers الأول

Superpowers موصى به بقوة، وهو اختياري: burhan مش بيسطّبه خالص. لو موجود، burhan بيستخدم الـ skills بتاعته في كل مرحلة (brainstorming قبل الـ story، و TDD وإنت بتكتب الكود، وتأكيد قبل ما يقول "خلصت").

- Claude Code: `/plugin install superpowers@claude-plugins-official`
- Codex — لو لسه مش متسطّب: في Codex CLI شغّل `/plugins`، دوّر على `superpowers`، واختار Install Plugin.

### الخطوة 2 — جهّز burhan

1. استخدم Node 22 أو أحدث جوّه الـ repository اللي عايز تجهزه. الـ hooks مش محتاجة أي حاجة تانية: لا bash ولا jq.
2. شغّل:

```bash
npx burhan-kit
```

3. جاوب التلات أسئلة (أربعة لو بتستخدم الـ agents الاتنين):
   - بتستخدم أنهي أدوات AI للبرمجة؟
   - الـ agent يرجعلك إمتى؟
   - burhan يحفظ الـ story والخطة والـ reviews بتاعة كل مهمة فين؟ الإجابة المقترحة هي “في git للفريق — docs/burhan/work/”.
   - لو بتستخدم الـ agents الاتنين: مين يراجع الشغل ويعمل الـ QC بشكل مستقل؟ الإجابة المقترحة هي الـ agent التاني.
4. راجع التغييرات المقترحة ووافق عليها؛ مفيش حاجة بتتكتب قبل موافقتك.
5. اتأكد إنه اشتغل: ملخص الـ setup بيعرض ملفات `.burhan/` المُدارة؛ وبعدها شغّل `npx burhan-kit doctor`. الـ project checks بيقترحها الـ agent أول استخدام، وبعدها أنت بتوافق عليها.

ولو الـ agent هو اللي هيجهز المشروع، قوله يشغّل `npx burhan-kit setup --agent` ويمشي على الإرشادات اللي بتظهر له. لو لقيت دليل في المشروع بيحدد فولدر للـ stories أو الـ specs، يقدر يعرضه من غير ما يخمّن أو يختاره لوحده.

### الخطوة 3 — فهم المشروع

مرة واحدة، بعد الـ setup: افتح جلسة agent جديدة جوّه المشروع، وبعدين:

- Claude Code — اكتب: `/burhan:onboard`
- Codex — قول: `اتبع .burhan/commands/onboard.md`

الـ agent بيقرا المشروع كله، ويوريك مسودة وإيه اللي ما قدرش يفحصه، ومش بيحفظها في الريبو غير بعد موافقتك. شغّله مرة واحدة: الفهم المعتمد مش بيتكرر، والمسودة بتتكمّل.

## إيه اللي بيحصل في أول مهمة؟

الـ setup بيحط اتفاق الشغل والإعدادات والـ hooks المُدارة بتاعة burhan في `.burhan/`. الـ hooks الموجودة بتفضل شغالة: بتشتغل جنب hooks بتاعة burhan، فممكن التنبيهات تتكرر.

ابدأ مهمة مع الـ agent. كل مهمة ليها story وخطة وreviews في المكان اللي اخترته. شغّل `burhan use <slug>` علشان تربط الـ session الحالية بالمهمة دي—وده مفيد خصوصاً لما أكتر من مهمة تكون شغالة.

**مثال حقيقي لأول مهمة:** agent عدّل `src/add.js`، وما شغّلش check، وقال “Done”.

```text
⚠ VERIFICATION GATE: code changed and completion was claimed, but no verification
command ran this turn. Run the checks now and show the real output, or explicitly
retract the claim.
```

## بيشتغل إزاي

burhan بيجمع اتفاق جوّه المشروع، وhooks بتفكّر الـ agent بيه، وevidence ledger. مسار الشغل بيبدأ من الهدف: نتفق على الـ story والخطة، نبني جزء واحد مع مراجعة في كل مرة، وبعدين نعرض إيه اللي اتراجع فعلاً.

### مسار الشغل الأساسي

1. اتفقوا على الـ story والخطة؛ burhan بيقف لما وضع الشغل اللي اخترته يحتاج موافقتك.
2. ابنوا جزء واحد في كل مرة مع مراجعة.
3. راجع الدليل، وبعدها اختار تعمل commit دلوقتي، أو بعدين، أو بنفسك.

| هتاخد إيه | ليه يهمك |
| --- | --- |
| بوابات موافقة | الـ agent بيستنى موافقة الـ story والخطة اللي المسار بتاعه محتاجها. |
| Hooks وledger | التعديلات والأوامر والـ exit code بتاعهم ليهم سجل دائم. |
| نقاط مراجعة | مراجعة منفصلة ممكن تلاقي حاجة اللي بنى الشغل فاتته. |
| روابط الـ sessions | `burhan use <slug>` بيربط الـ session بالمهمة النشطة الصح. |

## الإعدادات

`.burhan/` مُدار من burhan. الـ setup بيعرض التغييرات المقترحة وبيسأل قبل ما يكتب؛ وبعد كده استخدم `npx burhan-kit setup` علشان تغيّر اختياراتك. شوف [مرجع الإعدادات](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md) لكل الإعدادات، ومنها [الثقة في hooks بتاعة Codex](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md#codex-trust-the-hooks).

## Scripts و CI

للـ automation مش للتثبيت أول مرة:

```bash
npx burhan-kit@latest init --agents claude,codex
npx burhan-kit upgrade --apply
npx burhan-kit doctor
```

`init` و`upgrade` بيعرضوا خطتهم قبل الكتابة إلا لو ضفت `--apply`؛ و`doctor` للقراءة بس.

## الترقية من 0.2.2

`npx burhan-kit upgrade --apply` بيبدّل hooks الـ bash بتاعة 0.2.2 بـ hooks الـ Node وبيشيل فولدرات الـ hooks القديمة؛ والـ hooks بتاعتك بتفضل زي ما هي. في Codex، وافق على الـ hooks تاني بعدها. الـ installs من 0.2.1 أو أقدم (تحت `.workflow/`) مش بتتنقل؛ شوف [الـ changelog](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/CHANGELOG.md).

علشان ترجع لـ 0.2.2، اعمل uninstall الأول وبعدين سطّب النسخة القديمة. لو شغّلت `upgrade` بـ 0.2.2 بدل كده، المجموعتين هيفضلوا وكل hook هيشتغل مرتين. اكتب الـ agents اللي بتستخدمها:

```bash
npx burhan-kit uninstall --apply
npx burhan-kit@0.2.2 init --agents claude,codex --apply
```

`workflow.config` و`bindings.md` بيفضلوا زي ما هم.

## الـ agents المدعومة

Claude Code (2.1.139 أو أحدث) وCodex مدعومين. في Codex، وافق على project hooks بعد الـ setup وإلا مش هتشتغل؛ مرجع الإعدادات بيشرح خطوة الثقة.

**Windows:** الـ hooks بتشتغل على Node، من غير bash ولا jq. الـ CI بيشغّلها على `windows-latest` بـ Node 22 و24، مع Git Bash ومن غيره. لسه ما اتأكدش: Windows بـ PowerShell بس (من غير Git Bash)، وجلسة Claude Code أو Codex حقيقية على Windows.

## الحدود

burhan بيبلّغ ويوجّه—مش بديل لحكم الإنسان. يقدر يقيّم بس التعديلات والأوامر اللي الـ agent بيبلغ الـ hooks بيها؛ تعديلات الـ shell بتبان بس بصيغ الـ shell المدعومة.

## لينكات

- [الإعدادات](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md)
- [سجل التغييرات](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/CHANGELOG.md)
- [Roadmap](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/ROADMAP.md)
- [English README](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/README.md)
- [Issues](https://github.com/ahmedkamaldabour/burhan-kit/issues)

## الرخصة

MIT. شوف [LICENSE](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/LICENSE).
