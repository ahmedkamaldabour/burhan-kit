# Changelog

## 0.7.0 — 2026-10-27

An agent no longer writes a task's files from memory, and a plan becomes something a weaker model can follow. New
commands make the task files from the templates, move their statuses one step at a time, record reviews, approvals
and deviations in the exact form the checks read, and say what comes next. A plan is now two files: the decisions, and
a build spec with the complete test and code of every sub-unit; the agent that builds follows them exactly and stops
when a step fails unexpectedly. The size limits on story, plan and review files are gone. The checks that read the task
files stay off in a project until you switch them on.

### A session reads fewer words of burhan's own files at each stage
A session reads fewer words of burhan's own files at each stage of a task, and no rule or check was removed to get there; a session that goes through every stage reads 247 words more than before, and every session starts with 35 more (details below). Words and bytes are measured with `scripts/measure-artifacts.mjs`, run before and after; tokens are an estimate (bytes divided by 4), not a tokenizer count, and no real agent session was measured.

- **The state file.** A closed task's line has one shape: `- <slug> · <type> / <scope> · <outcome> · <commit id, or uncommitted> · <folder>` (`phases/close-out.md`). `burhan state compact` shortens the old lines of closed tasks: it is a dry run unless `--apply` is given, it never touches a `###` block, the old text goes to the task's `<slug>-state-notes.md` first, and `--apply` keeps a `.bak` copy. The hooks and commands that read the state file were run on a compacted file. Measured on the maintainer's own state file: the dry run saves 31 of its 2,676 words, because most of the file (1,998 words, 757 of them in blocks of closed tasks) is in `###` blocks that the command leaves to the session that owns them.
- **The plan's checklist.** The gate checklist is written from the route by `burhan item new`, from one table, so a route gets only the gates it needs (a release has 9 gates and 129 words, a refactor 11 and 199, a feature 15 and 232; the old list was 15 gates and 250 words for every route). A fresh plan goes from 932 words to between 805 and 908. A plan made before keeps its full list and works unchanged. If a project's own `.burhan/templates/plan.md` has an extra gate, `item new` replaces that checklist for the ten exact routes.
- **`lifecycle.md` and `e2e.md` are split by stage.** `e2e.md` is a short sequencer and each stage has a file (`stage-story.md`, `stage-plan.md`, `stage-build.md`, `stage-finish.md`) that the map in the core names. What a session loads at a stage, in words (`e2e.md`, `lifecycle.md` and that stage's file): story 1,614, plan 1,623, build 2,299, finish 1,257, against 3,465 before. A session that goes through every stage reads 3,712 words, 247 more than before, and the core grew by 35 words (the map). No rule was removed: the rule inventory and a sentence-by-sentence check prove it, and five sentences that were in two files are now in one.
- **The review file.** A finding row is the claim, the location and the result in one line; long probe output goes in `reviews/evidence/<slug>-su<N>.md`, which is not read by default; and the Assess step reads the review file by need (its headings, the sections of sub-units not yet Reviewed and the latest fix round) while QC still reads everything. The 28,047-word review file of the 0.7.0 work was analysed first (47% of it is finding and status table rows; only two instructions make an agent read the whole file) and nothing in it was deleted or rewritten.
- **Known limits.** The reading rule for the review file is text the agent follows; no hook enforces it. `state compact` reads a commit id as the last hex token of 7 to 40 characters in the old line (else `uncommitted`), and the dry run shows every line before anything is written. Windows and macOS runs of the new tests are not measured.

### The guide names the process skill, and a passing full run is reused
With `WF_SKILLS=superpowers`, `burhan guide` names the process skill to run before the next write, from one table of stage → skill (the phases of `phases/skills.md`), and the commands that open a stage (`item new`, `approve`, `item set`, `item finish`, `deviation resolve`) print the same line. The line says whether the evidence ledger shows the skill already run for this item in the latest session of the project; the ledger is written at the end of a turn and the command has no session id, so it cannot see the current turn and can name the previous session's record in the first turn of a new one. `burhan guide` prints nothing about skills when `WF_SKILLS` is empty or `none`. The hooks' behaviour is unchanged (`item-stage.mts`, which they share, gains the table function they do not call). `WF_SKILLS` is read the way the hooks read it: the shell environment, with a config file's value over it. Not measured: whether an agent follows a line it ran itself more than the hook's reminder.

- **A full run is reused.** `phases/stage-finish.md` has one rule, Reusing a full run: one passing run of the full suite after the last code edit is enough for verification, QC and the commit; run it again only if code or tests changed since (docs, CHANGELOG, ROADMAP and comments do not count); a QC confirmation round runs the tests of the changed areas unless the fix lands outside the findings. `stage-build.md`, `qc.md` and the plan template point at it.
- **A `full run:` line.** `burhan guide` (and `burhan guide --json`, as `fullRun`) and `burhan evidence --item <slug>` (text only) say whether a passing full run exists after the last code edit, and when: `yes`, `no`, `none` or `cannot tell`. A code edit is an edit of a path matching `WF_CODE_REGEX` or `WF_TEST_REGEX`; a full run is a command matching the new key `WF_FULL_TEST_REGEX` that passed and was not piped. A run started in the background has no result in the ledger: it never counts, and the line names it so the log is read before the suite is run again. Nothing blocks and no hook warns because of either line.
- **New config key `WF_FULL_TEST_REGEX`.** Empty means the line says it cannot tell. `burhan doctor` names the key as missing in an existing project's config (a warning, not a failure): copy it from `workflow.config.example`.
- **What the ledger cannot see.** A shell edit (`sed -i`, a script, a formatter), an edit made outside the session, the current turn, a run whose recorded exit hides a failure (`npm test || true`, `npm test; echo done`: the ledger keeps the last command's exit), and the difference between a comment and code in a code file: after one of these the line can say `yes` for a run that is stale, or `no` after a comment edit. Not measured: Windows and macOS runs of the new tests.

### Upgrading from 0.6.0
- Run `npx burhan-kit upgrade --apply` in every project. It refreshes the kit files (the phase files, the commands,
  the templates and the hook scripts) and adds no hook entry. Your `workflow.config` and `bindings.md` are kept.
- **To switch the new checks on in an existing project, add one line to `.burhan/workflow.config`:
  `WF_ITEM_CONTRACT="on"`.** Without it the contract check, the stage check and the deviation check stay off; the approval
  report runs either way, and the prompt hook now records whether your message had approval wording (a small file in
  the evidence store); a project made by `burhan init` starts with it on. `burhan doctor` names a value that is not
  `on` or `off`.
- A task started before 0.7.0 keeps working: its files are checked as advice only, and are judged by the audit only
  once they carry the line `**Contract:** 1` that `item new` writes. An old plan has no build spec and no Deviations
  table; `item check` names them as advice.
- **The word and line limits are gone.** A story, plan, review, QC, verification, findings or discovery file may be any
  length, and the commands accept any length of text. `burhan stats` no longer prints a "File size" line and
  `burhan stats --json` no longer has the `words` key: a script that reads it must stop. What stays: no control
  character in a command argument, the state file's line budget, the router's two lines, and a folder name of at most
  100 characters.
- The kit text no longer tells the agent to `git stash`: to tell an old failure from a new one it re-runs the check on
  a clean copy of the commit the work started from (`git worktree`).
- Codex was not run: whether it asks you to trust the changed hook scripts again is not measured.

### Added
- **Commands for a task's files.** `burhan item new <slug> --type <t> --scope <s>` makes the story, plan (and build
  spec) or findings from the templates, with `**Contract:** 1`, and the task's block in the state file; `item set` moves
  a plan or a sub-unit status one step along its ladder (Reviewed needs a review section; a Completed plan reopens only after a
  failed QC, or with `--reopen "<why>"` when its QC passed); `gate tick` ticks a gate of the plan's checklist when its evidence exists, or with `--evidence`;
  `review add` writes a review, QC or verification with Performed by in the exact form; `approve story|plan|qc` writes
  your approval and ticks its gate (a plan is approved together with its build spec); `item finish` completes a plan;
  `item check` names every fault in a task's files; `guide` says the stage, the next step and whether code edits are
  authorized now.
- **The plan as an executable spec.** Two files per plan. `<slug>-implementation-plan.md` holds the decision card, the
  table that maps every acceptance criterion to its sub-unit and test, what the story got wrong (with file:line), the
  rulings, the gate checklist, the Executor rules and the Deviations table. `<slug>-build-spec.md` holds, per sub-unit,
  the files, the complete test, the RED command and its expected output, the complete code (or a before and after
  edit), the GREEN command and its output, the lint command and the interfaces it produces and consumes, and a
  "Not verified" section where the planner lists what it could not read or run. `item check` names a missing coverage
  table, a missing build spec or section, an AC with no test, and a sub-unit with no spec.
- **Strict execution.** The agent that builds follows the plan and the spec exactly. A step that fails unexpectedly
  (a RED that does not fail as the spec says, a GREEN that fails, a file that differs) means stop: `burhan deviation
  add` records an open row in the plan's Deviations table, `burhan guide` then says code edits are not authorized, and
  only the owner's `burhan deviation resolve <slug> <n> --approved|--rejected --by <name>` lets the work go on (an
  approved deviation updates the plan and the spec first, then the code). The gate "No open deviation" and `item finish`
  refuse while a row is open. After a sub-unit only its own test files run, then the fast check; the full suite runs at
  QC, before a commit, or when a fix lands outside the covered tests.
- **A written contract** for story, plan, build spec, review, QC, verification and findings files, read by one module
  that the commands and the hooks share (`item-contract.mts`, `item-model.mts`, `item-stage.mts`).
- **Four turn-end checks.** The contract check flags a task file the agent wrote directly that breaks the contract, or
  created by hand without the marker; the stage check flags code edited while `guide` says "not authorized"; the
  deviation check flags a code file the build spec does not list, an edit of the spec, or an edit of the plan's
  executable parts (the coverage table, the executor rules, the Covers lines) after approval, when no deviation is
  approved; the approval report names every `approve` and `deviation resolve` command the agent ran and flags it when
  your latest message had no approval wording. The first three need `WF_ITEM_CONTRACT=on`.
- **Placeholders.** `approve story` and `approve plan` refuse a story, plan or build spec that still has a line of its
  template word for word (a `<…>` placeholder, an empty table row) and name it; `item check` names the same once the
  file is Approved or later (`placeholder-left`). The check is exact: a line `item new` filled in, or an angle bracket in
  your own text, is not a placeholder; an empty table row is named too. The review, QC and verification templates now carry `**Contract:** 1`.
- **`WF_ITEM_CONTRACT`** (`on` or `off`; absent means off).
- **Documentation of the model choice.** `docs/configuration.md` has a section on choosing a model for each role
  (planner, builder, explorer, reviewer) with the existing `WF_MODEL_CLAUDE_*` keys: it is optional, leaving them empty
  changes nothing, and you can ask your agent to set them for the project. burhan has no effort setting. This is
  documentation of what 0.6.0 already did, not a new setting.

- **Review groups and small commands.** `review add --kind review --unit 1-2` writes the group heading
  (`## Sub-units 1–2 — …`) that `item set unit N reviewed` now reads; `item set <slug> findings concluded` concludes a
  findings file; `item set <slug> plan in-progress --reopen "<why>"` reopens a Completed plan whose QC passed and records
  `Reopened after PASS`; `approve qc` ticks the QC gate; `review add` refuses a sub-unit the plan does not have and a QC
  round that skips one.
- A plan file that lost its `**Contract:** 1` line while the item's other files still have it is named by the turn-end
  audit (otherwise every check would treat it as an old file). The approval report also reads Windows launchers
  (`node dist\cli.js`, `burhan.cmd`) and a quoted slug.
### Changed
- `item set <slug> plan completed` is refused: a plan is completed by `item finish`, which checks the sub-units, the gates,
  the open deviations and the proof. A QC report that has its verdict on the Date line (the template's form) is read by
  `approve qc`, `gate tick`, `item set` and `guide` like one with the verdict on its own line, and an `Accepted by`
  line counts only in the form `<name> · YYYY-MM-DD`.
- `item finish` completes a plan once every sub-unit is Reviewed, every gate before Completed is ticked, no deviation
  is open and the evidence ledger shows a passing proof after the last code edit. QC, the knowledge review and Close-out
  follow Completed, as the lifecycle says. The ledger is written at the end of a turn, so a proof run in the same turn
  is not in it yet: `--evidence "..."` states what shows it, and the plan then says the evidence was stated, not proven.
- The plan template is rewritten (no status or result text is written by the planner; the commands own those lines) and
  there is a new build-spec template. `phases/files.md` says there is no limit on the size of any file and names the
  sections a plan may not delete.
- The README commands table has a row for the new commands (English and Arabic).

### Measured
- On the candidate: `npm test` on Linux (Node, this machine): 1325 Node tests, 1321 passed, 0 failed, 4 skipped; 16 bash test files, 0 failed (docs 175, readme 516, rules 235, templates 322, turn-audit 242); `npm run lint` 0 errors. The packed tarball (`scripts/pack-smoke.mjs`: packed once, installed in an empty folder, `--version` prints 0.7.0; by hand, the installed package also ran the new `deviation` command, which the script itself does not check) passed; the Windows and macOS CI runs are not part of this line.
- Six trials with Haiku on one small task (add `subtract` with a test), three on the 0.6.0 kit and three on this one,
  counted two ways (the checker and the files are in the work item, not in the package). With the new contract
  checker, which the new commands satisfy by construction: 0 faults in the three new runs and 1 in each of the three old
  runs; but two of those three faults are a status word the 0.6.0 template itself gives (`Draft | Approved`), so by the
  old kit's own wording they are not faults. With a ruler read from the 0.6.0 template: with 0.6.0 two plans stayed
  `Approved` while their sub-unit was `Reviewed` and the third left its sub-unit unreviewed; with the new kit all three
  plans were `In progress` with the sub-unit `Reviewed`, and the three runs used 8, 13 and 14 command runs. Against
  that, the new kit's plans kept more unfilled placeholder lines. Not a rescue: the 0.6.0 kit did not reproduce the
  large failure of the real Haiku session this work started from.
- Trials for the executable plan (Haiku and Sonnet were given a plan and a build spec written beforehand for two
  sub-units, `subtract` and `multiply`, and told to execute them; one small task; the scripts and the raw rows are in the
  work item, not in the package). Execution as written: Haiku ran it three times; in the first the spec's code was
  produced exactly, the test was edited before the code in both sub-units, no file outside the spec was touched, no
  deviation was recorded and `item check` ended with no fault; in the other two Haiku built sub-unit 1 (the
  diff the reviewer described matched the spec) and stopped before sub-unit 2 because the `burhan-reviewer` subagent it called (the same model) failed the review
  for want of ledger evidence, which is written only when a turn ends. A Sonnet run was started while the package was being
  rebuilt by another process, so it could not run the commands and is not counted; run again, Sonnet produced the spec's code exactly, ran 41 burhan
  commands, reviewed both sub-units, completed the plan and stopped at the owner's acceptance of the QC. The stop path: in the spec's base the function the spec says to add already existed, so the RED could not fail.
  Haiku twice and Sonnet once stopped, recorded one Deviations row with `deviation add`, left `lib.js` unedited, and
  `guide` ended on "code edits: NOT authorized"; none of them went on to implement. n is 3 for the stop path and 3 to 4
  for execution, one task, two models, prompts that said the owner had approved, reviews by the same model.

### For maintainers (not in the package)
- Each sub-unit that has product code (1 to 7, 10, 11, 12) was reviewed by an independent reviewer; most reviews failed first (prototype keys as statuses, a line
  break in an argument forging a review, `$` patterns in a replacement, an unknown plan status that authorized code,
  approval detection that missed most launchers, a regex that hung on a long run of zeros, a link read as a story, a
  Deviations row that could not be read and so did not stop the work, a QC report in the template's own form that the
  commands misread) and were fixed test-first; fix rounds were
  re-checked by the same session, not by a fresh reviewer.

### Known limits
- A file's `**Contract:** 1` line is what makes the checks judge it: if the line is removed from every file of an item at
  once, the item looks like an old one and stays quiet.
- The deviation check is a heuristic: once any deviation of an item is approved it stops judging edits of the spec and of
  the plan's executable parts for the rest of that item; a plan whose `**Executable parts:**` line was deleted is not
  judged; a table row changed by hand from open to approved is not seen; a launcher the approval report cannot read
  (a variable holding the command) is missed; so is a command with more than 2000 characters between the launcher and `approve`.
- A command can be skipped, and the hooks only warn: a model that ignores the warning is not stopped. Whether Haiku
  obeys a warning, and whether Codex follows the commands, was not measured; Sonnet followed them in one execution run and
  one stop-path run.
- The author of an approval cannot be known. `--by` refuses an agent's name from a list (it also refuses a person
  called "Claude Monet"; look-alike spellings pass), the wording check on your message is a heuristic, and the approval
  report sees the usual launchers of the command, not a script file or an alias, nor every order of its arguments (`approve
  --by A plan x` is missed).
- The trials are one small task, run with Haiku and Sonnet only (no Codex), and in all of them the prompt said the owner had
  approved, so the agent ran `approve` itself; what it would do without that sentence was not tested. The stop-and-record
  path was run by a model three times, always for the same kind of deviation (a spec whose RED cannot fail); a GREEN that
  fails or a file that differs from the spec were not run.
- With no size limit a very large task file is read whole: a 50 MB plan made the turn-end audit take about 16 seconds in
  one measurement, longer than the hook's 15-second timeout, so the audit of that turn is lost (the hooks fail open).
- Whether the agent can run the commands depends on the kit command in `.burhan/bindings.md` being reachable from the
  agent's shell (`npx burhan-kit` needs the network the first time); a desktop app that starts with a short PATH was not
  measured. If the command cannot run, the agent writes the files by hand and the audit flags them.
- The placeholder check compares a file with the project's own `.burhan/templates` (the kit's own when the project has none), looks at the story, the plan, the build spec and a Concluded findings file, and also names a table row whose cells are all empty. The knowledge-review line of a plan is left out on purpose: it is decided after QC.
- macOS and Windows ran in CI only; no agent session was run on them.

## 0.6.0 — 2026-10-27

The installer now refuses to write through a link that leaves your project, and the "done needs proof" check no longer
accepts a command that is only mentioned. Several checks that read a shell command now read the commands it runs, not
the words in it.

### Upgrading from 0.5.0
- Run `npx burhan-kit upgrade --apply` in every project. It refreshes the kit files (the commands, the phase files and
  the hook scripts) and adds no hook entry. Your `workflow.config` and `bindings.md` are kept. Codex was not run: whether
  it asks you to trust the changed hook scripts again is not measured.
- **If a project links part of `.claude/`, `.burhan/`, `CLAUDE.md` or `AGENTS.md` to a place outside the project** (a
  shared settings file, a dotfiles repository), `init`, `upgrade` and `setup` now stop before they write anything and
  list each such file. Pass `--allow-outside-links` to let them write through the link, or remove the link. The
  `--allow-outside-settings` flag of 0.5.0 still works. Without such a link nothing changes.
- A turn that ends with "done" after `echo "npm test"`, or after a verification run with no recorded result, now gets a
  warning. Run the command and show its output.

### Changed
- **Outside links are refused, for every writer.** Before its first write, `init`, `upgrade`, `setup --answers --apply`,
  `setup --set` and the setup wizard check every file they would write, not only the two hooks files as before: the
  hooks files, `CLAUDE.md` and `AGENTS.md` and their backup copies, the managed commands, agents and skills, the files
  of `.burhan` and `.burhan/hooks`, and `.gitignore`. The test is where the write lands, not the link's name; a link
  that stays inside the project needs nothing. The setup summary names these files (English and Arabic) and no longer
  says that nothing outside the project changes. `uninstall` is not changed.
- **A mention is not proof.** The "done needs proof" check tests your evidence pattern against the commands a line
  runs: `echo "npm test"`, a `grep` for those words, a comment or a heredoc body no longer passes as a test run, and
  `burhan evidence` uses the same rule. A command with no recorded result (on Codex: no item in the session record, or no
  exit code) is no longer taken as a pass unless another evidence run passed.
- **A Codex patch path** is resolved against the folder the session runs in when that is a subfolder of the project.
- **The commit check reads commands.** It runs only when `git commit` is a command, not text that mentions it
  (`grep "git commit"`, `echo`, a PR title); it also catches `/usr/bin/git commit`, backticks, `sudo`, `env` and `nice`
  prefixes, shell keywords and a shell's `-c` string. A failing check shows the end of its output, where the error is,
  and stopping the hook stops the check too. A commit hidden behind an alias, a function, `xargs` or `ssh` is not seen.
- **A story, plan or review written through the shell** (`cat > file <<EOF`, `>`, `>>`, `tee`) gets the same skill
  reminder and turn-end check as one written with the edit tools, carried by the Bash hook that is already installed. For a story or plan,
  it warns only when the command created the file, so an append or an overwrite of an existing one does not. The shell-write
  parser keeps reading after a heredoc delimiter with a dash or a dot, ignores a `<<` inside quotes, sees `>& file`, and
  drops a trailing carriage return.
- **The skill check before a write and the one after it read the same memory:** a skill run in an earlier turn, or
  before any item existed, counts, so the turn-end warning no longer blames a skill the agent already used. The
  completion check still needs the verification skill in the same turn. The state-transition warning says when the item
  has no block in the state file.
- **The "you removed a block" check judges only this session's own write of the state file.** A block another session
  removed or added meanwhile is no longer blamed on it, and a whole-file write that would drop a block of a session
  active in the last 24 hours is warned about before it happens.
- **`burhan memory status` and `memory affected` say when a fact is "changed" only because a release file moved**
  (`package.json`, `CHANGELOG.md` or `ROADMAP.md` at the project root): the line ends with `(release file only)`. Nothing
  is hidden and the counts are the same.
- **The kit tells the agent which tests to run:** the ones that relate to the part it changed, chosen from the diff and
  named with the reason, never the whole suite by default; a fix outside those tests adds the tests of its area.
- The docs say plainly that an evidence-ledger session folder holding session files stays until you delete it.

### Measured
- The full test suite on the release candidate (`878e2f9` plus the version and the notes): 1069 Node tests (1065 pass, 4
  skipped, 0 fail) and every shell suite (2047 checks, 0 failed); CI green on Linux, macOS and Windows (no bash) on
  `878e2f9`.
- On the packed 0.6.0 tarball, installed with npm (Linux): `burhan --version` prints 0.6.0; a fresh `init` for both
  agents wires six hooks for each and `burhan doctor` reports 0 fail (one warning: the Codex hooks to trust). A project
  made by the published 0.5.0 package and upgraded keeps its six entries and a hook of your own, and the upgrade leaves
  `.claude/settings.json`, `.codex/hooks.json`, `workflow.config` and `bindings.md` byte-identical; it rewrote 33 other
  files (the commands, the phase files, the hook scripts, the two bootstrap blocks and the version stamp), and a second
  upgrade changes no file; `uninstall` removes only burhan's entries. A `CLAUDE.md` that links outside the project is
  refused by `init` (exit 2, nothing created, the outside file untouched), and written with `--allow-outside-links` or
  with the older `--allow-outside-settings`.

### For maintainers (not in the package)
- A release is one workflow started by a pushed `v*` tag: a guard (tag, branch, not published), the tests on Node 22 and
  24, a pack-and-install check, then publish with npm provenance after an approval. Every GitHub Action is pinned to a
  commit SHA. `docs/releasing.md` in the repository says what stays with the maintainer. The Windows job of CI now also
  runs the guard's link tests where the runner can create a symlink.

### Known limits
- **On Windows, the outside-writes guard may miss a case.** Windows reads `..` after a folder link inside a link target
  as plain text; the guard walks it the way a POSIX system does. In one measured case the guard refuses more than it
  must; a case in which it misses a write that leaves the project is derived from that, not measured. One test of it is
  skipped on Windows for that reason.
- The "done needs proof" match is a heuristic: `git grep`, `xargs echo`, `ssh host npm test`, `tee` and `command -v` still count, a run hidden behind a variable
  or `eval` is missed, and a pattern that spans an operator no longer matches. Codex was checked only against the
  maintainer's own recordings, how often a Codex result is missing at the end of a turn is not measured, and the
  patch-path rule comes from reading the code: no recording shows a patch from a subfolder.
- Not measured: a live agent session on 0.6.0, Codex live, macOS and Windows beyond CI, and the release workflow's first
  real run.

## 0.5.0 — 2026-10-24

With Superpowers installed, burhan now tells the agent which skill to invoke before each phase. Two fixes stop saved
inputs from raising warnings that nobody can act on.

### Upgrading from 0.4.1
- Run `npx burhan-kit upgrade --apply` in every project. It refreshes the kit files and adds one **sixth hook entry**
  (`pre-edit-skill`) to `.claude/settings.json` (a `PreToolUse` entry for `Write|Edit|MultiEdit|NotebookEdit`) and to
  `.codex/hooks.json` (a `PreToolUse` entry for `apply_patch`). Your own hooks stay; a second upgrade changes nothing.
  Your `workflow.config` and `bindings.md` are kept; a project that already sets `WF_SKILLS=superpowers` gets the new
  `Process skills` row only when `setup` is run again.
- In Codex, trust the hooks again afterwards: the upgrade prints a note, and `/hooks` lists what is new or modified
  (the existing entries of `.codex/hooks.json` are byte-identical to 0.4.1's; Codex itself was not run, so which
  entries it asks about is not measured; see [Codex: trust the hooks](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md#codex-trust-the-hooks)).
- Without `WF_SKILLS=superpowers` nothing in your sessions changes: the new entry stays silent.

### Added
- **Skill lines (`WF_SKILLS=superpowers`).** The router adds one line before each prompt, read from the item's own
  files: brainstorming before a story, writing-plans once the story is Approved, test-driven-development while the plan
  is building, systematic-debugging for a bug or an investigation, and verification before the close. It is silent
  for a patch-lane item, a paused or superseded plan, and when several items are open and none is linked.
- **A check before a file is written.** Before a story, plan, review or code file is written without its skill, the
  `pre-edit-skill` hook says so once per session, item and skill (Claude Code and Codex). It never blocks. It skips the
  state file, discoveries, test files, patch-lane turns and subagents.
- **A turn-end check for a completion claim** (`SKILL GATE (verify)`): "done" after work, without the verification
  skill, is flagged; a turn that only edits the state file or discoveries is not.
- `setup` writes the `Process skills` row of `bindings.md`; `burhan doctor` counts six hooks; `burhan stats` shows,
  per item, the skills used in the turns the ledger recorded and the pre-write reminders shown (the router's own skill
  line is not counted).
- `phases/files.md` says what `sources/` holds: originals only. Our own scripts and command logs go to `repro/`; a
  summary of an input is named `<name>-summary` and recorded as a limitation, with the original kept if one exists;
  the story's Sources section lists the files.

### Changed
- **A saved source raises no state or status warning.** A file under `<docs>/<slug>/sources/` (any depth) is dropped
  from the turn's file lists before any turn-end check runs, so it no longer asks for a state-file update, no longer
  trips the stale-status check by quoting a story, and no longer counts as a story, plan, review or code written. An
  item whose slug is `sources` and a file named `sources.md` are still checked.
- **The stale-status check reads only files that carry a status:** markdown directly in the item folder or directly in
  its `reviews/`, and the discoveries. Command output, logs, scripts and notes saved elsewhere in an item folder are
  never judged.

### Measured
- The full test suite on `1c72322`: 793 Node tests (789 pass, 4 skipped, 0 fail) and every shell suite; CI green on
  Linux, macOS and Windows (no bash).
- On the packed 0.5.0 tarball, installed with npm (Linux): a fresh install wires six hooks for Claude Code and six
  for Codex and `burhan doctor` says so; an install made by the published 0.4.1 package, upgraded, gains the one
  entry in each agent, keeps a hook of your own, leaves `bindings.md` and `workflow.config` byte-identical, and a
  second upgrade changes no file; `uninstall` removes only burhan's entries. The installed router and pre-write hook,
  run by hand with `WF_SKILLS=superpowers`, print the skill line once per session, item and skill.

### Known limits
- Not measured: whether an agent in a real session follows the new skill lines. Codex was not run live; its two
  limits (a `patch —` turn is not recognised there, and a subagent's write is not told apart) are in
  `docs/configuration.md`.
- The skill line repeats on every prompt and overlaps the router's keyword hint.
- `burhan evidence --last N` and `--item` count skill records as steps; a skill used in a turn without steps is not in the ledger.
- A relative path in a Codex patch is read against the project root, not Codex's own working directory.
- An unknown `WF_SKILLS` value counts as off, with no `doctor` warning.
- A skill used before any item exists is not remembered, so the first story write can still show the pre-write line once.
- The state-transition warning still fires for any file written in an item folder other than `sources/`.

## 0.4.1 — 2026-10-23

Fixes from a first trial of 0.4.0 on a real project.

### Upgrading from 0.4.0
- Run `npx burhan-kit upgrade --apply`. It refreshes the kit files and creates the empty state file
  `.burhan/local/PROGRESS.md` when it is missing; one that exists is never changed. Your `workflow.config` and
  `bindings.md` are kept. The hook entries in `.claude/settings.json` and `.codex/hooks.json` were byte-identical
  before and after the upgrade (measured on a 0.4.0 install made by the published 0.4.0 package, on Linux), so
  Codex has nothing new to trust; its `/hooks` screen is the reference.

### Added
- **The discovery folder is asked.** `npx burhan-kit` and `setup --agent` ask where side findings (discoveries) go.
  The recommended choice uses a `discovery` folder that already sits next to the work files, else
  `<work files>-discovery`; the wizard names the folder. The answer is saved to `WF_DISCOVERY_DIR` and to the
  discovery row of `bindings.md`. A folder that is, or runs through, a link leaving the project is refused, for the
  work files folder too, and `.git` and `.burhan` are refused in any letter case.
- **The state file always exists.** `init`, `upgrade` and `setup` create `.burhan/local/PROGRESS.md` (or the path in
  `WF_STATE_FILE`) with the four empty sections when it is missing, so "read the state file first" never fails; it is
  git-ignored. When the path cannot be created (outside the project, behind a link, an unwritable folder, or a file
  burhan writes itself) a NOTE says so and nothing is written.
- Close-out rule: one session per item, and a closed item's block in the state file shrinks to one line.
- Review rules: a review starts from the diff, the plan and the ledger; a re-review after findings reads only the
  fix and the findings; a QC re-run after a FAIL is a confirmation round; small short-lane sub-units can share one
  review group.

### Changed
- Setup's final "Step 3" and the first-use reminder say that any first message in a new session starts the project
  setup: the reminder tells the agent to set up the check command first (if it is not set yet), then to present the
  onboarding in the same session. It is a reminder, not a lock. The start was measured once, on Claude Code, with a
  build of this code (the agent began the first-use setup on "hi"); Codex and the published package were not
  measured.
- README: the install section is two parts, one where you run the commands and one where you copy a prompt for your
  agent. The configuration docs say how to write a Windows path in `workflow.config`.

### Known limits
- The limits of 0.4.0 still apply.
- `init --no-bootstrap` also creates the state file.
- Nothing prunes the one-line closed items in the state file except the fold rule in the close-out text.
- The new setup question and the state file were checked on Linux only; Codex and Windows were not run for them.

## 0.4.0 — 2026-10-22

burhan now learns your project once, and the first run is three steps. Versions before 0.4.0 are deprecated:
use 0.4.0 or later.

### Upgrading from 0.3.0
- Run `npx burhan-kit upgrade --apply`. It refreshes the kit files and adds the `/burhan:onboard` command; your
  `workflow.config` and `bindings.md` are kept. The hook entries in `.claude/settings.json` and `.codex/hooks.json`
  are byte-identical to 0.3.0's (measured on a real 0.3.0 install), so Codex has nothing new to trust; its `/hooks`
  screen is the reference.
- Then, in a new session, run `/burhan:onboard` once.
- Installs from 0.2.2 or older: see [upgrading](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/upgrading.md).

### Added
- **Project memory.** `/burhan:onboard` (Codex: say "Follow .burhan/commands/onboard.md") reads the whole project,
  writes a draft of `.burhan/PROJECT.md` and `.burhan/context/`, shows what it covered and what it could not, and
  stops. The baseline is `Approved` or `Waived` only after you decide, with the name you give.
- `burhan inspect [dir] [--json]`: a names-only look at the project (greenfield or brownfield), bounded in depth,
  entries and time.
- `burhan memory check | status | affected --since <ref>`: fact shape, duplicate IDs, merge markers and
  secret-looking text; each fact `fresh`, `changed`, `missing` or `unchecked` from the hashes of the files it cites
  (changed does not mean false); the facts a diff touches. `memory check` exits 1 on a fail, for CI.
- While a project with code has no `Approved` or `Waived` baseline: a reminder on every prompt, a turn-end warning
  (the BASELINE GATE) and a `doctor` warning. Not for greenfield projects, the patch lane, read-only items or the
  onboarding itself. Guidance only, nothing is blocked.
- Setup ends with a titled "Step 3" (a new session, then the onboarding). The Superpowers line says it is optional,
  strongly recommended, never installed by burhan.
- `setup --set` takes `code=`, `test=` and `evidence=` next to `check=`; each pattern is validated before anything
  is saved. `doctor` warns when `WF_CODE_REGEX` is empty after first use, because the "done without proof" warning is
  then off.
- `init` and `upgrade` refuse, and print `OUTSIDE:`, when `.claude/settings.json` or `.codex/hooks.json` resolves
  outside the project, unless you add `--allow-outside-settings`.
- `doctor` reads which burhan hooks Codex has a trust entry for (table names in `~/.codex/config.toml` only, never
  a value) and says so per event; it cannot see "Modified since last trusted" or a disabled hook.
- `burhan evidence` marks a command line with a pipe (its recorded exit is the last command's); `--json` adds
  `"piped": true`.
- README (English and Arabic) rewritten: the promise, the flow, a real recorded run, the features, a three-step
  install, honest limits; new `docs/features.md`, `docs/first-task.md`, `docs/upgrading.md`, `docs/ci-and-windows.md`.

### Changed
- On Claude Code each end-of-turn audit looks only at what is new since the previous Stop of the same prompt, so a
  background agent's wake-up no longer repeats earlier warnings.
- A fix note a reviewer adds to its own review file no longer fires the review SKILL GATE; the code SKILL GATE
  remembers the item's earlier TDD or debugging skill in the same session.
- The prompt router reads "auto mode" and "step mode" after a verb or preposition, in English and Arabic.
- The FIRST USE message and `kit/commands/e2e.md` name `npx burhan-kit …`; a new `bindings.md` carries it in its
  Kit command row.
- The STALE-STATUS check skips `*.log` files. `doctor` names a `WF_*_REGEX` the hooks refuse and why.
- `uninstall --all` works after a plain `uninstall`; project memory stays either way.
- CI runs three jobs, one per system, on Node 24: Ubuntu 24.04, macOS and Windows without bash. Node 22 (the
  minimum) and Windows with Git Bash are no longer run by CI.

### Known limits
- The Codex hook-trust check was observed on Linux with Codex CLI 0.150.1; macOS and Windows are not verified.
- On Codex a finished command may have no recorded exit code, and that counts as passing evidence.
- Windows with PowerShell only, and a real Claude Code or Codex session on Windows, are not verified.
- `init` and `upgrade` still write through a symlink for `CLAUDE.md`, `AGENTS.md`, managed `.claude` files and a
  linked `.burhan`; `setup --set` and `setup --answers --apply` write the hooks file through an outside link without
  the guard.
- A Windows path with backslashes in `workflow.config` is ignored inside double quotes; use single quotes or
  forward slashes (`doctor` reports the line).

## 0.3.0 — 2026-10-19

The hooks now run on Node only. bash and `jq` are no longer needed, and CI runs the hooks on Windows too (see
Requirements for what is and is not verified there).

### Upgrading from 0.2.2
- Run `npx burhan-kit upgrade --apply`. It replaces the bash hooks with the Node hooks in
  `.burhan/hooks/node/`, removes the old `.burhan/hooks/core/` and `.burhan/hooks/adapters/` folders, and
  rewrites every installed agent's hook entries; your own hooks are kept.
- **Codex:** the hook commands changed, so Codex lists them as "Modified since last trusted" and skips
  them silently until you trust them again (`/hooks`, then `t` on each burhan hook).
- Installs from 0.2.1 or older (under `.workflow/`) are still not migrated: uninstall with that version,
  then run `npx burhan-kit`.
- **Going back to 0.2.2:** run `npx burhan-kit uninstall --apply`, then
  `npx burhan-kit@0.2.2 init --agents <your agents> --apply`. Do not run `upgrade` with 0.2.2 on a 0.3.0
  project: it keeps the Node entries and adds the bash ones, so every hook runs twice. `workflow.config`
  and `bindings.md` are kept either way.

### Requirements
- Node ≥ 22 on the PATH the agent starts with. Nothing else: no bash, `jq`, sha256 tool or `timeout`.
- Claude Code ≥ 2.1.139: the Claude Code hooks use the exec form (`node` + args, no shell). There is no
  other hook path for older versions.
- Windows: CI runs the hooks on `windows-latest` with Node 22 and 24, with and without Git Bash. Not
  verified yet: Windows with PowerShell only (no Git Bash), and a real Claude Code or Codex session on
  Windows.

### Changed
- The hooks are a Node program (`node .burhan/hooks/node/main.mjs …`). Their gates, reminders and
  messages are the same as in 0.2.2.
- Measured on one Linux machine, the Node hooks are faster in every case: about 1.4× for the shortest
  hook (the pre-commit check on a non-commit command) and about 5–8× for the turn-end audit, which reads
  the transcript. Not measured on macOS or Windows.
- Behaviour changes:
  - The hooks read only literal config lines (`KEY=value`, `KEY="value"`, `KEY='value'`). A line that
    needs a shell to evaluate (for example `$(…)`) is ignored; `doctor` already reported such lines.
  - `WF_*_REGEX` values go through a POSIX ERE translator instead of `grep -E`. Back-references are not
    supported: a pattern that uses one makes that check stay silent.
  - The hook ledgers and state files are written with mode 0600 (owner only) on Linux and macOS; the bash
    Codex ledger file used to follow the umask.
- `doctor` checks Node ≥ 22 and no longer checks bash, `jq`, a sha256 tool or `timeout`.

### Removed
- The bash hook runtime (`kit/hooks/core/*.sh`, the bash adapters and their snippets).
- `WF_HOOK_RUNTIME`. It never shipped in a 0.2.x release; a leftover `WF_HOOK_RUNTIME=bash` gives a
  `doctor` warning and an `upgrade` note, and any value means Node.
- `WF_TIMEOUT_BIN`. Only the bash hooks read it.

## 0.2.2 — 2026-10-15

### Upgrading from 0.2.1
- The install folder is now `.burhan/` (it was `.workflow/`). Projects installed with 0.2.1 are **not**
  migrated: remove the old install with `npx burhan-kit uninstall` (0.2.1) and run `npx burhan-kit` again.

### Fixed
- The state-transition gate no longer warns when the state file was edited by a shell command; a
  per-turn fingerprint kept outside the project decides, and a turn that did not touch it still warns.

### Changed
- Setup now asks a fourth reviewer/QC question only when both agents are selected, stores `other` (the
  other agent than the one running `/burhan:qc`) or `same`, and improves agent-led folder and
  closing-report guidance. Existing `claude` / `codex` / `same` values keep working.
- Rewrote the English and Egyptian-Arabic READMEs around a concise, verified first-use path for
  GitHub and npm.
- Sessions can link to one in-flight work item for item-specific gates and evidence; `burhan use <slug>`
  queues the link through the turn-end hook, and concurrent state blocks are protected by a warning.
- Unified installs under `.burhan/`, with private work/discovery defaults, scoped ignore rules,
  namespaced `burhan-verify` and project memory.
- Bootstrap blocks use exact `<!-- burhan:start -->` / `<!-- burhan:end -->` delimiters;
  hook ownership uses exact snippet commands, without JSON command markers.
- Existing project hooks always coexist; setup no longer offers hook removal or shared-folder moves.
- Setup offers optional Claude Code Superpowers guidance without installing plugins or overriding
  explicit skills preferences.
- Fresh setup now recommends shared `docs/burhan/work/` for each task's story, plan and reviews, and
  its Superpowers summary distinguishes available, absent, and explicitly disabled plugins.

### Removed
- Removed never-run configuration and setup options, the NEVER RUN gate and turn-audit check C;
  audit labels D–H remain unchanged.
- Removed RAM/resource rules and `WF_SINGLE_TEST_HINT`, including its reminders and setup guidance.

### Compatibility
- Legacy configuration keys are silently ignored, including personal overrides; `doctor` does not
  warn about them and upgrades preserve the user's configuration.
- Removed setup options exit 2 with a short removal error and leave configuration unchanged.

## 0.2.1

### Setup
- `setup` now rejects unknown answer-file fields and incompatible option combinations before writing,
  and accepts the choices it presents, including the combined-agent choice.
- Existing project hooks are listed before approval and can be kept alongside burhan's hooks; burhan
  never removes them. Setup also identifies settings files that resolve outside the project.
- New shared installs put work and discovery files in `docs/burhan/`. Existing shared installs are
  asked first whether to keep their current folder or move to `docs/burhan/`; nothing moves automatically.
- Setup and `doctor` warn when expected committed files are ignored, and setup supplies an access-control
  reminder when a sensitive-path rule has no note.
- Setup guidance now limits agent edits to the project configuration after showing a diff and receiving
  approval, and preserves literal `$` and `\\` characters in quoted configuration values.
- After setup, the summary reminds you to start a new agent session in the project directory.

### Never-run commands
- Never-run command matching now recognises whole commands only at a shell-command start, and custom
  patterns are checked before they are saved.
- Never-run commands are still reported, not blocked. Use your agent's deny rules to block them today;
  burhan blocking is planned for 0.3.

### Docs
- The English and Arabic READMEs now explain the work-item flow: story, plan, reviewed sub-units,
  progress states, progress tracking and final QC.
- Configuration guidance covers new sessions, worktrees and how to block a never-run command with an
  agent's own deny rules.

### Tests (development)
- Node test temporary folders are cleaned up on success and failure.
- Node tests now choose a RAM-aware parallelism level, print it, and allow an explicit override.

## 0.2.0

### Package and CLI
- `burhan setup`: a guided wizard, plus `--agent` for an AI agent and `--answers [--apply]` for
  answer files.
- First use can guide an agent through project checks with `burhan setup --stack` and save those
  settings with `burhan setup --set`.
- `burhan uninstall [--apply] [--all]`: preview removal by default, then remove burhan-managed
  files while keeping your settings and work files unless `--all` is chosen.
- Running `npx burhan-kit` in a terminal opens the setup wizard.
- Adds the first runtime dependency, `@clack/prompts`, and uses `@types/node` `^22` for development.

### Hooks
- Issue #1 fixed: the story and plan are one approval gate even though they are two files.
- Groundwork for a future Node hook runtime is included, but it is not used yet.

## 0.1.0

The first release of **burhan-kit**: a technology-neutral working agreement and hook kit for AI coding
agents (Claude Code, Codex). No "done" without proof.

### Package and CLI
- Requires Node ≥ 22 (CI runs Node 22 and 24).
- `burhan init` / `burhan upgrade`: install or refresh the kit in any project (dry run by default,
  `--apply` to write). Team-safe layout: shared rules in `.workflow/`, each developer's state file
  and overrides in the git-ignored `.workflow/local/`.
- `burhan status [--write]`: the work-item index, generated from the item files.
- `burhan stats`: routes, QC verdicts, self vs independent QC and review, escaped defects, phase
  timing, file sizes.
- `burhan evidence`: the evidence ledger — every command with its exit code, in order, per turn.
- `burhan changed --item <slug>`: files changed since the commit a story's facts were verified at.
- `burhan doctor`: read-only health check of runtime, install, config (missing and unknown keys),
  hook wiring, Codex hook trust, and the state file; jq ≥ 1.6 is checked.
- `burhan pr-body --item <slug>`: a pull-request description built from the item's files.
- Agent-guided setup: `.workflow/SETUP.md` walks the agent through discovering the build, test and
  lint setup (read-only), proposing `workflow.config` values with file:line evidence, asking only
  business questions, writing the config after approval, and proving it with the check and `doctor`.
- A dry run that cannot write a path (an agent's sandbox) still shows the whole plan and names what
  would block `--apply`.

### Working agreement
- A lean core (`WORKFLOW.md`, ≤ 1,600 words) with phase files loaded when needed; every rule has a
  key phrase checked in its file (`tests/rule-inventory.txt`).
- Routing by type × scope, with scope escalators; a `patch` lane for one obvious change.
- Two autonomy modes per item: `step` (stops after every sub-unit) and `auto` (story and plan once,
  brakes, the commit always stops). "Plan only" is a stopping point that closes the item at `Plan ready`.
- Independent QC: a fresh subagent (`burhan-reviewer`) or the other agent (`WF_REVIEWER_AGENT`), with
  the provenance recorded and counted.
- Fields read by hooks and stats have one exact form (`phases/files.md` · Fields).

### Hooks (Claude Code and Codex)
- Run on jq ≥ 1.6 (checked in CI on 1.6, 1.7.1 and the current release) and under any locale (they
  switch to an installed UTF-8 locale to match Arabic text). If the Codex ledger record cannot be built,
  a minimal record of the call is kept, marked `"record": "minimal"`.
- Session gates, prompt routing hints, pre-commit check, post-edit reminder and a turn audit
  (verification evidence, state file, forbidden commands, state size, skills, read-only work, QC
  provenance).
- The evidence ledger records each edit and command with its exit code, including a Claude Code
  subagent's own steps.
- Optional role agents per phase (`WF_MODEL_CLAUDE_*`).

### Known limits and plans
See [docs/configuration.md](docs/configuration.md#known-limits) and [ROADMAP.md](ROADMAP.md).
