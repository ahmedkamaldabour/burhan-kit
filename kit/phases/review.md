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

## Re-review after findings

A re-review after findings reads only the fix diff and the findings list: each finding is closed, still
open or replaced. It widens to a full review of any part of the fix outside the findings, of anything
matching `WF_SENSITIVE_REGEX`, and of anything that touches path handling or a function a finding names.
A QC re-run after a FAIL is a confirmation round (`reviews/<slug>-qc-r<N>.md`): the findings list, the fix
diff and a full test run from the ledger, widened to a full pass when the fix is outside the findings.
This is for re-runs only: the first QC is never shortened.

## Review groups

A plan may put consecutive sub-units in one review group (`Review group: <letter>` in each sub-unit):
one section of the review file covers them. Allowed only when every sub-unit of the group is in the short
lane, they touch one area, and the combined diff is at most 400 changed lines (added + deleted from
`git diff --numstat`, test files included, lockfiles and generated files excluded). A sensitive or
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
- **Pre-existing vs introduced:** before calling a failure a regression, stash the change and re-run
  the same check on a clean baseline.

**Fidelity to the spec (convergence)**
- Every acceptance criterion mapped to real code (file:line) — `satisfied` / `partial` / `missing`
  / `contradicts`, each with evidence.
- **Unrequested behaviour** listed and resolved: accepted (with a reason) or removed.
- Displayed values, labels, response shapes and error messages exactly as specified — wrong wording
  is a defect, not a nitpick.
- User-facing messages are clear, translated where required, and leak no technical detail
  (stack traces, internal identifiers, raw errors).
