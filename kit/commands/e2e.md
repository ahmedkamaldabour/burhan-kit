---
description: Drive one work item end to end — route, story, plan, build sub-unit by sub-unit (test-first), review — following .burhan/WORKFLOW.md
argument-hint: <slug>, or a short title if the item does not exist yet
---

You are running the **per-item end-to-end** workflow for: **$ARGUMENTS**

The authoritative process is `.burhan/WORKFLOW.md` — follow it; this command only sequences it.
Project values (docs location, state file, check and test commands) come from
`.burhan/bindings.md` (WORKFLOW §1) and `.burhan/workflow.config`. **Never invent a command.**

If `$ARGUMENTS` is empty, ask which item to work on and stop.

Run the kit command's `use <slug>` first (`.burhan/bindings.md` · Kit command, e.g. `npx burhan-kit use <slug>`), before assessing or editing the item. It validates the selected
in-flight block; the turn-end hook writes this session's external link.

## 1) Assess where we are — report before doing anything

- Read the state file first. A hook's finding in the context is explained in
  `.burhan/phases/enforcement.md`.
- Does `<docs>/<slug>/` exist? Try `$ARGUMENTS` as a slug (kebab-case a title).
- If it exists, read `<slug>-story.md`, `<slug>-implementation-plan.md` or `<slug>-findings.md`, and `reviews/` by need: the QC and verification reports in full, and of the review file its headings, the sections of sub-units not yet Reviewed and the latest fix round; open a closed section only when a finding of it is named or the plan says so (QC reads everything). **Cross-check against the actual code** — don't trust status markers
  alone.
- Print a short status: route (type / scope), which gates are done, sub-units done / in progress /
  to do, open questions, the *Primary objective*.

**The mode decides where you stop** (`.burhan/phases/stage-build.md` · Modes): read `Mode:` from the
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

Read the stage file for the state the item is in, and only that one (WORKFLOW §9):

- **No item yet** → `.burhan/phases/stage-story.md` (intake, the route, the story).
- **Story approved (or no story on this route), no plan** → `.burhan/phases/stage-plan.md` (the plan and the build spec).
- **Plan approved** → `.burhan/phases/stage-build.md` (re-validate, then build, review and pause, one sub-unit at a time).
- **Every sub-unit reviewed** → `.burhan/phases/stage-finish.md` (verification, then QC or close-out).

At every stage make and change the item's files with the kit's commands (`item new`, `item set`, `gate tick`, `review add`, `approve`, `deviation`, `item finish`, `guide`): the table and its rules are in `.burhan/phases/stage-plan.md` · The commands own the item files.

A release verifies before it is reviewed: read `.burhan/phases/stage-finish.md` (verification) before the review in `.burhan/phases/stage-build.md`.

The route decides which of these steps the item has (the paragraph above); the lifecycle overview is `.burhan/phases/lifecycle.md`.
