# Stage — verification, QC and close-out
> Part of the burhan working agreement (core: `.burhan/WORKFLOW.md`). **Read this when:** every sub-unit is reviewed and the item is complete.

## 6) Item-complete verification (when the route includes V)

Release routes verify **before** their review; every other route verifies after the sub-units are
reviewed. When the work is ready: **first ask whether the human performs the verification or wants the
agent to** (in `auto`, use the answer given at the start). If the agent does it, use the verification identity from WORKFLOW §1, check every acceptance
criterion, and record every run — failed ones included — in `reviews/<slug>-verification.md` from
`templates/verification.md`. Point the state file at the report (pointer only). Set the plan to
**Completed**. Then:
- Route includes **Q** → suggest `burhan:qc <slug>` (it runs the knowledge review and the
  close-out).
- No **Q** → if the route includes **K**, run the knowledge review now (.burhan/phases/memory.md: propose with evidence;
  the human promotes or rejects; or record "none"). Then the close-out (.burhan/phases/close-out.md) with state
  `Done (no QC)`.

Record any small unrequested tweak in the plan under "Out-of-scope changes".

**Escaped defects (counted by `burhan stats`).** A bug whose cause is an item that already passed QC
names it in the bug story's **Escapes** line. An item reopened after its QC PASS gets the date and the
reason in its plan's **Reopened after PASS** line.
