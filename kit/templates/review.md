# Review — <slug>
- **Contract:** 1
One file per item; one section per sub-unit, added as each sub-unit is reviewed. Size each section by
risk (phases/review.md): **short** when the sub-unit touches nothing matching `WF_SENSITIVE_REGEX` and
no scope escalator, **full** otherwise.

> Delete any section that does not apply — an absent section is never a violation.

## Sub-unit 1 — <name> · short | full
(a review group covers several sub-units: `## Sub-units 1–2 — <name> · short (group A)`; phases/review.md · Review groups)
- **Date:** YYYY-MM-DD · **Performed by:** <agent> · <model> · <exactly one: fresh subagent | other agent | human | same session>
- **Diff:** <commit range or "working tree">

**Short checklist** (delete for a full review):
- [ ] The diff matches the plan's sub-unit — nothing more
- [ ] Test written first; it failed, then passed — check the evidence ledger (`burhan evidence --item <slug>`), not memory
- [ ] Failure paths and edge cases of the change are handled
- [ ] No unrequested behaviour (or it is listed and accepted)
- [ ] No secrets, tokens or internal identifiers logged, returned or committed

**Full review** (sensitive or escalated): every item of `phases/review.md`, findings below.

| # | Severity (Critical / Important / Minor) | Finding (file:line) | Owner | Resolution |
|---|----------|---------|-------|------------|

**Re-review after findings** (phases/review.md; delete when this is a first review):

| Finding (from the earlier review) | Closed / still open / replaced | Evidence (fix diff hunk, test) |
|---|---|---|

**Checks run:** exact commands and results (long output: a file under `reviews/evidence/`, phases/review.md). **Limitations:** what this review did not cover, and why.
