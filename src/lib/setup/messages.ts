import type { Agent } from '../bootstrap.js';
import type { ExistingHook } from '../hooks-merge.js';
import type { ExistingHooksChoice } from './answers.js';

export type Lang = 'en' | 'ar';
export interface Option { value: string; label: string; hint?: string }
export interface Question { id: 'agents' | 'mode' | 'docs'; ask: string; options: Option[] }

/** The three install questions (AC-04). Plain words only: no setting names, patterns or internal terms. */
export const QUESTIONS: Record<Lang, Question[]> = {
  en: [
    { id: 'agents', ask: 'Which coding agents do you use in this project?', options: [
      { value: 'claude', label: 'Claude Code', hint: 'full support' },
      { value: 'codex', label: 'Codex', hint: 'works after you trust its hooks inside Codex; its sandbox may stop burhan writing the .codex/ folder, and you then run one command yourself' },
      { value: 'both', label: 'Both' },
    ] },
    { id: 'mode', ask: 'When should the agent come back to you?', options: [
      { value: 'step', label: 'Show me the plan, then pause after each part', hint: 'recommended' },
      { value: 'auto', label: "Show me the plan once, then continue until it's ready to commit" },
    ] },
    { id: 'docs', ask: 'Where should the work files be kept?', options: [
      { value: 'private', label: 'Private, in .burhan/work/', hint: 'recommended; stays out of git' },
      { value: 'shared', label: 'Shared in git' },
      { value: 'custom', label: 'A folder I type' },
    ] },
  ],
  ar: [
    { id: 'agents', ask: 'بتستخدم أنهي أدوات AI للبرمجة في المشروع ده؟', options: [
      { value: 'claude', label: 'Claude Code', hint: 'شغّال بالكامل' },
      { value: 'codex', label: 'Codex', hint: 'بيشتغل بعد ما توافق على الـ hooks بتاعته جوّه Codex؛ ولو الـ sandbox منعه يكتب في .codex/ هتشغّل أمر واحد بنفسك' },
      { value: 'both', label: 'الاتنين' },
    ] },
    { id: 'mode', ask: 'الـ agent يرجعلك إمتى؟', options: [
      { value: 'step', label: 'وريني الخطة، وبعدين استنّى بعد كل جزء', hint: 'مقترح' },
      { value: 'auto', label: 'وريني الخطة مرة واحدة، وبعدين كمّل لحد ما الشغل يبقى جاهز للـ commit' },
    ] },
    { id: 'docs', ask: 'ملفات الشغل تتحفظ فين؟', options: [
      { value: 'private', label: 'خاصة بيك، في .burhan/work/', hint: 'مقترح؛ مش بتدخل git' },
      { value: 'shared', label: 'مشتركة في git' },
      { value: 'custom', label: 'فولدر أكتبه أنا' },
    ] },
  ],
};

/** The block the agent shows the person, verbatim in both languages (AC-13). */
const BLOCK = [
  'burhan needs one thing before it can check your work:',
  '',
  'Recommended for this project (<stack>):',
  '  Check before commit   <command or "none found, tell me which to use">',
  '  Sensitive             <paths, or "nothing">',
  '',
  '● Use these   ○ Change something',
];

export interface Messages {
  title(target: string): string;
  created: string; changed: string; removed: string; none: string;
  settings: string;
  agents(list: Agent[]): string;
  mode(m: 'step' | 'auto'): string;
  docs(label: string): string;
  docsPrivate: string; docsShared: string; docsCustom: string;
  models: string;
  skills(s: 'superpowers' | 'none'): string;
  branches: string;
  check(pending: boolean, cmd: string): string;
  changeUndo: string;
  nothingCommitted: string;
  codexTrust: string;
  newAgentSession(target: string): string;
  moveFailed: string;
  moveRollbackFailed(work: string, discovery: string, configDocs: string, configDiscovery: string): string;
  ignoredCommittedFiles(lines: readonly string[]): string[];
  outsideSettings(paths: readonly { rel: string; real: string }[]): string[];
  existingHooks(hooks: readonly ExistingHook[], choice: ExistingHooksChoice): string[];
  wizard: {
    what: string[]; scope: string; recommended: string; current: string;
    useOrChoose: string; use: string; choose: string;
    applyOrChange: string; apply: string; change: string; cancel: string;
    customPath: string; cancelled: string;
    existingHooks: { ask: string; keep: string; removeMine: string };
    moveDocs: { ask: string; keep: string; move: string };
    done: string; askAgent: string; runCheck(cmd: string): string; runYes: string; runNo: string;
    terminalOnly: string;
  };
  agent: {
    rules: string[];
    readFailed(file: string, why: string): string;
    notRegular(file: string): string;
    tooLarge(file: string): string;
    notJson(file: string): string;
    notObject: string;
    unknownField(field: string): string;
    conflictingFlags(first: string, second: string): string;
    badAgents: string;
    badMode: string;
    badDocs: string;
    badLang: string;
    badExistingHooks: string;
    badMoveDocs: string;
  };
  stack: {
    instructions: string;
    notInstalled: string;
    running(cmd: string, secs: number): string;
    none: string;
    result(code: number | null, timedOut: boolean): string;
    failed(cmd: string): string;
    saved(check: string): string;
  };
  what: {
    kit(created: boolean): string;
    config(created: boolean): string;
    bindings(created: boolean): string;
    hooks(created: boolean, agent: string): string;
    bootstrap(created: boolean): string;
    managed(created: boolean): string;
    gitignore: string;
    privateIgnore: string;
    removed: string;
  };
}

const en: Messages = {
  wizard: {
    what: ['Your agent writes a short plan and waits for your OK before it codes.', 'It checks its own work before every commit.', 'It never commits without asking you first.'],
    scope: 'inside this project only · sends nothing · removable with one command',
    recommended: 'Recommended for this project:', current: 'Current settings of this project:',
    useOrChoose: 'How do you want to set it up?',
    use: "Use these settings (you'll see the full summary before anything is written)", choose: 'Let me choose myself',
    applyOrChange: 'What now?', apply: 'Apply', change: 'Change something', cancel: 'Cancel',
    customPath: 'Type the folder for the work files, inside this project (for example docs/work):',
    cancelled: 'Cancelled. Nothing was changed.',
    existingHooks: { ask: 'What do you want to do with your existing hooks on these events?', keep: 'Keep both (recommended)', removeMine: "I\'ll remove mine" },
    moveDocs: { ask: 'Your shared work files use the old AI_SPEC folder. What do you want to do?', keep: 'Keep the old folder (recommended)', move: 'Move to docs/burhan/' },
    done: 'Done. burhan is set up in this project.',
    askAgent: 'To change settings later, run npx burhan-kit setup, or ask your agent: change burhan settings',
    runCheck: (c) => `Run the check now (${c})?`, runYes: 'Yes, run it', runNo: 'Not now',
    terminalOnly: 'burhan setup needs a terminal. Run it in a terminal (an AI agent: run npx burhan-kit setup --agent).',
  },
  title: (t) => `burhan will set up ${t}`,
  created: 'Created', changed: 'Changed', removed: 'Removed', none: '(nothing)',
  settings: 'Settings you can change later',
  agents: (l) => `Agents: ${l.join(', ')}`,
  mode: (m) => m === 'step' ? 'Pauses: show the plan, then pause after each part' : "Pauses: show the plan once, then continue until it's ready to commit",
  docs: (l) => `Work files: ${l}`,
  docsPrivate: 'private, not in git', docsShared: 'shared in git', docsCustom: 'your folder',
  models: 'Models: same as your session',
  skills: (s) => s === 'superpowers' ? 'Skills: superpowers (found on this computer)' : 'Skills: none',
  branches: 'Branches: feature branches + pull requests; commit only after the a/b/c checkpoint',
  check: (p, c) => p ? 'Check before commit: your agent sets this up on first use' : `Check before commit: ${c} (kept)`,
  changeUndo: 'Change anytime: npx burhan-kit setup · Undo: npx burhan-kit uninstall',
  nothingCommitted: 'Nothing is committed · nothing outside this project changes',
  codexTrust: "Codex: first-use setup starts after you trust burhan's hooks in Codex (open Codex in this project and review them).",
  newAgentSession: (target) => `Start a new agent session in ${target} for burhan's hooks to take effect.`,
  moveFailed: 'Could not move the old shared folders. Nothing was changed.',
  moveRollbackFailed: (work, discovery, configDocs, configDiscovery) => `Could not finish moving the old shared folders. The work folder is now at ${work}; the discovery folder is now at ${discovery}. .workflow/workflow.config still says WF_DOCS_DIR=${configDocs} and WF_DISCOVERY_DIR=${configDiscovery}. Fix the folders or the config, then run setup again.`,
  ignoredCommittedFiles: (lines) => ['Warning: these files are ignored by this project’s .gitignore. Add these exact lines; burhan did not edit it:', ...lines],
  outsideSettings: (paths) => ['Warning: these settings files are symlinks to real files outside this project:', ...paths.map((path) => `  ${path.rel} → ${path.real} — outside this project`)],
  existingHooks: (hooks, choice) => [
    'Your existing hooks',
    ...hooks.map((hook) => `  ${hook.agent} — ${hook.event}${hook.matcher === undefined ? '' : ` (${hook.matcher})`}: ${hook.command}`),
    "These will run alongside burhan's hooks, so reminders may repeat.",
    ...(choice === 'remove-mine' ? [
      'Remove these exact entries yourself; burhan will not edit them:',
      ...hooks.map((hook) => `  ${hook.event}${hook.matcher === undefined ? '' : ` (${hook.matcher})`}: ${hook.hookJson}`),
    ] : []),
  ],
  agent: {
    rules: [
      'burhan setup, for an AI agent. Follow these rules exactly:',
      '- Ask the person the questions below in order, one question per message, using the exact text and choices. Wait for each answer.',
      '- Use plain words. No tables and no setting names or config keys.',
      '- Never edit .workflow/ yourself; burhan writes it.',
      '- Put the answers in a JSON file shaped like "recommended" below, then run: npx burhan-kit setup --answers <file>',
      '- Show its summary to the person. Run it again with --apply only after the user says yes.',
    ],
    readFailed: (f, w) => `cannot read the answers file ${f}: ${w}`,
    notRegular: (f) => `the answers file ${f} is not a regular file`,
    tooLarge: (f) => `the answers file ${f} is too large (over 1 MB) — it should hold only the answers`,
    notJson: (f) => `the answers file ${f} is not valid JSON`,
    notObject: 'the answers must be a JSON object like the "recommended" one',
    unknownField: (field) => `the answers include an unknown field "${field}"`,
    conflictingFlags: (first, second) => `${first} cannot be used with ${second}`,
    badAgents: 'agents must be "claude", "codex", or "both", or a non-empty list of "claude" and/or "codex"',
    badMode: 'mode must be "step" or "auto"',
    badDocs: 'docs must be "private" or "shared", {"kind":"private"} or {"kind":"shared"}, or {"kind":"custom","path":"<folder inside the project>"}',
    badLang: 'lang must be "en" or "ar"',
    badExistingHooks: 'existingHooks must be "keep" or "remove-mine"',
    badMoveDocs: 'moveDocs must be "keep" or "move"',
  },
  stack: {
    instructions: [
      'burhan first-use setup. Do this now, before other work:',
      '',
      '1. Read this project (its manifests, scripts and CI files) and decide two things: the one command that checks the work before a commit; and the paths where a mistake costs the most (security, permissions, money, migrations).',
      '2. Show the person ONLY this block, filled in, and nothing else (no tables, no setting names, no patterns):',
      '',
      ...BLOCK,
      '',
      '3. If no check command fits, say so and ask which one to use. Never invent one.',
      "4. When the person picks 'Use these' (or changes something and agrees), save it with:",
      "   npx burhan-kit setup --set check='<command or none>' sensitive='<p;q>'",
      "   Separate list items with ';'. Leave a list out when it is empty. A value cannot contain a single quote (') or a line break: put the command in a small script instead.",
      '5. The command runs the check once and shows its output. If it fails, show the person the output and ask; do not retry with a different command on your own. Add --force only if they confirm a slow but valid check.',
      '6. The agent may edit .workflow/workflow.config only, after showing the diff and getting approval; it is a shared file, so the change reaches the team through review (a pull request) like code; never the kit-owned files.',
    ].join('\n'),
    notInstalled: 'burhan is not installed in this project — run npx burhan-kit setup first',
    running: (c, n) => `Running the check once: ${c}  (stops after ${n}s)`,
    none: 'No check chosen: burhan will not run one before commits.',
    result: (code, t) => t ? `The check timed out. exit ${code ?? 'none'}` : `exit ${code ?? 'none'}`,
    failed: (c) => `The check did not pass, so nothing was saved. Fix it and run again, or pick another command. If "${c}" is right but slow, run the same command again with --force to save it anyway.`,
    saved: (c) => c === '' ? 'Saved: no check before commit. First-use setup is done.' : `Saved: check before commit is ${c}. First-use setup is done.`,
  },
  what: {
    kit: (c) => c ? "burhan's workflow text, hooks and commands" : "burhan's own files, refreshed to this version",
    config: (c) => c ? 'your settings, from these answers' : 'these answers written; your other values kept',
    bindings: (c) => c ? 'your project facts, with work files and branches filled in' : 'two rows filled in; the rest untouched',
    hooks: (c, a) => c ? `burhan's hooks for ${a}` : `burhan's hooks added for ${a}; your other settings kept`,
    bootstrap: (c) => c ? 'a short pointer to the working agreement' : 'a short block at the end, your text untouched',
    managed: (c) => c ? 'managed by burhan' : 'refreshed (managed by burhan)',
    gitignore: 'one line added so personal files stay out of git',
    privateIgnore: 'keeps your work files out of git',
    removed: 'no longer needed with these settings',
  },
};

const ar: Messages = {
  wizard: {
    what: ['الـ agent بتاعك بيكتب خطة قصيرة ويستنّى موافقتك قبل ما يكتب كود.', 'بيشيّك على شغله بنفسه قبل كل commit.', 'عمره ما بيعمل commit من غير ما يسألك.'],
    scope: 'جوّه المشروع ده بس · مبيبعتش أي حاجة لأي حد · بيتشال بأمر واحد',
    recommended: 'المقترح للمشروع ده:', current: 'إعدادات المشروع ده دلوقتي:',
    useOrChoose: 'تحب تظبطها إزاي؟',
    use: 'استخدم الإعدادات دي (هتشوف الملخص كله قبل ما أي حاجة تتكتب)', choose: 'هختار بنفسي',
    applyOrChange: 'نعمل إيه دلوقتي؟', apply: 'نفّذ', change: 'غيّر حاجة', cancel: 'إلغاء',
    customPath: 'اكتب فولدر ملفات الشغل جوّه المشروع ده (مثلًا docs/work):',
    cancelled: 'اتلغى. مفيش حاجة اتغيّرت.',
    existingHooks: { ask: 'عندك hooks على الأحداث دي. تحب تعمل إيه؟', keep: 'سيب الاتنين (مقترح)', removeMine: 'أنا هشيل بتوعي' },
    moveDocs: { ask: 'ملفات الشغل المشتركة عندك لسه في فولدر AI_SPEC القديم. تحب تعمل إيه؟', keep: 'سيب الفولدر القديم (مقترح)', move: 'انقل لـ docs/burhan/' },
    done: 'خلاص. burhan جاهز في المشروع ده.',
    askAgent: 'عشان تغيّر الإعدادات بعدين: شغّل npx burhan-kit setup، أو قول للـ agent بتاعك: غيّر إعدادات burhan',
    runCheck: (c) => `أشغّل الفحص دلوقتي (${c})؟`, runYes: 'أيوه، شغّله', runNo: 'مش دلوقتي',
    terminalOnly: 'الـ setup محتاج terminal. شغّله من terminal (ولو إنت AI agent: شغّل npx burhan-kit setup --agent).',
  },
  title: (t) => `burhan هيتظبط في ${t}`,
  created: 'هيتعمل', changed: 'هيتعدّل', removed: 'هيتشال', none: '(ولا حاجة)',
  settings: 'إعدادات تقدر تغيّرها بعدين',
  agents: (l) => `الـ agents: ${l.join('، ')}`,
  mode: (m) => m === 'step' ? 'الوقفات: يوريك الخطة، وبعدين يستنّى بعد كل جزء' : 'الوقفات: يوريك الخطة مرة واحدة، وبعدين يكمّل لحد ما الشغل يبقى جاهز للـ commit',
  docs: (l) => `ملفات الشغل: ${l}`,
  docsPrivate: 'خاصة بيك، بره git', docsShared: 'مشتركة في git', docsCustom: 'الفولدر بتاعك',
  models: 'الموديلات: نفس موديل الـ session بتاعتك',
  skills: (s) => s === 'superpowers' ? 'الـ skills: superpowers (متسطّبة على الجهاز ده)' : 'الـ skills: مفيش',
  branches: 'الـ branches: branch لكل ميزة + pull request؛ ومفيش commit غير بعد ما تختار a/b/c',
  check: (p, c) => p ? 'الفحص قبل الـ commit: الـ agent بتاعك هيظبطه أول ما يشتغل' : `الفحص قبل الـ commit: ${c} (زي ما هو)`,
  changeUndo: 'تغيّر في أي وقت: npx burhan-kit setup · ترجع في كلامك: npx burhan-kit uninstall',
  nothingCommitted: 'مفيش حاجة بتتعمل لها commit · ومفيش حاجة بتتغيّر بره المشروع ده',
  codexTrust: 'Codex: الـ setup بتاع أول استخدام بيبدأ بعد ما توافق على الـ hooks بتاعة burhan جوّه Codex (افتح Codex في المشروع ده وراجعها).',
  newAgentSession: (target) => `ابدأ session جديدة للـ agent جوّه ${target} عشان hooks burhan تشتغل.`,
  moveFailed: 'مقدرناش ننقل فولدرات الشغل المشتركة القديمة. مفيش حاجة اتغيّرت.',
  moveRollbackFailed: (work, discovery, configDocs, configDiscovery) => `مقدرناش نكمّل نقل فولدرات الشغل المشتركة القديمة. فولدر الشغل موجود دلوقتي في ${work}؛ وفولدر الاكتشاف موجود دلوقتي في ${discovery}. .workflow/workflow.config لسه بيقول WF_DOCS_DIR=${configDocs} و WF_DISCOVERY_DIR=${configDiscovery}. ظبّط الفولدرات أو الإعداد، وبعدها شغّل setup تاني.`,
  ignoredCommittedFiles: (lines) => ['تحذير: الـ .gitignore بتاع المشروع مخبّي الملفات دي. ضيف السطور دي زي ما هي؛ burhan ماعدّلهاش:', ...lines],
  outsideSettings: (paths) => ['تحذير: ملفات الإعدادات دي symlink لملفات حقيقية برّه المشروع:', ...paths.map((path) => `  ${path.rel} → ${path.real} — دي برّه المشروع`)],
  existingHooks: (hooks, choice) => [
    'الـ hooks اللي عندك',
    ...hooks.map((hook) => `  ${hook.agent} — ${hook.event}${hook.matcher === undefined ? '' : ` (${hook.matcher})`}: ${hook.command}`),
    'دول هيشتغلوا جنب hooks بتاعة burhan، فممكن التنبيهات تتكرر.',
    ...(choice === 'remove-mine' ? [
      'شيل الإدخالات دي بنفسك؛ burhan مش هيعدّلها:',
      ...hooks.map((hook) => `  ${hook.event}${hook.matcher === undefined ? '' : ` (${hook.matcher})`}: ${hook.hookJson}`),
    ] : []),
  ],
  agent: {
    rules: [
      'إعداد burhan عن طريق AI agent. امشي على القواعد دي بالظبط:',
      '- اسأل الشخص الأسئلة اللي تحت بالترتيب، سؤال واحد في كل رسالة، بنفس النص والاختيارات. واستنّى كل إجابة.',
      '- كلام بسيط. من غير جداول ومن غير أسماء إعدادات.',
      '- متعدّلش فولدر .workflow/ بنفسك؛ burhan هو اللي بيكتبه.',
      '- حط الإجابات في ملف JSON بنفس شكل "recommended" اللي تحت، وبعدين شغّل: npx burhan-kit setup --answers <file>',
      '- وري الشخص الملخص. ومتشغّلوش بـ --apply غير لما المستخدم يقول أيوه.',
    ],
    readFailed: (f, w) => `مقدرتش أقرا ملف الإجابات ${f}: ${w}`,
    notRegular: (f) => `ملف الإجابات ${f} مش ملف عادي`,
    tooLarge: (f) => `ملف الإجابات ${f} كبير قوي (أكتر من 1 MB) — المفروض يكون فيه الإجابات بس`,
    notJson: (f) => `ملف الإجابات ${f} مش JSON سليم`,
    notObject: 'الإجابات لازم تبقى JSON object زي "recommended"',
    unknownField: (field) => `ملف الإجابات فيه field مش معروف: "${field}"`,
    conflictingFlags: (first, second) => `مينفعش تستخدم ${first} مع ${second}`,
    badAgents: 'agents لازم تبقى "claude" أو "codex" أو "both"، أو list مش فاضية فيها "claude" و/أو "codex"',
    badMode: 'mode لازم يبقى "step" أو "auto"',
    badDocs: 'docs لازم يبقى "private" أو "shared"، أو {"kind":"private"} أو {"kind":"shared"}، أو {"kind":"custom","path":"<فولدر جوّه المشروع>"}',
    badLang: 'lang لازم يبقى "en" أو "ar"',
    badExistingHooks: 'existingHooks لازم يبقى "keep" أو "remove-mine"',
    badMoveDocs: 'moveDocs لازم يبقى "keep" أو "move"',
  },
  stack: {
    instructions: [
      'إعداد burhan لأول استخدام. اعمله دلوقتي قبل أي شغل تاني:',
      '',
      '1. اقرا المشروع ده (ملفات الإعدادات والـ scripts وملفات الـ CI) وطلّع حاجتين: الأمر الواحد اللي بيشيّك على الشغل قبل الـ commit؛ والأماكن اللي الغلط فيها مكلّف أكتر (الأمان والصلاحيات والفلوس والـ migrations).',
      '2. وري المستخدم الـ block ده بس، بعد ما تملاه، ومفيش أي حاجة غيره (من غير جداول ولا أسماء إعدادات ولا patterns):',
      '',
      ...BLOCK,
      '',
      '3. لو مفيش أمر فحص مناسب للمشروع، قول كده واسأل يستخدم أنهي أمر. وعمرك ما تألّف أمر (never invent).',
      "4. لما المستخدم يختار 'Use these' (أو يعدّل ويوافق)، احفظ بالأمر ده:",
      "   npx burhan-kit setup --set check='<الأمر أو none>' sensitive='<p;q>'",
      "   افصل عناصر القوايم بـ ';'. ولو القايمة فاضية شيلها. القيمة مينفعش يبقى فيها علامة تنصيص مفردة (') ولا سطر جديد: حط الأمر في script صغير واستخدمه.",
      '5. الأمر ده بيشغّل الفحص مرة واحدة ويطبع النتيجة. لو فشل، وري النتيجة للمستخدم واسأله؛ ومتجرّبش أمر تاني من دماغك. ضيف --force بس لو هو أكّد إن الفحص صح بس بطيء.',
      '6. الـ agent يقدر يعدّل .workflow/workflow.config بس، بعد ما يورّي الـ diff وياخد موافقة؛ ده ملف مشترك، فالتغيير يوصل للفريق من خلال review (pull request) زي الكود؛ عمره ما يعدّل ملفات الـ kit.',
    ].join('\n'),
    notInstalled: 'burhan مش متسطّب في المشروع ده — شغّل npx burhan-kit setup الأول',
    running: (c, n) => `بشغّل الفحص مرة واحدة: ${c}  (هيقف بعد ${n} ثانية)`,
    none: 'مفيش فحص متختار: burhan مش هيشغّل فحص قبل الـ commit.',
    result: (code, t) => t ? `الفحص خد وقت أكتر من المسموح. exit ${code ?? 'none'}` : `exit ${code ?? 'none'}`,
    failed: (c) => `الفحص منجحش، فمفيش حاجة اتحفظت. صلّحه وشغّله تاني، أو اختار أمر تاني. ولو "${c}" صح بس بطيء، شغّل نفس الأمر بـ --force عشان يتحفظ.`,
    saved: (c) => c === '' ? 'اتحفظ: من غير فحص قبل الـ commit. إعداد أول استخدام خلص.' : `اتحفظ: الفحص قبل الـ commit هو ${c}. إعداد أول استخدام خلص.`,
  },
  what: {
    kit: (c) => c ? 'نص طريقة الشغل والـ hooks والأوامر بتاعة burhan' : 'ملفات burhan نفسها، متحدّثة للنسخة دي',
    config: (c) => c ? 'إعداداتك، من الإجابات دي' : 'الإجابات دي بتتكتب؛ وباقي قيمك زي ما هي',
    bindings: (c) => c ? 'بيانات مشروعك، ومعاها ملفات الشغل والـ branches' : 'سطرين بيتملوا؛ والباقي زي ما هو',
    hooks: (c, a) => c ? `الـ hooks بتاعة burhan لـ ${a}` : `بيضيف الـ hooks بتاعة burhan لـ ${a}؛ وباقي إعداداتك زي ما هي`,
    bootstrap: (c) => c ? 'إشارة قصيرة لاتفاق الشغل' : 'block قصير في الآخر، والنص بتاعك زي ما هو',
    managed: (c) => c ? 'burhan هو اللي بيديره' : 'متحدّث (burhan بيديره)',
    gitignore: 'سطر واحد عشان الملفات الشخصية تفضل بره git',
    privateIgnore: 'بيخلّي ملفات الشغل بره git',
    removed: 'مبقاش له لازمة بالإعدادات دي',
  },
};

export const messages = (lang: Lang): Messages => (lang === 'ar' ? ar : en);
