# Lifecycle of a work item
> Part of the burhan working agreement (core: `.burhan/WORKFLOW.md`). **Read this when:** you take in a request, write a story or a plan, or the approved intent changes.

## The lifecycle of one work item

Work **one item at a time, end to end**, unless told otherwise. The route (core §3) decides which
steps apply.

```
  ①  INTAKE      Read the request fully; restate it. Classify type + scope + reason.
                 Preserve material inputs as sources (phases/files.md). Order dependent items so that
                 whoever produces data comes before whoever consumes it.
                              │
  ②  STORY  (S)  templates/story.md — job story, acceptance criteria with IDs and
                 provenance (copied from the source of truth, not paraphrased), business rules, open questions, codebase verification
                 (file:line), proposed sub-units. Too big for one plan → propose a split (below).
                        ⛔ STOP — explicit approval
                              │
  ③  PLAN   (P)  templates/plan.md and templates/build-spec.md — re-verify the story's facts against the CURRENT code
                 (what the story got wrong, with file:line), options + recommendation, rulings, the AC → test coverage, the
                 executor rules; the build spec holds, per sub-unit, the files, the complete test, the RED and GREEN commands
                 with their expected output, the complete code and the interfaces. An open material question blocks approval. A template placeholder left in the story, the plan or the build spec blocks it too (`approve` names it).
                        ⛔ STOP — explicit approval
                              │
  ④  BUILD  (T)  Re-validate the plan against current code before the first sub-unit.
                 Per sub-unit: failing test → smallest change → green → fast check. After each sub-unit
                 run the tests that relate to the part you changed, which you pick from the diff and name with the reason, then the fast check; never the whole suite by default (a large project's suite can take hours: the project's own full-suite command in `bindings.md`, or its CI, covers it). A fix that lands outside those tests adds the tests of the area it touches.
                 In short: only its test files, then the fast check; the full suite at QC, before a commit, or when a fix lands outside the covered tests.
                 Follow the approved plan and build spec exactly. A step that fails unexpectedly means STOP: record it in the plan's Deviations
                 table (`burhan deviation add`), ask the owner, and only an approved deviation changes the plan and spec first, then the code.
                 Never build the whole item in one go. Pause between sub-units (`step` mode; Modes below).
                 A plan that no longer matches the code is worse than none — update it.
                              │
  ⑤  REVIEW (R)  Independent review of each sub-unit's diff (phases/review.md) →
                 a section in reviews/<slug>-review.md (short or full, by risk).
                 How much it reads, re-reviews and review groups: phases/review.md.
                 Fix in-scope findings; track the rest.
                              │
  ⑥  VERIFY (V)  Real end-to-end check as the verification identity.
                 ⚠ ASK FIRST who performs it (core §4-A). → reviews/<slug>-verification.md
                              │
  ⑦  QC     (Q)  Adversarial pass + convergence: every AC → satisfied / partial / missing /
                 contradicts, plus unrequested behaviour. → reviews/<slug>-qc.md · PASS / FAIL
                 Run in a fresh context (core principle 8).
                              │
  ⑧  KNOWLEDGE (K)  Propose durable learnings → promote / reject, or record "none" (phases/memory.md).
                              │
  ✅  CLOSE-OUT  Only after the gates the route requires. Update the state file (core §5, phases/close-out.md).
```

**Definition of done** = every gate the route requires is ticked in the plan's *Gate checklist*.

**Tests passing is not the finish line.** A happy-path check is the most common way defects reach
QA — that is why ⑥ and ⑦ exist.

## The commands own the item files
Make and change an item's files with burhan's commands (the kit command in `.burhan/bindings.md`), so their shape is always the one the checks read:

| Step | Command |
|------|---------|
| start an item | `item new <slug> --type <t> --scope <s>`: the story, plan or findings from the templates with `**Contract:** 1`, and the item's block in Now |
| where am I, what next, may I edit code | `guide [slug]` |
| the owner approved a story, plan or QC | `approve story\|plan\|qc <slug> --by <owner's name>` (a plan is approved together with its build spec): only after the owner said yes in this conversation, never with your own name |
| a sub-unit moves on | `item set <slug> unit <N> in-progress\|implemented\|reviewed`: one rung at a time; Reviewed needs its review section |
| a gate is met | `gate tick <slug> <gate> [--evidence "…"]` |
| a review, QC or verification | `review add <slug> --kind review\|qc\|verification --by "<agent · model · context>"` (a review needs `--unit <N>`, a QC needs `--verdict`) |
| a step deviated from the plan | `deviation add <slug> --unit N --what … --where … --output …`: an open row in the plan's Deviations; the executor STOPS. The owner's decision: `deviation resolve <slug> <n> --approved\|--rejected --by <owner's name>` |
| the plan is done | `item finish <slug>`: every sub-unit Reviewed, the gates before Completed ticked, a passing proof after the last code edit |
| anything looks off | `item check <slug>` names every fault |

Writing the prose of a story or plan by hand is normal. Creating a file by hand, or editing a status or a gate line by hand, is the fallback: with `WF_ITEM_CONTRACT=on` the turn-end audit flags a file you wrote directly that breaks the contract or was created by hand without `**Contract:** 1`, and code edited while `guide` says "NOT authorized". The commands refuse a wrong step and say why; they never replace the owner's decisions.

## Read-only work

**Read-only work (investigation, bug + spike).** Question → evidence → findings → limitations →
conclusion. **No application code is modified.** "Don't change application code" is not "write
nothing": the work item's own docs, discovery files and the state file may still be written. When
the human asks for a fully read-only pass, write nothing at all and report what would be recorded.
Output: `<slug>-findings.md` from `templates/findings.md`. Mark the item `**Read-only:** yes` in the
state file (core §5). To implement a finding, open a new routed item.

## Working methods

exploration → specification → test-first implementation → systematic debugging → review →
verification. Name which one you are in (core §8).

## The patch lane

For one obvious change (core §3 · `patch`). The state file records it as a `Now` entry
`### <slug>` with `- **Route:** <type> / patch` — or not at all when it is committed in the same turn. A patch that grows (an
escalator, a sensitive path, a second concern, any doubt) is promoted to `bounded` at once, and the
promotion is **said out loud** in the reply.

## Re-validation by diff

The story's *Codebase verification* records **Verified at commit** (the sha at which its facts were
checked). Before the plan, and again before the first sub-unit, run `burhan changed --item <slug>`:
re-check only the facts whose files it lists, and write the list — or "no change since <sha>" — in the
plan. No sha, or a sha that is not a commit here → re-check every fact.

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

## Decision card — the first lines of a story and a plan

The first lines of `<slug>-story.md` and `<slug>-implementation-plan.md`, down to the first blank line, are a **decision card**:
what changes, the files it touches, the risks, the route, and the **decisions needed from the human**.
Present the card at the ⛔ STOP; **approval is given on the card** — the rest of the file is the
evidence behind it, read only when the human wants to.

## Questions — one round

Ask **all open questions together, once**, as a numbered list (`Q-1`, `Q-2`, …) in the story — never
trickle them across turns. An answer that changes scope is an intent change (below).

## When the intent changes mid-flight

If the approved intent changes (new source, changed AC, answered question that alters scope) after
the story was approved: record an **impact entry** in the plan's *Impact log* — for each completed
phase, *affected* or *unaffected* with a reason — then revise only the affected phases. Evidence is
never deleted; superseded results are marked, not erased. Convergence findings on changed AC are
stale and must be re-assessed.

## Decomposition

An item too large for one plan becomes a **parent** with **children**, each its own folder and
route. Each child lists the parent's AC IDs it answers for and its `depends on` siblings. The parent
is done only when every required child is done. **Language rule:** a child reaching done is
reported as "child X done, N/M children complete" — never as "project done".

## Readiness is not stage

An item may legitimately stop before implementation: **Spec ready** (story approved, nothing
planned), **Plan ready** (plan approved, nothing built). Reaching either never by itself authorizes
code changes. Both are valid close-out states (phases/close-out.md).
