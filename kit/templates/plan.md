# <Title> — Implementation Plan
> **Decision card** — approval is given on these lines; the rest of the file is the evidence behind them.
- **What will be built:** <one or two lines>
- **Route:** <type / scope, exactly as in the story> · **Routing reason:** <one line; any scope escalator>
- **Sub-units:** <N — names>
- **Files / areas:** <the main ones>
- **Risks / rulings:** <the ones that need your eye, with their cost if wrong>
- **Decisions needed from you:** <numbered, or "none — approve as is">

- **Story:** ./<slug>-story.md
- **Branch:** <branch>
- **Overall status:** Draft → Approved → In progress → Completed
- **Reopened after PASS:** <exactly "YYYY-MM-DD — why", or —> (an item reopened after its QC PASS counts as an escaped defect)

> Delete any section that does not apply — an absent section is never a violation. Length caps: `phases/files.md`.

## Gate checklist
- [ ] Route stated (type / scope / reason) and the gates it requires known (WORKFLOW §3)
- [ ] Story approved (if the route requires it)
- [ ] No open material question (story · Open questions)
- [ ] Plan approved
- [ ] Plan re-validated against current code before the first sub-unit — only what `burhan changed --item <slug>` lists (or "no change since <sha>")
- [ ] Per sub-unit: failing test first → green → fast check
- [ ] Per sub-unit: review done → a section in `reviews/<slug>-review.md` (short or full, by risk)
- [ ] Security re-read: authorization, record-level visibility, no secrets logged or returned;
      access-rule changes tested for BOTH allowed and denied cases
- [ ] Every completion claim backed by shown command output
- [ ] Discoveries handled per phases/discoveries.md
- [ ] Real verification performed — asked who does it → `reviews/<slug>-verification.md`
- [ ] QC / convergence passed → `reviews/<slug>-qc.md` (if the route requires it)
- [ ] Knowledge review done, or "none" (if the route includes K)
- [ ] Close-out in the state file

## 1. Context
Grounded in the real code — cite file:line. Re-verify anything the story assumed.

## 2. Decisions
Options considered, with a recommendation. Rejected options stay here as "Alternatives".

## 3. Rulings
| Ruling | Reason | Cost if wrong |
|--------|--------|---------------|

## 4. Sub-unit breakdown
Status ladder: ⬜ Draft → 🟡 Approved → 🔵 In progress → 🟢 Implemented → ✅ Reviewed

### Sub-unit 1 — <name> · ⬜ Draft
- **Files:**
- **Steps:**
- **Tests (written first):**
- **Result:** <exact commands + output summary, link to review>

## 5. Security re-read

## 6. Verification steps

## 7. Limitations
What could not be inspected or verified, and why.

## 8. Impact log
Only if the approved intent changed mid-flight (phases/lifecycle.md · intent changes).
| Date | Change | Phase | Affected? | Reason |
|------|--------|-------|-----------|--------|

## 9. Knowledge review
Knowledge review: none <keep this line only after deciding nothing new and durable was learned; otherwise replace it with the table below (phases/memory.md)>
| Candidate | Evidence | Relation (new / reconfirms / supersedes / disputes) | Decision (promoted / rejected) |
|-----------|----------|------|----------|

## 10. Out-of-scope changes
Small, in-scope tweaks made while implementing, not requested. Flagged as such.

## 11. Phase log
Start/end of each phase as it happens, as `YYYY-MM-DD HH:MM` (a date alone gives no duration); tokens only if the agent reports them.
| Phase | Start | End | Tokens |
|-------|-------|-----|--------|
