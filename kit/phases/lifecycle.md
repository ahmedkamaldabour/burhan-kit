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
  ③  PLAN   (P)  templates/plan.md — re-verify the story's facts against the CURRENT code,
                 options + recommendation, rulings, files to touch, tests per sub-unit,
                 verification steps. An open material question blocks approval.
                        ⛔ STOP — explicit approval
                              │
  ④  BUILD  (T)  Re-validate the plan against current code before the first sub-unit.
                 Per sub-unit: failing test → smallest change → green → fast check. After each sub-unit
                 run the tests that relate to the part you changed, which you pick from the diff and name with the reason, then the fast check; never the whole suite by default (a large project's suite can take hours: the project's own full-suite command in `bindings.md`, or its CI, covers it). A fix that lands outside those tests adds the tests of the area it touches.
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

The first ≤ 10 lines of `<slug>-story.md` and `<slug>-implementation-plan.md` are a **decision card**:
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
