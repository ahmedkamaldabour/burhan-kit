# burhan — working agreement (core)

> **Technology-agnostic:** nothing here assumes a language, framework, runtime, tracker, front end
> or back end.

**Use:** read this core at every session start; open the `.burhan/phases/` file §9
names **when you reach that moment**. A binding left as `—` means "not applicable": skip the steps that depend on it.

---

## 1 · Project bindings

`.burhan/bindings.md` (from `templates/bindings.md`; never overwritten on upgrade) holds the project's values
(locations, commands, what counts as code and evidence). `.burhan/workflow.config` is its machine-readable twin — keep
them consistent. Every "§1" means that file.

**Detect, don't assume.** If a binding is blank, infer it from the repo and **state the inference before relying on it**. Never invent a command.

---

## 2 · Core principles

| # | Principle | In practice |
|---|---|---|
| 1 | **Discover before asking** | Technical unknowns come from the repository, its docs and its runtime; ask the human only about business ambiguity, policy, acceptance criteria, or what the repository cannot give. |
| 2 | **Understand before changing** | Confirm the root cause with evidence — reproduce it, read the code, check the data. If a claim is checkable, check it. |
| 3 | **Process proportional to the work** | Route every request (§3): a bounded bug needs no architectural ceremony; a small change touching money or permissions is not "small". |
| 4 | **Spec first, then approval** | Where the route requires a gate: write it, present it, **wait for explicit approval before writing code**. |
| 5 | **Smallest change, test-first** | Failing test → make it pass → minimal diff. Environment-only problems get environment fixes, never application workarounds. |
| 6 | **Prove before claiming** | Run the checks, show the output (§6). Verification, review and convergence are different questions. |
| 7 | **Remember after finishing** | Durable learnings go to project memory; execution noise stays with the work item. |
| 8 | **Independent QC** | QC (and review where feasible) runs in a fresh context that reads only the files. Reports record **Performed by**; same-session work is a stated limitation. |

---

## 3 · Routing — how much process a request gets

Every request is classified **before** work starts: **type + scope + one-line reason** at the top of
the work item; the human may override. **Types:** `feature` · `bug` · `investigation` · `change` (to
existing behaviour) · `refactor` (no behaviour change) · `release`. **Scopes:** `spike` (exploratory)
· `bounded` (well-understood, local) · `architectural` (cross-cutting or high-consequence) · `patch`
(below).

**Scope escalators — any one of these makes the work `architectural`, whatever its size:**
security or privacy impact · authorization or visibility rules · persistent data-model or migration
changes · money / accounting correctness · derived state shared across modules · external
integration contracts or public APIs · irreversible behaviour · concurrency / transaction rules.

Legend — **S** story gate · **P** plan gate · **S+P** one combined gate · **T** test-first build ·
**R** review · **V** real verification · **Q** QC / convergence gate · **K** knowledge review ·
**RO** read-only.

| Type ↓ / Scope → | spike | bounded | architectural |
|---|---|---|---|
| **feature** | *not allowed — route as `investigation`* | S+P · T · R · V · Q · K | S · P (with design options) · T · R · V · Q · K |
| **bug** | **RO** diagnosis only → findings | S+P (root cause in it) · T (failing regression test first) · R · V · K | S · P · T · R · V · Q · K |
| **investigation** | **RO** | **RO** | **RO** (onboarding a repository: **RO + approval**, phases/memory.md) |
| **change** | *not allowed — route as `investigation`* | S+P · T · R · V · K | S · P · T · R · V · Q · K |
| **refactor** | *not allowed — route as `investigation`* | P · T (behaviour-preserving tests first) · R · V | P (with design options) · T · R · V · K |
| **release** | *not allowed — route as `investigation`* | P (checklist) · V · R | P (checklist + rollback) · V · R |

**`patch` — the smallest lane** (`change`, `bug`, `refactor`): one obvious change (text, config, a
typo, one line), **no scope escalator, nothing in `WF_SENSITIVE_REGEX`, no doubt**. No story or plan:
a routing line (`patch — <reason>`), the change, evidence after it, the commit checkpoint. Anything
more, or any doubt → `bounded`.

**Read-only work (investigation, bug + spike):** **no application code is modified** →
`<slug>-findings.md` (phases/lifecycle.md).

**Lifecycle:** intake → story ⛔ STOP → plan ⛔ STOP → build, one sub-unit at a time → review →
verify (ask who) → QC → knowledge → close-out; the route picks the steps. **Definition of done** =
every gate the route requires is ticked in the plan's *Gate checklist*. **Tests passing is not the
finish line.** **Mode** (`step` · `auto`, a gate in this flow — not the agent's permission
mode) decides where the build pauses; the commit checkpoint always stops.

---

## 4 · Control checkpoints — decisions belong to the human

**These are absolute. Automation surfaces the decision; it never makes it.**

**A · Verification — ask who performs it.** Before any end-to-end/manual verification pass, ask
whether the human wants to do it or wants the agent to. Never default to doing it autonomously.

**B · Commit checkpoint — show, then ask.** Before any commit: stop, show the modified files
(status + diff), then ask: **(a)** commit now · **(b)** keep going, commit later (no commit) ·
**(c)** I'll commit manually (hands off).

**Never commit without one of those three answers.** "Finish the task" is **not** authorization to
commit. Respect the branching rule in §1.

**C · Never change tracker state** (a card's status) unless explicitly asked.
Editing descriptions/comments is fine.

**D · Never approve on the human's behalf** — not a story, a plan, a baseline (phases/memory.md) or a QC verdict.

---

## 5 · Live state file

One file (§1) answers **"where am I and what's next"** — read it first in every session. It is **per
developer** (default `.burhan/local/PROGRESS.md`, git-ignored); the durable truth is the work-item
files.

**State-transition rule (hard requirement).** A transition is any change to a sub-unit status, the
overall status, a QC verdict, or an item being closed. **Every transition is written to the state
file before the next transition and before the turn ends.** Batching is a violation: an
interrupted turn loses the state.

**A snapshot, not a journal:** ≤ `WF_STATE_BUDGET` lines (default 80); four sections — `Now`,
`Waiting on you`, `Commit instructions`, `Standing facts` (≤ 10); a transition **edits the existing
line**; **pointer-only** — link files, never copy findings or output.

**Team use.** Several items may be in flight, one per session. Edit only your own block; never rewrite the file.
The state file is never committed or shared; one owner per item folder, others read it; shared files
(`bindings.md`, `workflow.config`, `.burhan/PROJECT.md`, `.burhan/context/`) change only through review (a pull
request), like code; personal overrides in `.burhan/local/workflow.config` apply key by key.

---

## 6 · Honesty rules

- **No unverified claims.** Never say done / fixed / passing / working without running the command
  and **showing its output**. If it wasn't run, say so.
- **Evidence is exact.** Record the exact command and its result. Failed attempts stay recorded;
  re-run correctly rather than hiding them.
- **Evidence comes after the change.** A "done" needs a *passing* evidence command that ran *after*
  the last code edit; reports cite the evidence ledger (`burhan evidence --item <slug>`).
- **Distinguish measured from assumed**, every time.
- **Report failures plainly**, with the output; say a skipped step out loud.
- **Own mistakes explicitly** when a prior statement turns out wrong.
- **Uncertainty is information.** "I can't verify this without X" is a valid answer.

---

## 7 · Automation safety

- Hooks **do not run tests** and **never mutate project files** — the only command a hook executes is
  the fast check, with a timeout. Every hook **fails open**.

---

## 8 · Working method

Pick the method before acting, and name it. **Debugging is not guessing:** reproduce, one
hypothesis, test it, fix the cause. Match the surrounding code; check siblings before inventing a pattern. **Don't add dependencies, folders, or
architecture** without approval. **Scope discipline:** build exactly what was asked; surface additions for approval. **Never silently
fix a discovery** — document it, get approval, then act (`phases/discoveries.md`). Before work, read
`.burhan/PROJECT.md` and only the memory areas the item touches (`phases/memory.md`).

---

## 9 · Read on demand

| When | Read |
|---|---|
| Intake, story, plan, build, intent change | `phases/lifecycle.md` |
| Item files, sources | `phases/files.md` |
| Reviewing a diff, QC | `phases/review.md` |
| A status change, close-out, handoff | `phases/close-out.md` |
| Something the task did not ask for | `phases/discoveries.md` |
| Project facts, knowledge review | `phases/memory.md` |
| `WF_SKILLS` is set | `phases/skills.md` |
| A hook's finding, evidence ledger | `phases/enforcement.md` |

With `WF_SKILLS=superpowers`, invoke the matching skill before acting in each phase (table in `phases/skills.md`); a hook reminds you, it does not do it for you.
