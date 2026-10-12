---
description: Drive one work item end to end — route, story, plan, build sub-unit by sub-unit (test-first), review — following .workflow/WORKFLOW.md
argument-hint: <slug>, or a short title if the item does not exist yet
---

You are running the **per-item end-to-end** workflow for: **$ARGUMENTS**

The authoritative process is `.workflow/WORKFLOW.md` — follow it; this command only sequences it.
Project values (docs location, state file, check and test commands, forbidden commands) come from
`.workflow/bindings.md` (WORKFLOW §1) and `.workflow/workflow.config`. **Never invent a command.**

If `$ARGUMENTS` is empty, ask which item to work on and stop.

## 1) Assess where we are — report before doing anything

- Read the state file first. A hook's finding in the context is explained in
  `.workflow/phases/enforcement.md`.
- Does `<docs>/<slug>/` exist? Try `$ARGUMENTS` as a slug (kebab-case a title).
- If it exists, read `<slug>-story.md`, `<slug>-implementation-plan.md` or `<slug>-findings.md`, and
  everything in `reviews/`. **Cross-check against the actual code** — don't trust status markers
  alone.
- Print a short status: route (type / scope), which gates are done, sub-units done / in progress /
  to do, open questions, the *Primary objective*.

**The mode decides where you stop** (`.workflow/phases/lifecycle.md` · Modes): read `Mode:` from the
item's block in the state file (ask at the start if unset; exact forms: phases/files.md · Fields). `step` pauses after every sub-unit; `auto` runs the
sub-units without pausing until a brake or the commit checkpoint. "Plan only" is a stopping point, not a
mode: stop after the plan is approved, close the item at `Plan ready`, write no code.
The commit checkpoint always stops. **Brakes** — `auto` falls back to asking on: a scope escalator
mid-work · an out-of-scope discovery · a plan change · the same test failing twice in a row · an
irreversible action. In `auto`, ask "who verifies?" once at the start, with the mode.

**Role agents** (Claude Code, when `.claude/agents/burhan-*.md` exist — generated from
`WF_MODEL_CLAUDE_*`): story/plan → `burhan-planner`; exploration → `burhan-explorer`; each sub-unit →
`burhan-builder` (give it the plan path and the sub-unit number — the plan is the hand-off); reviews →
`burhan-reviewer`. Without them, do the phase here. Approvals, the commit checkpoint and the human's
decisions never move into a subagent.

**The route decides the steps.** Look up the item's row in the routing matrix (WORKFLOW §3) and run
only the gates it lists, in the order it lists them — skip every gate the route does not include
(e.g. a bounded refactor has no story; a release has no test-first build and verifies before it is
reviewed).

## 2) Branch on state

- **No item yet** → intake (.workflow/phases/lifecycle.md ①): restate the request, **classify type + scope + one-line
  reason** (§3, including scope escalators), preserve material inputs under `sources/`. Discover
  before asking — question the human only about business ambiguity.
  - **Read-only route** (investigation, bug + spike) → write `<slug>-findings.md` from
    `templates/findings.md`; mark `**Read-only:** yes` in the state file; never modify application code.
    Finish with the conclusion and, if code should change, propose a new routed item. Then run the
    knowledge review (.workflow/phases/memory.md) and the close-out (.workflow/phases/close-out.md) with state `Done (no QC)` — onboarding a repository
    instead stops for the human to approve the baseline. Stop.
  - Route includes **S** → write `<slug>-story.md` from `templates/story.md`.
  - Route says **S+P** → one approval gate, two files: write both `<slug>-story.md` and
    `<slug>-implementation-plan.md` from their templates (the plan as in the plan step below), present
    them together and stop once. The approval covers both: the story's **Status** and the plan's
    **Overall status** become `Approved`.
  - Which files an item has, and their length caps: `.workflow/phases/files.md`.
  - Route starts at **P** (refactor, release) → skip the story; go to the plan step below. Too big for one plan → propose a split into a parent and children
    (.workflow/phases/lifecycle.md · Decomposition). **Present it and STOP for approval.**
- **Story approved (or no story on this route), no plan** → investigate the real code (cite file:line), re-verify the story's
  facts, then write `<slug>-implementation-plan.md` from `templates/plan.md`. An open *material*
  question blocks approval. **Present it and STOP for approval.**
- **Plan approved** → re-validate it against the current code (facts drift): `burhan changed --item
  $ARGUMENTS` lists what changed since the story's **Verified at commit**; re-check only those (no
  sha → every fact). Then step 3.

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
- Run **only this sub-unit's test file(s)**, one at a time. Never anything on the forbidden list.
- A failure you didn't expect: before calling it a regression, stash the change and re-run the same
  check on a clean baseline.
- Update the sub-unit status (🔵 → 🟢) in the plan and the state file — every transition, as it
  happens.

## 4) Review the sub-unit

- An independent review of the sub-unit's diff against `.workflow/phases/review.md` (security first), in a fresh
  context where feasible (Claude Code: the `burhan-reviewer` subagent, given only the paths; wait for its
  report before the next sub-unit). Record
  **Performed by** in the review file, in the exact form of phases/files.md · Fields.
- Add the sub-unit's section to `reviews/<slug>-review.md` (from `templates/review.md`): a **short**
  checklist when it touches nothing sensitive and no scope escalator, the **full** review otherwise
  (`.workflow/phases/review.md` · Sized by risk).
- Fix in-scope findings; carry the rest forward (`.workflow/phases/discoveries.md` for anything out of scope).
- Re-run the affected single-file tests and the fast check after fixes. Show the output.

## 5) Between sub-units

Report what changed (files, real test output, review outcome), update the plan (🟢 → ✅) and the
state file. Then, in `step` mode, **STOP for the human before the next sub-unit**; in `auto`, go on
unless a brake fires.

**Commit checkpoint — never on your own judgment.** Show `git status` / diff and ask: (a) commit
now, (b) keep going and commit later, (c) the human commits. "Finish the sub-unit" is not
permission to commit. Push or open a pull request only when the human asks (phases/close-out.md).

## 6) Item-complete verification (when the route includes V)

Release routes verify **before** their review; every other route verifies after the sub-units are
reviewed. When the work is ready: **first ask whether the human performs the verification or wants the
agent to** (in `auto`, use the answer given at the start). If the agent does it, use the verification identity from §1, check every acceptance
criterion, and record every run — failed ones included — in `reviews/<slug>-verification.md` from
`templates/verification.md`. Point the state file at the report (pointer only). Set the plan to
**Completed**. Then:
- Route includes **Q** → suggest `burhan:qc $ARGUMENTS` (it runs the knowledge review and the
  close-out).
- No **Q** → if the route includes **K**, run the knowledge review now (.workflow/phases/memory.md: propose with evidence;
  the human promotes or rejects; or record "none"). Then the close-out (.workflow/phases/close-out.md) with state
  `Done (no QC)`.

Record any small unrequested tweak in the plan under "Out-of-scope changes".

**Escaped defects (counted by `burhan stats`).** A bug whose cause is an item that already passed QC
names it in the bug story's **Escapes** line. An item reopened after its QC PASS gets the date and the
reason in its plan's **Reopened after PASS** line.
