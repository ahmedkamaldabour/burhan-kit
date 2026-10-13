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
