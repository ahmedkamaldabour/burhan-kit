# Review checklist
> Part of the burhan working agreement (core: `.burhan/WORKFLOW.md`). **Read this when:** you review a sub-unit's diff, or run QC (with `.burhan/commands/qc.md`).

## Sized by risk

Every sub-unit gets a section in the item's single review file (`reviews/<slug>-review.md`).
- **Short** — the sub-unit touches nothing matching `WF_SENSITIVE_REGEX` and no scope escalator: the
  five-line checklist in `templates/review.md` (scope matches the plan, test first, failure paths, no
  unrequested behaviour, no secrets), with the commands run.
- **Full** — anything sensitive or escalated: every item below, findings in the table.
- When in doubt, full. QC (`commands/qc.md`) always applies the whole checklist.
- **Order is evidence, not memory:** test-first and "passing after the last change" are read from the
  evidence ledger (`burhan evidence --item <slug>`): a failing test run before the code edit, a
  passing run after the last one.
- **When the ledger cannot show the sub-unit yet:** the ledger is written when a turn ends, so a review
  run in the build's turn finds no step of the sub-unit in it (nothing for the item, or only steps older
  than its edits). That alone is never a reason to propose FAIL, and never a silent pass: run the
  sub-unit's GREEN command from the build spec yourself and show its result, take the failing-first run
  from the build's commands and exit codes the caller passes, check the rest from the diff and the code,
  leave the "test written first" box open (the short lane's checklist has it; a full review has no such box) and write `order: stated by the builder, not read from the ledger`
  under **Limitations**. QC reads the ledger for every sub-unit whose review says so; a step missing
  there, or out of order, is a finding.

## Start lean (sub-unit reviews)

A sub-unit review starts from the plan's section for the sub-unit, its diff and the evidence ledger.
The caller passes the changed files of the diff range (`git diff --name-only <range>`), so the reviewer
does not explore the tree. Open another file only when the diff points to it (a caller, a test, a
config) and say why under **Checks run**. When in doubt, open it.

## Reading discipline

Read the cheapest safe way: `git diff -U<n>` or `--name-only` first, `grep -n` before opening a file,
`sed -n a,bp` for a range of a large file, never re-read a result already seen, cut very long output
with `head` or `tail`. Guard: every hunk of the diff is read in full; a range is never a reason to skip
a file the diff touches; when in doubt, open the file. It changes how a file is read, never what the checklist covers.

## Findings, not logs

A finding row is the claim, the location and the result in one line. Long probe output and command listings go in `reviews/evidence/<slug>-su<N>.md`, cited under **Checks run**; that file is not read by default. Anything still open when a sub-unit becomes Reviewed is carried forward (phases/discoveries.md), because a closed section is not read again unless it is named.

## Findings are decided before the finish

Every finding of a sub-unit review and of a QC, of every severity, is one row of the Findings table (`templates/review.md`, `templates/qc.md`), written with `burhan finding add`; a section with none says `No findings.` (`finding add --none`). The reviewer proposes and recommends; the owner decides each row: **fixed** (a sub-unit of the plan, or an approved Deviation row), **discovery** (a discovery file that exists) or **accepted** (with the owner's reason; an Important needs a sentence). A Critical is never accepted: it is fixed, or a discovery for code the item did not change. `burhan item finish` refuses an item while a finding of a sub-unit review has no decision, and `burhan approve qc` refuses while a finding of a QC report has none, because the QC comes after the finish. `burhan guide` puts the open findings to the owner as one question; the agent does not run `burhan finding decide` for the owner, and the turn-end report lists a decision run from the shell as agent-run. A fix inside the item after a review goes through `burhan deviation add` (class A: with `--apply`, applied by the agent without asking; class B: left open for the owner's `deviation resolve`), then `finding decide --fixed deviation:<n>`; a finding the owner leaves for later is a discovery (phases/discoveries.md), and `burhan finding discover` opens one for every finding still undecided, only when the owner asked for it. A finding is never dropped silently. A finding of a review section that a later review of the same sub-unit replaced still blocks `burhan item finish` until the owner decides it. The findings table sits directly under the Findings heading. A finding inside this item's scope is fixed, not accepted: a fix is the default, and --accepted is for a finding that cannot be fixed or that a fix would make worse, with the reason written. That fix is class A (phases/stage-build.md · A problem found while building): the agent makes it at once, whatever the severity, and does not wait for the owner; only the owner's decision on the row waits for the grouped question.

## Re-review after findings

A re-review after findings reads only the fix diff and the findings list: each finding is closed, still
open or replaced. It widens to a full review of any part of the fix outside the findings, of anything
matching `WF_SENSITIVE_REGEX`, and of anything that touches path handling or a function a finding names.
A QC re-run after a FAIL is a confirmation round (`reviews/<slug>-qc-r<N>.md`): the findings list, the fix
diff and a run of the tests for the changed areas from the ledger, widened to a full pass when the fix is outside the findings.
This is for re-runs only: the first QC is never shortened.

## Review groups

A plan may put consecutive sub-units in one review group (`Review group: <letter>` in each sub-unit):
one section of the review file covers them. Allowed only when every sub-unit of the group is in the short
lane and they touch one area. The group's review runs once, after the group's last sub-unit. A sensitive or
escalated sub-unit is never grouped. The group is decided in the plan the human approves, never during the
build. Its sub-units stay 🟢 until the group's review, then become ✅. A finding that touches more than one
sub-unit of the group is a finding for all of them: every sub-unit of the group goes back to 🔵 In progress.

## The checklist

Applied to every diff, by an independent pass in a fresh context where possible (core principle 8).
**Three different questions:** *verification* — do the technical checks pass? *review* — is the
implementation technically acceptable? *convergence* — does what was delivered satisfy the approved
acceptance criteria? Passing one never answers the others.

**Security & access control — highest consequence, check first**
- Authorization on every new/changed entry point.
- **Record-level visibility:** does every read restrict to what this user/organisation may see? A
  missing filter silently returns *everything* — the most damaging and least visible bug class.
- Any access-rule change is covered by a test asserting **both** allowed and denied cases.
- Secrets, tokens, credentials, internal identifiers: not logged, not returned, not committed.
- Untrusted input: injection, path traversal, unrestricted upload, unsafe deserialization.
- Publicly reachable routes/files that should not be.

**Correctness & regressions**
- Failure paths and edge cases: empty, missing, duplicate, oversized, boundary values, very long
  input, concurrent use.
- What else consumes this code? Callers, jobs, exports, caches, other surfaces.
- **Pre-existing vs introduced:** before calling a failure a regression, re-run the same check on a clean copy of the
  commit the work started from (`git worktree add <a temporary folder> <that commit>`; install what the check needs there; `git worktree remove` it afterwards); never stash or reset your working tree.

**Fidelity to the spec (convergence)**
- Every acceptance criterion mapped to real code (file:line) — `satisfied` / `partial` / `missing`
  / `contradicts`, each with evidence.
- **Unrequested behaviour** listed and resolved: accepted (with a reason) or removed.
- Displayed values, labels, response shapes and error messages exactly as specified — wrong wording
  is a defect, not a nitpick.
- User-facing messages are clear, translated where required, and leak no technical detail
  (stack traces, internal identifiers, raw errors).
