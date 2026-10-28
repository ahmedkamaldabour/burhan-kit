# <Title> — Implementation Plan
> **Decision card** — approval is given on these lines; the rest of the file is the evidence behind them.
- **What will be built:** <one or two lines>
- **Route:** <type / scope, exactly as in the story> · **Routing reason:** <one line; any scope escalator>
- **Sub-units:** <N — names>
- **Files / areas:** <the main ones>
- **Risks / rulings:** <the ones that need your eye, with their cost if wrong>
- **Decisions needed from you:** <numbered, or "none — approve as is">

- **Story:** ./<slug>-story.md
- **Build spec:** ./<slug>-build-spec.md (approved with this plan)
- **Branch:** <branch>
- **Overall status:** Draft → Approved → In progress → Completed
- **Reopened after PASS:** <exactly "YYYY-MM-DD — why", or —> (an item reopened after its QC PASS counts as an escaped defect)

> This file holds the decisions and the lines the commands own. The code of every sub-unit is in the build spec (`templates/build-spec.md`). The planner writes no status, result or log text here: the status lines and the gate boxes belong to the commands (`burhan item set`, `gate tick`, `approve`, `item finish`).
> Delete any section that does not apply, except the ones the contract requires; `burhan item check` names a missing one.

## Gate checklist
- [ ] Route stated (type / scope / reason) and the gates it requires known (WORKFLOW §3)
- [ ] Story approved (if the route requires it)
- [ ] No open material question (story · Open questions)
- [ ] Plan approved
- [ ] Plan re-validated against current code before the first sub-unit — only what `burhan changed --item <slug>` lists (or "no change since <sha>")
- [ ] Per sub-unit: failing test first → green (the tests that relate to the part you changed, named with the reason) → fast check; never the whole suite by default; a fix outside those tests adds the tests of the area it touches
- [ ] Per sub-unit: review done → a section in `reviews/<slug>-review.md` (short or full, by risk; one section for a review group)
- [ ] Security re-read: authorization, record-level visibility, no secrets logged or returned;
      access-rule changes tested for BOTH allowed and denied cases
- [ ] No open deviation: every row of the Deviations table is approved or rejected by the owner
- [ ] Every completion claim backed by shown command output
- [ ] Discoveries handled per phases/discoveries.md
- [ ] Real verification performed — asked who does it → `reviews/<slug>-verification.md`
- [ ] QC / convergence passed → `reviews/<slug>-qc.md` (if the route requires it)
- [ ] Knowledge review done, or "none" (if the route includes K)
- [ ] Close-out in the state file

## 1. Decisions
Options considered, with a recommendation. Rejected options stay here as "Alternatives".

## 2. AC coverage
Every acceptance criterion of the story, the sub-unit that builds it, and the test that proves it. A route with no story has nothing to cover.
| AC | Sub-unit | Test (file → test name) |
|----|----------|--------------------------|
| AC-01 | 1 | `<test file>` → `<test name>` |

## 3. What the story got wrong
Corrections from reading the real code, each with file:line. Write "None." when the story held.
| The story said | The code shows | file:line | Effect on the plan |
|----------------|----------------|-----------|--------------------|

## 4. Rulings
| Ruling | Reason | Cost if wrong |
|--------|--------|---------------|

## 5. Sub-unit breakdown
Status ladder: ⬜ Draft → 🟡 Approved → 🔵 In progress → 🟢 Implemented → ✅ Reviewed. Files, tests and code are in the build spec, not here.

### Sub-unit 1 — <name> · ⬜ Draft
- **Covers:** <AC ids, e.g. AC-01, AC-02>
- **Review group:** <letter, or — (phases/review.md · Review groups: decided here, short lane only)>

## 6. Security re-read

## 7. Verification steps

## 8. Limitations
What could not be inspected or verified, and why.

## 9. Executor rules
1. Follow this plan and the build spec exactly: the same files, the same code, the same order, the same commands. No improvising, no extra scope, no refactoring.
2. A step that fails unexpectedly — a RED that does not fail as the spec says, a GREEN that fails, a file that differs from what the spec expects — means STOP. Do not fix it on your own.
3. Record the deviation in section 10 (what, where, the output), then ask the owner. An approved deviation updates this plan and the spec first, then the code.
4. The existing brakes stay: a scope escalator, a discovery outside the item, a plan change, the same test failing twice, an irreversible action.
5. After a sub-unit run only its test files, then the fast check; the full suite at QC, before a commit, or when a fix lands outside the covered tests. A passing full run is reused (phases/stage-finish.md · Reusing a full run).

## 10. Deviations
Empty until a step deviates. Status is open, approved or rejected.
| # | Sub-unit | What | Where | Output | Status | Decision |
|---|----------|------|-------|--------|--------|----------|

## 11. Impact log
Only if the approved intent changed mid-flight (phases/stage-build.md · intent changes).
| Date | Change | Phase | Affected? | Reason |
|------|--------|-------|-----------|--------|

## 12. Knowledge review
Knowledge review: none <keep this line only after deciding nothing new and durable was learned; otherwise replace it with the table below (phases/memory.md)>
| Candidate | Evidence | Relation (new / reconfirms / supersedes / disputes) | Decision (promoted / rejected) |
|-----------|----------|------|----------|

## 13. Out-of-scope changes
Small, in-scope tweaks made while implementing, not requested. Flagged as such.
