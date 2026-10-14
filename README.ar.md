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

1. استخدم Node 22 أو أحدث جوّه الـ repository اللي عايز تجهزه.
2. شغّل:

```bash
npx burhan-kit
```

3. جاوب التلات أسئلة:
   - بتستخدم أنهي أدوات AI للبرمجة؟
   - الـ agent يرجعلك إمتى؟
   - burhan يحفظ الـ story والخطة والـ reviews بتاعة كل مهمة فين؟ الإجابة المقترحة هي “في git للفريق — docs/burhan/work/”.
4. راجع التغييرات المقترحة ووافق عليها؛ مفيش حاجة بتتكتب قبل موافقتك.
5. اتأكد إنه اشتغل: ملخص الـ setup بيعرض ملفات `.burhan/` المُدارة؛ وبعدها شغّل `npx burhan-kit doctor`. الـ project checks بيقترحها الـ agent أول استخدام، وبعدها أنت بتوافق عليها.

ولو الـ agent هو اللي هيجهز المشروع، قوله يشغّل `npx burhan-kit setup --agent` ويمشي على الإرشادات اللي بتظهر له.

## إيه اللي بيحصل في أول مهمة؟

الـ setup بيحط اتفاق الشغل والإعدادات والـ hooks المُدارة بتاعة burhan في `.burhan/`. الـ hooks الموجودة بتفضل شغالة: بتشتغل جنب hooks بتاعة burhan، فممكن التنبيهات تتكرر.

ابدأ مهمة مع الـ agent. كل مهمة ليها story وخطة وreviews في المكان اللي اخترته. شغّل `burhan use <slug>` علشان تربط الـ session الحالية بالمهمة دي—وده مفيد خصوصاً لما أكتر من مهمة تكون شغالة. Superpowers اختياري؛ burhan عمره ما بيثبّته لك.

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

## الـ agents المدعومة

Claude Code وCodex مدعومين. في Codex، وافق على project hooks بعد الـ setup وإلا مش هتشتغل؛ مرجع الإعدادات بيشرح خطوة الثقة.

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
