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

