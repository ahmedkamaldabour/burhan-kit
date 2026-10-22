---
description: Final QC / convergence gate for one work item (after burhan:e2e) — map every acceptance criterion to the delivered code, hunt failure paths, then close out
argument-hint: <slug>
---

You are running the **final QC review** for: **$ARGUMENTS**

Run this **after `burhan:e2e $ARGUMENTS`** (all sub-units ✅, verification recorded). Its job is to
catch what a real QA pass would catch — first. Be **adversarial**: assume there are defects and hunt
for them. The authoritative process is `.burhan/WORKFLOW.md`; project values come from `.burhan/bindings.md`
(§1) and `.burhan/workflow.config`.

## 0) Fresh context — never the one that wrote the code

QC is only independent if it runs without the implementer's memory (WORKFLOW §2 · 8). If you were
started as the reviewer — the `burhan-reviewer` subagent, or the other agent run by option 1 below —
you already are that fresh context: skip this step. A delegated
reviewer cannot ask the human anything, so **first ask the human step 3's question** (who performs
the adversarial pass) and pass the answer in the prompt. Then pick the **first** option that applies:
1. **Another agent as reviewer** — read `WF_REVIEWER_AGENT` in `.burhan/workflow.config` (and
   `.burhan/local/workflow.config`). `other` resolves now to the other agent (`codex` while you are Claude
   Code, `claude` while you are Codex); the existing literal `codex` and `claude` values still work. If the resolved value names the other agent and its CLI is installed, run the QC through it
   non-interactively — from Claude Code `codex exec -s workspace-write '<prompt>' < /dev/null`, from
   Codex `claude -p '<prompt>' --permission-mode acceptEdits < /dev/null`. The prompt says: "You are
   the other-agent reviewer started by burhan:qc step 0 — skip step 0", then gives only the slug, the
   paths, `.burhan/commands/qc.md` and the human's answer to step 3. Put it in **single quotes** with
   no `'` inside, so the shell expands nothing in it. Close stdin (`< /dev/null`): with stdin open the
   CLI waits for more input and never starts. Run it in the foreground with your longest command
   timeout and wait for it. The call goes through your agent's own permission prompt, and the human
   should know what it grants: the reviewer may edit files in the project without further prompts.
   It must write only its report; any other change it made is a finding. **Performed by** then reads
   `<agent> · <model> · other agent`. CLI missing → fall through to 2 (same-agent fresh context), and say so.
2. **Claude Code:** delegate the whole QC to the `burhan-reviewer` subagent. Give it only the slug,
   the work-item folder and the diff range; no summary of your own. Wait for its report (foreground)
   before presenting anything. **Other agents:** run this command in a new session that starts from
   the files.
3. If neither is possible, do it here. Write `<agent> · <model> · same session` in **Performed by** and list it under
  **Limitations**; `burhan stats` counts it as self-review.

Read the state file first. **Do not edit code without confirming** unless it is an obvious, low-risk
fix for a defect inside the item's scope — surface anything larger.

## 1) Load the source of truth

- `<docs>/$ARGUMENTS/$ARGUMENTS-story.md` (acceptance criteria with IDs, business rules, data
  dictionary, answered questions), the plan, and everything in `reviews/`.
- Identify the affected identities/roles and any access or visibility rule the item touches.
- Check the plan's *Impact log*: if intent changed after approval, earlier findings on changed
  criteria are stale — re-assess them.

## 2) Convergence matrix — every spec item, not a sample

Apply the **whole** review checklist in `.burhan/phases/review.md` — security first — to the
item's full diff; QC never uses the short form.

Every acceptance criterion, business rule and data-dictionary row gets one row:
**satisfied / partial / missing / contradicts**, with file:line and evidence (a test, a recorded
run, an observation). If you can't find the code, it is **missing**. Exact wording of displayed
values, labels, response shapes and error messages matters — a wrong one is a defect.

Then list **unrequested behaviour** — anything delivered that no criterion asked for — and resolve
each: accepted (with a reason, confirmed by the human) or removed.

## 3) Adversarial pass — failure and edge states, not the happy path

**First ask the human whether they perform this pass or want the agent to.** A delegated reviewer
does not ask: it uses the answer in its prompt. With no answer, it runs only the checks it can run
from the code and the tests, and lists "adversarial pass: the human was not asked" under
**Limitations** — never a silent default. If the agent does it, act as the actual affected identity
(not the most privileged one, unless the item is about it):

- **Failure paths:** missing or invalid input, wrong type, an action without the required
  permission. The error is correct and clear and leaks no technical detail.
- **Edge cases:** empty state, duplicates, boundary values, very long input, concurrent use.
- **Access / visibility** (if touched): the identity sees exactly what it should and nothing of
  anyone else's. A missing filter silently returns everything — the highest-value check there is.

Record what you exercised and the exact observed result.

## 4) Regression scan

Tell pre-existing failures apart from new ones by comparing against a clean baseline (stash the change).

## 5) Report and proposed verdict

Write `reviews/$ARGUMENTS-qc.md` (a confirmation round: `reviews/$ARGUMENTS-qc-r<N>.md`) from `templates/qc.md`: the matrix, unrequested behaviour, the
adversarial findings with severity (Critical / Important / Minor) and file:line, the regression
result with real output, limitations, and a top-line **proposed** verdict: **PASS** or
**FAIL — N issues**. Write the verdict to the state file (a QC verdict is a transition, WORKFLOW §5) —
the caller does this when the QC was delegated: a delegated reviewer writes only its report.

Fix in-scope defects and re-verify; surface anything larger for the human's decision. Before any
commit of those fixes, the commit checkpoint applies (WORKFLOW §4-B: show the files, ask a / b / c).

## 6) The human decides — then close out

**Present the verdict and STOP.** The verdict is the human's to accept (WORKFLOW §4-D: never approve on their
behalf). Only after they accept a PASS:
1. record it on the QC file's `Accepted by` line as `<name> · YYYY-MM-DD` — the human's name, never
   yours (phases/files.md · Fields);
2. run the knowledge review if the route includes **K** (.burhan/phases/memory.md — propose with evidence; the human
   promotes or rejects; or record "none");
3. run the close-out (.burhan/phases/close-out.md) with state `QC PASS` — a pull request only if
   the human asks (`burhan pr-body` builds its description).

On FAIL, the item goes back to build; nothing is closed.

The next QC is a confirmation round (phases/review.md · Re-review after findings), written as
`reviews/$ARGUMENTS-qc-r<N>.md`: the findings list, the fix diff and a full test run from the ledger; it widens to
a full pass when the fix is outside the findings. The first QC is always the full pass of this file.
