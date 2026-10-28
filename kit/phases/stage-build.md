# Stage — build, review and modes
> Part of the burhan working agreement (core: `.burhan/WORKFLOW.md`). **Read this when:** the plan is approved and you build, review or pause between sub-units, or the approved intent changes.

## The build step
- **Plan approved** → re-validate it against the current code (facts drift): the kit command's `changed --item
  <slug>` (e.g. `npx burhan-kit changed --item <slug>`) lists what changed since the story's **Verified at commit**; re-check only those (no
  sha → every fact). Then step 3.

```
  ④  BUILD  (T)  Re-validate the plan against current code before the first sub-unit.
                 Per sub-unit: failing test → smallest change → green → fast check.
                 Follow the approved plan and build spec exactly. A step that fails unexpectedly means STOP: record it in the plan's Deviations
                 table (`burhan deviation add`), ask the owner, and only an approved deviation changes the plan and spec first, then the code.
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
- **Follow the plan exactly:** the files, the code, the order and the commands of the approved plan and build spec, nothing more. A step that fails unexpectedly (a RED that does not fail as the spec says, a GREEN that fails, a file that differs from what the spec expects) means STOP: record a row in the plan's Deviations table (`burhan deviation add`), ask the owner, and an approved deviation updates the plan and the spec first, then the code. While a deviation is open, `burhan guide` says code edits are not authorized.
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
- A sub-unit the approved plan puts in a review group (`Review group: <letter>`) is reviewed with its group
  (`phases/review.md` · Review groups): one section, after the group's last sub-unit; they stay 🟢 until then.
  The wait for the report below applies at the group's last sub-unit.
- Add the sub-unit's section to `reviews/<slug>-review.md` (from `templates/review.md`): a **short**
  checklist when it touches nothing sensitive and no scope escalator, the **full** review otherwise
  (`.burhan/phases/review.md` · Sized by risk).
- Fix in-scope findings; carry the rest forward (`.burhan/phases/discoveries.md` for anything out of scope).
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
- **Brakes — `auto` falls back to asking when:** a scope escalator appears mid-work · an out-of-scope
  discovery · the plan must change · the same test fails twice in a row · an irreversible action.
- **The commit checkpoint always stops**, in every mode. "Who verifies?" is asked once, at the start,
  in `auto`.

## When the intent changes mid-flight

If the approved intent changes (new source, changed AC, answered question that alters scope) after
the story was approved: record an **impact entry** in the plan's *Impact log* — for each completed
phase, *affected* or *unaffected* with a reason — then revise only the affected phases. Evidence is
never deleted; superseded results are marked, not erased. Convergence findings on changed AC are
stale and must be re-assessed.
