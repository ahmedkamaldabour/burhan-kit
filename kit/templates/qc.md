# QC — <slug>
- **Contract:** 1
- **Date:** YYYY-MM-DD · **Verdict:** PASS | FAIL — N issues
- **Accepted by:** <exactly "<name> · YYYY-MM-DD", written only after the human accepts the verdict (WORKFLOW §4-D); any other form = not accepted>
- **Performed by:** <agent> · <model> · <exactly one: fresh subagent | other agent | human | same session — same session is also listed under Limitations>

> Delete any section that does not apply — an absent section is never a violation.

## 1. Convergence matrix
Every acceptance criterion, business rule and data-dictionary row.

| Item | Expected | Implementation (file:line) | Finding (satisfied / partial / missing / contradicts) | Evidence |
|------|----------|----------------------------|---------|----------|

## 2. Unrequested behaviour

| Behaviour (file:line) | Decision (accepted — reason / removed) |
|-----------------------|----------|

## 3. Adversarial pass
Failure paths, edge cases, access/visibility — what was exercised, as which identity, and the exact
observed result.

## 4. Regression scan
Cite the evidence ledger for every run (`burhan evidence --item <slug>`: session/turn #seq, exit code).
Checks run (exact commands), and how pre-existing failures were told apart from new ones
(clean-baseline comparison).

## 5. Limitations

## 6. Findings
Every defect of any severity (Critical, Important, Minor), one row each: write it with `burhan finding add <slug> --in qc[:<round>] --severity <S> --text "<finding, file:line>"`; with none, `burhan finding add <slug> --in qc[:<round>] --none` puts the single line `No findings.` here instead of the table. The owner decides each row before `burhan approve qc` accepts the report (a Critical is fixed, or a discovery for code the item did not change; never accepted): you propose, you never decide.

| # | Severity | Finding (file:line) | Decision | Pointer or reason | Decided by |
|---|----------|---------------------|----------|-------------------|------------|
