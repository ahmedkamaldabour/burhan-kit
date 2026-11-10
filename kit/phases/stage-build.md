# Stage — build, review and modes
> Part of the burhan working agreement (core: `.burhan/WORKFLOW.md`). **Read this when:** the plan is approved and you build, review or pause between sub-units, or the approved intent changes.

## The build step
- **Plan approved** → re-validate it against the current code (facts drift): the kit command's `changed --item
  <slug>` (e.g. `npx burhan-kit changed --item <slug>`) lists what changed since the story's **Verified at commit**; re-check only those (no
  sha → every fact). Then step 3.

```
  ④  BUILD  (T)  Re-validate the plan against current code before the first sub-unit.
                 Per sub-unit: failing test → smallest change → green → fast check.
                 A problem whose answer is already known is class A: fix it at once, record it with `burhan deviation add --apply`, and go on (A problem found while building, below).
                 Follow the approved plan and build spec exactly. A step that fails unexpectedly means STOP: record it in the plan's Deviations
                 table (`burhan deviation add`), ask the owner, and only an approved deviation changes the plan and spec first, then the code.
                 That STOP is for a decision (class B); a problem whose answer is already known (class A) is fixed, recorded with `--apply` and reported (Modes below).
                 Never build the whole item in one go. Pause between sub-units (`step` mode; Modes below).
                 A plan that no longer matches the code is worse than none — update it.
```

## 3) Build — one sub-unit at a time, never the whole item (routes with **T**)

For the next unimplemented sub-unit only:
- **Who builds it:** if `.claude/agents/burhan-builder.md` exists (the project set `WF_MODEL_CLAUDE_BUILDER`
  to build on a cheaper model), **delegate this sub-unit to the `burhan-builder` subagent** — give it the
  plan path and the sub-unit number only — **in the foreground: wait for its report** (never launch it in
  the background, never touch the item's files while it works — two writers on one sub-unit is a race),
  then check its reported commands and output yourself before moving on. Otherwise build it here, as below. (Planning goes to `burhan-planner` and exploration to
  `burhan-explorer` the same way, when they exist.)
- **Scope discipline:** build exactly what the item asks; anything extra is surfaced, not baked in.
- **Test first:** write the failing test, run it, see it fail for the right reason → smallest change
  → green → the fast check.
- **Which tests to run:** after each sub-unit run the tests that relate to the part you changed, which you pick from the diff and name with the reason, then the fast check; never the whole suite by default (a large project's suite can take hours: the project's own full-suite command in `bindings.md`, or its CI, covers it). A fix that lands outside those tests adds the tests of the area it touches.
- **First classify a step that fails unexpectedly:** a problem whose answer is already known is class A: fix it, record it with `burhan deviation add … --apply "<why no decision is needed>"` and go on; only a class B problem means STOP (A problem found while building, below).
- **Follow the plan exactly:** the files, the code, the order and the commands of the approved plan and build spec, nothing more. A step that fails unexpectedly (a RED that does not fail as the spec says, a GREEN that fails, a file that differs from what the spec expects) means STOP: record a row in the plan's Deviations table (`burhan deviation add`), ask the owner, and an approved deviation updates the plan and the spec first, then the code. While a deviation is open, `burhan guide` says code edits are not authorized. That STOP is for a class B problem, which needs a decision; a class A problem is fixed at once, recorded with `burhan deviation add --apply "<why no decision is needed>"` and reported, and the build goes on (Modes below · A problem found while building).
- **In short:** only its test files, then the fast check; the full suite at QC, before a commit, or when a fix lands outside the covered tests. A passing full run is reused (phases/stage-finish.md · Reusing a full run).
- A failure you didn't expect: before calling it a regression, re-run the same check on a clean copy of the commit your work started from
  (`git worktree add <a temporary folder> <that commit>`; install what the check needs there; `git worktree remove` it afterwards); never stash, reset or check out over your working tree.
- Update the sub-unit status (🔵 → 🟢) in the plan and the state file — every transition, as it
  happens.

## 4) Review the sub-unit

- An independent review of the sub-unit's diff against `.burhan/phases/review.md` (security first), in a fresh
  context where feasible (Claude Code: the `burhan-reviewer` subagent, given only the paths; wait for its
  report before the next sub-unit). Give it the changed files of the diff range (`git diff --name-only <range>`)
  and read the lean-start and reading rules in `phases/review.md`. Record
  **Performed by** in the review file, in the exact form of phases/files.md · Fields.
- Besides the paths, give the reviewer the build's commands with their exit codes, word for word as the
  build reported them: a review in the build's turn cannot read them from the ledger yet
  (`phases/review.md` · When the ledger cannot show the sub-unit yet).
- A sub-unit the approved plan puts in a review group (`Review group: <letter>`) is reviewed with its group
  (`phases/review.md` · Review groups): one section, after the group's last sub-unit; they stay 🟢 until then.
  The wait for the report below applies at the group's last sub-unit.
- Add the sub-unit's section to `reviews/<slug>-review.md` (from `templates/review.md`): a **short**
  checklist when it touches nothing sensitive and no scope escalator, the **full** review otherwise
  (`.burhan/phases/review.md` · Sized by risk).
- Fix in-scope findings; carry the rest forward (`.burhan/phases/discoveries.md` for anything out of scope). The owner decides every finding before the finish: `burhan guide` puts the open ones as one question, `burhan finding list <slug>` shows them (`.burhan/phases/review.md` · Findings are decided before the finish). A finding inside the item's scope is class A: fix it at once, whatever its severity, without asking; the owner decides its row afterwards, once.
- Re-run the affected tests (the tests that relate to the part you fixed, plus those of any area the fix touches outside them) and the fast check after fixes. Show the output.

## 5) Between sub-units

Report what changed (files, real test output, review outcome), update the plan (🟢 → ✅; a review
group's sub-units together, so a group member that is not the last one is reported without a review
outcome and stays 🟢) and the state file. Then, in `step` mode, **STOP for the human before the next sub-unit**; in `auto`, go on
unless a brake fires.

**Commit checkpoint — never on your own judgment.** Show `git status` / diff and ask: (a) commit
now, (b) keep going and commit later, (c) the human commits. "Finish the sub-unit" is not
permission to commit. Push or open a pull request only when the human asks (phases/close-out.md).

## Modes — where the flow stops for the human

A mode is a **gate in burhan's flow, not the agent's permission mode** — the vendor's permission or
approval settings stay whatever the human chose.

| Mode | In plain words | Stops at |
|---|---|---|
| `step` (default) | "wait for my approval" | story · plan · after **every** sub-unit · commit |
| `auto` | "carry on on your own" | story and plan **once** (one gate on bounded routes) · brakes · commit |

**The route sets how many stops** the item has, by its risk — not the mode; the mode only decides
whether the build pauses between sub-units. **Plan only** is a stopping point, not a mode: when the
human asks for the plan only, stop after the plan is approved, close the item at `Plan ready`, and
write no code.

- Ask for the mode at the start of each item (the default comes from `WF_MODE_<TYPE>_<SCOPE>`, else
  `WF_MODE_DEFAULT`, else `step`); record it as **Mode** in the story and the state file's `Now`.
- The human switches it any time in plain words ("go end to end" / "كمّل لوحدك" → `auto`; "wait for
  my approval" / "استنى موافقتي" → `step`); write the switch to the state file.
- **Which problems brake `auto`:** a class B problem only; a class A problem is fixed, recorded with `--apply` and the build goes on (A problem found while building, below).
- **Brakes — `auto` falls back to asking when:** a scope escalator appears mid-work · an out-of-scope
  discovery · the plan must change · the same test fails twice in a row · an irreversible action.
- **Which brakes fire:** the brakes above stop `auto` for a class B problem only; a class A problem never brakes (A problem found while building, below).
- **The commit checkpoint always stops**, in every mode. "Who verifies?" is asked once, at the start,
  in `auto`.

## A problem found while building: class A or class B

The class decides whether the owner is asked; the mode decides only where the build pauses. When in doubt, a problem is class B.

**Class A — no decision is needed.** The list is closed:
- a review finding of any severity, a Critical included, inside the item's scope, whose fix keeps the approved story, acceptance criteria and behaviour;
- a mismatch between the plan or build spec text and the code or an older test, fixed by editing the plan or spec text (a count, a wording, a placement), never by editing a test that existed before the item and never by changing behaviour;
- a bug found while building, inside the scope, fixed after a failing test is written first.

The agent fixes a class A problem at once, without asking, records it with `burhan deviation add <slug> --unit N --what … --where … --output … --apply "<why no decision is needed>"`, reports it, and the work goes on: in `auto` the build continues, in `step` the sub-unit continues and the build stops at its end as always. The row is `applied`: the agent's own claim, with no owner's name, and `burhan guide` and `burhan item finish` list it for the owner. The owner's decision on a finding's row is still asked once, as one question, when every sub-unit is reviewed.

**Class B — a decision is needed.** Everything else: a change of the approved intent, acceptance criteria or scope; a choice among real options; security, data, money or anything irreversible; editing a test that existed before the item; a change of behaviour; a finding outside the item's scope. The agent records it with `burhan deviation add` without `--apply` and asks the owner: in `step` mode at the end of the sub-unit, in `auto` mode it stops there and waits for the answer, then goes on.

A security, data or money problem is class B even inside the item's scope, and a problem that fits both lists is class B.

The brakes of `auto` are class B only: "the plan must change" and "the same test fails twice in a row" stop it only when the cause is class B. A finding outside the item's scope is a discovery: when the plan's "Decisions taken at approval" says what it becomes, `auto` writes it (`.burhan/phases/discoveries.md`) and goes on; when it does not say, ask.

## When the intent changes mid-flight

If the approved intent changes (new source, changed AC, answered question that alters scope) after
the story was approved: record an **impact entry** in the plan's *Impact log* — for each completed
phase, *affected* or *unaffected* with a reason — then revise only the affected phases. Evidence is
never deleted; superseded results are marked, not erased. Convergence findings on changed AC are
stale and must be re-assessed.
