# <Title>
> **Decision card** — approval is given on these lines; the rest of the file is the evidence behind them.
- **What changes:** <one or two lines, as the user will see it>
- **Route:** <feature|bug|investigation|change|refactor|release> / <spike|bounded|architectural|patch>
- **Files / areas:** <the main ones>
- **Risks:** <what could go wrong, and its cost>
- **Decisions needed from you:** <Q-1, Q-2 … below, or "none — approve as is">

- **Status:** Draft | Approved
- **Routing reason:** <one line — name any scope escalator that applies (WORKFLOW §3)>
- **Source:** <conversation / ticket / document>, <YYYY-MM-DD>
- **Parent:** <parent slug, or —> · **Answers for:** <parent AC IDs, or —> · **Depends on:** <sibling slugs, or —>
- **Escapes:** <slug of an item that passed QC whose defect this is (bugs), or —>
- **Mode:** <step|auto — exactly one; default from WF_MODE_<TYPE>_<SCOPE>, else WF_MODE_DEFAULT; switch any time — phases/lifecycle.md>

> Delete any section that does not apply — an absent section is never a violation. Length caps: `phases/files.md`.

## Job story
> As a <role>, I want to <action>, so that <benefit>.

## Acceptance criteria
Stable IDs — never renumbered or reused. Provenance: `request`, `source:<file>`, `Q-<n>`, or a section.

| ID | Criterion | Provenance |
|----|-----------|------------|
| AC-01 | | |

## Business rules

## Data dictionary
(only if the item introduces or changes fields or entities)

## Sources
Originals kept under `./sources/` (never edited). Inputs that could not be captured: what they
showed, and why they could not be kept.

## Open questions — one round
Ask them **all together, once**, numbered (Q-1, Q-2 …) — never one at a time across turns. A question
marked **material** blocks plan approval.

| ID | Category (business / architecture) | Material (yes / no) | Question | Answer |
|----|------|----|----------|--------|

## Codebase verification
Facts confirmed in the CURRENT code — cite file:line. Not assumptions.
- **Verified at commit:** <`git rev-parse --short HEAD` when these facts were checked>

## Proposed sub-units
| # | Area | Sub-unit |
|---|------|----------|
