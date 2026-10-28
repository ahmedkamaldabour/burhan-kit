# Work-item files
> Part of the burhan working agreement (core: `.burhan/WORKFLOW.md`). **Read this when:** you create or name a work-item file, preserve a source, or record a limitation or ruling.

One folder per item under the docs location: `<docs>/<slug>/`. **Every file name starts with the
slug** — a file opened in an editor tab, pasted into a diff or found by search keeps its context.

| File | Template | Written at |
|---|---|---|
| `<slug>-story.md` | `templates/story.md` | ② |
| `<slug>-implementation-plan.md` (decisions, coverage, rulings, executor rules, deviations) | `templates/plan.md` | ③ |
| `<slug>-build-spec.md` (the code per sub-unit; approved with the plan) | `templates/build-spec.md` | ③ |
| `<slug>-findings.md` (read-only routes) | `templates/findings.md` | instead of ②–⑦ |
| `reviews/<slug>-review.md` (one per item, a section per sub-unit; older items may have `reviews/<slug>-<sub-unit>.md`) | `templates/review.md` | ⑤ |
| `reviews/<slug>-verification.md` | `templates/verification.md` | ⑥ |
| `reviews/<slug>-qc.md` | `templates/qc.md` | ⑦ |
| `sources/` | — originals only, never edited (our scripts and logs: `repro/`) | ① and whenever new input arrives |
| `<docs>/README.md` (index) | `templates/docs-index.md` | close-out (generated — phases/close-out.md) |
| `<discovery>/YYYY-MM-DD-<slug>.md` | `templates/discovery.md` | phases/discoveries.md |
| state file | `templates/progress.md` | every transition (core §5) |
| `.burhan/PROJECT.md`, `.burhan/context/<area>.md` | `templates/project.md`, `templates/context-area.md` | phases/memory.md |

**Sources.** A material user input (requirements document, screenshot, spreadsheet) is kept as the
original file under `sources/` and never edited — a new version is a new file. If it cannot be
captured (e.g. an image pasted into chat), describe what it showed in the story and record that as
a limitation. Never claim an input was preserved when it was not. `sources/` holds originals only:
our own scripts and command logs go to `repro/`. A summary of an input is not the original: record
it as a limitation, name it `<name>-summary`, and keep the original if one exists. The story's
Sources section lists the files kept there (the template has the section).

**Limitations.** What could not be inspected or verified (no production access, not sampled, out of
scope, runtime unavailable) is recorded in the item's plan/review/QC. A limitation is never a
project fact.

**Rulings.** A material deviation from the plan, or an assumption made to keep moving, is recorded
in the plan with its reason and its **cost if wrong**.

## Fields the hooks and stats read

These lines are read by code, **exactly as written**: the bold label (`**Route:**`), then the value —
no synonyms, no extra words. Any other form counts as unset (not accepted, no route, no mode). The
hooks read the item in flight: the first `### <slug>` block under the state file's **Now** (or the
whole **Now** when there is none).

| Field | Exact form | Where | Read by |
|---|---|---|---|
| `Route` | `<type> / <scope>` — type: feature, bug, investigation, change, refactor, release; scope: spike, bounded, architectural, patch (older items: `Type / scope`) | state file, story, plan, findings | patch exemption, read-only check, mode default, stats |
| `Mode` | `step` or `auto` | state file | session start (anything else = `step`) |
| `Read-only` | `yes` or `no` — on an `investigation` or `bug / spike` route anything but `no` counts as `yes` | state file | read-only check |
| `Accepted by` | `<name> · YYYY-MM-DD` — written only after the human accepts | QC | stats, docs index |
| `Baseline` | PROJECT.md: `Draft`, `Approved — <name> · YYYY-MM-DD` or `Waived — <name> · YYYY-MM-DD` (the name has a letter and no `<` or `·`); story: the same Approved or Waived form, or `n/a (greenfield)`. Older projects: `Memory status: Approved YYYY-MM-DD` counts as Approved (no name), any other `Memory status:` value counts as `Draft` | `.burhan/PROJECT.md`, story | memory check, reminders, turn-end warning, doctor |
| `Reopened after PASS` | `YYYY-MM-DD — why`, or `—` | plan | stats (escaped defects) |
| `Performed by` | `<agent> · <model> · <context>` — context: `fresh subagent`, `other agent`, `human` or `same session` | review, QC, verification | QC provenance check, stats |

## Files stay readable

Every template is a skeleton: **delete any section that does not apply — an absent section is never a
violation** (no hook, review or QC treats it as one), except the sections the contract requires: every plan keeps its
gate checklist, sub-unit breakdown, executor rules and Deviations table, a plan on a route with a story also its AC coverage
table, and an architectural plan also its security re-read, verification steps, limitations and knowledge review; a build
spec keeps its "Not verified" list and every part of every sub-unit (`burhan item check` names a missing one). Prefer tables to prose. There is no limit on the size of any file: say what the reader needs to decide or to carry out, and no more. The decision card (phases/lifecycle.md) is short by design.

