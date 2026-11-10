# Handling discoveries
> Part of the burhan working agreement (core: `.burhan/WORKFLOW.md`). **Read this when:** you find something mid-task that the task did not ask for.

Something found mid-task that wasn't in the task — a bug, security gap, edge case, tech debt:

> **Never silently fix it. Never just mention it and move on. Document it, get approval, then act.**

| Situation | Action |
|---|---|
| Small **and** inside the current item's scope | Implement it; record it in the plan under **"Out-of-scope changes"**, flagged as not requested |
| A separate or system-wide concern | Write `<discovery>/YYYY-MM-DD-<slug>.md` from `templates/discovery.md` (`Status: Planned`), add one line to the discovery index, get approval, then do it as its own routed item |

**A review or QC finding the owner leaves out of scope** is a discovery too, opened by the command and never silently: `burhan finding decide <slug> <n> --discovery <file> --by <owner>` for one, `burhan finding discover <slug> --by <owner>` for every finding that still has no decision (a Critical excepted: it is decided one by one). `burhan finding discover` is the command that writes the discovery files; `burhan finding decide --discovery <file>` only records a discovery file that already exists, and refuses a missing one. It writes `<discovery>/YYYY-MM-DD-<slug>-finding-<n>.md` from `templates/discovery.md` (`Planned`), its index line and the decision, never overwrites a file, and runs only when the owner asked for it (phases/review.md · Findings are decided before the finish).

**Not a discovery:** a requirement that *was* in the task but got missed — that is an ordinary
in-scope defect. Fix it and note it in the review.
