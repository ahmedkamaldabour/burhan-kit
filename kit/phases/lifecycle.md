# Lifecycle of a work item
> Part of the burhan working agreement (core: `.burhan/WORKFLOW.md`). **Read this when:** you want the overview of the lifecycle; the detail of each step is in the stage file WORKFLOW §9 names.

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
                 (file:line), proposed sub-units. Too big for one plan → propose a split (phases/stage-story.md · Decomposition).
                        ⛔ STOP — explicit approval
                              │
  ③  PLAN   (P)  phases/stage-plan.md
                        ⛔ STOP — explicit approval
                              │
  ④  BUILD  (T)  phases/stage-build.md
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

**Tests passing is not the finish line.** A happy-path check is the most common way defects reach
QA — that is why ⑥ and ⑦ exist.

## Working methods

exploration → specification → test-first implementation → systematic debugging → review →
verification. Name which one you are in (core §8).

## Readiness is not stage

An item may legitimately stop before implementation: **Spec ready** (story approved, nothing
planned), **Plan ready** (plan approved, nothing built). Reaching either never by itself authorizes
code changes. Both are valid close-out states (phases/close-out.md).
