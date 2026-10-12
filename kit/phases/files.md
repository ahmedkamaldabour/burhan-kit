# Work-item files
> Part of the burhan working agreement (core: `.workflow/WORKFLOW.md`). **Read this when:** you create or name a work-item file, preserve a source, or record a limitation or ruling.

One folder per item under the docs location: `<docs>/<slug>/`. **Every file name starts with the
slug** — a file opened in an editor tab, pasted into a diff or found by search keeps its context.

| File | Template | Written at |
|---|---|---|
| `<slug>-story.md` | `templates/story.md` | ② |
| `<slug>-implementation-plan.md` | `templates/plan.md` | ③ |
| `<slug>-findings.md` (read-only routes) | `templates/findings.md` | instead of ②–⑦ |
| `reviews/<slug>-review.md` (one per item, a section per sub-unit; older items may have `reviews/<slug>-<sub-unit>.md`) | `templates/review.md` | ⑤ |
| `reviews/<slug>-verification.md` | `templates/verification.md` | ⑥ |
| `reviews/<slug>-qc.md` | `templates/qc.md` | ⑦ |
| `sources/` | — originals, never edited | ① and whenever new input arrives |
| `<docs>/README.md` (index) | `templates/docs-index.md` | close-out (generated — phases/close-out.md) |
| `<discovery>/YYYY-MM-DD-<slug>.md` | `templates/discovery.md` | phases/discoveries.md |
| state file | `templates/progress.md` | every transition (core §5) |
| `PROJECT.md`, `context/<area>.md` | `templates/project.md`, `templates/context-area.md` | phases/memory.md |

**Sources.** A material user input (requirements document, screenshot, spreadsheet) is kept as the
original file under `sources/` and never edited — a new version is a new file. If it cannot be
captured (e.g. an image pasted into chat), describe what it showed in the story and record that as
a limitation. Never claim an input was preserved when it was not.

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
| `Reopened after PASS` | `YYYY-MM-DD — why`, or `—` | plan | stats (escaped defects) |
| `Performed by` | `<agent> · <model> · <context>` — context: `fresh subagent`, `other agent`, `human` or `same session` | review, QC | QC provenance check, stats |

## Length — keep files short

Every template is a skeleton: **delete any section that does not apply — an absent section is never a
violation** (no hook, review or QC treats it as one). Prefer tables to prose. Caps by route (words,
excluding code blocks and tables):

| File | spike / bounded | architectural |
|---|---|---|
| story | ≤ 500 | ≤ 1,000 |
| plan | ≤ 800 | ≤ 1,600 |
| review (per sub-unit section) | ≤ 250 | ≤ 500 |
| verification | ≤ 400 | ≤ 800 |
| QC | ≤ 700 | ≤ 1,400 |

Over the cap → cut, or split the item (phases/lifecycle.md · Decomposition). `burhan stats` reports
the average size of each file type.
