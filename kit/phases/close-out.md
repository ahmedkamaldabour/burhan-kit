# State transitions and close-out
> Part of the burhan working agreement (core: `.burhan/WORKFLOW.md`). **Read this when:** you change a status, close an item, or hand off to a fresh session.

**Timing.** A new plan has no *Phase log*: a log is not written into the plan, and the evidence ledger timestamps every step.
`burhan stats` still averages the *Phase log* of an older plan.

**A snapshot, not a journal:**
- A line budget (`WF_STATE_BUDGET`, default 80) — it is read in full at every session start.
- Exactly four sections: `Now`, `Waiting on you`, `Commit instructions`, `Standing facts` (≤ 10).
- `Now` holds one block per item **in flight** — several may be in flight, one per session. Each block carries its type/scope, plan link,
  sub-unit status, `Read-only:` marker, **Primary objective** (why it is still open: a reopen reason,
  a blocker, the next deliverable) and **Next action**.
- A transition **edits the existing line**; it never appends a paragraph.
- A block never keeps a sentence about a step that is done. `burhan item new` writes one intake line ("Created by `burhan item new`; fill the story next"); `burhan approve story` replaces it with a `**Next action:**` line, or only removes it when the block already has one, and `burhan state set <slug> "Next action" <text>` removes it from an older block.
- **Pointer-only:** never copy review findings, test output or verification detail into it — link
  the file. The same rule holds for every index (`<docs>/README.md`, the discovery index).
- Remove a `Waiting on you` / `Commit instructions` line **in the same turn** it is resolved.
- **One session per item.** Work one item in a session and start the next in a fresh one (it begins by
  reading the state file). When an item closes, its block in `Now` shrinks to one line of one fixed
  shape — `- <slug> · <type> / <scope> · <outcome> · <commit id, or uncommitted> · <path to its folder>`
  — where the outcome is an index state (`QC PASS`, `Done (no QC)`, `Paused`, `Superseded`, `Already satisfied`); no counts,
  no file lists, no findings; its details stay in the item's files, so the file stays under its budget.
  When the file nears its budget, fold closed lines into one line per release or phase (slugs only; a
  folded line has no commit id, the item's own line and files keep it). `burhan state compact` shows
  (dry run) and, with `--apply`, writes the shortening of older lines.

**Status vocabularies** (use exactly these words):
- Sub-unit: ⬜ Draft → 🟡 Approved → 🔵 In progress → 🟢 Implemented → ✅ Reviewed
- Plan overall: Draft → Approved → In progress → Completed (`Paused` / `Superseded` when an item stops
  before completion)
- Story: Draft → Approved · Discovery: Planned → In progress → Resolved
- Index state (derived by the status command): plan `Completed` on a route with Q → `Awaiting QC`
  until the human accepts a QC PASS (recorded as `Accepted by` in the QC file) → `QC PASS`; plan
  `Completed` on a route without Q → `Done (no QC)`. A `Completed` plan that names no route anywhere
  and has no QC file is `Legacy`: it was finished before routes and QC were recorded, so the index
  cannot say whether it needed QC. `Legacy` is derived only; no command writes it, and it is never an
  outcome of `state close`.
- `Already satisfied`: the owner closed an item whose story the code already satisfies, with a written reason; its plan is absent, Draft or Approved, and nothing was built.

**Close-out** — whenever an item stops being in flight, in the same turn:
1. Shrink its block in `Now` to one line (a bullet, not a `###` heading: a heading counts as an item in flight). `burhan state close <slug> --outcome <state> --commit <id> --folder <path>` writes that line under the state file's lock and then, for `QC PASS` and `Done (no QC)`, ticks the plan's Close-out box (`Paused` and `Superseded` leave it open; a plan with no such box is reported, and the close still stands). A direct edit of the state file is still possible: it is reported at the turn end only when the edit tool's own write shows it, never prevented.
2. Regenerate the docs index with the kit's status command (bindings · Kit command, e.g.
   `burhan status --write`); never hand-edit it. A merge conflict in the index is resolved by
   re-running the command. States (derived from the item files): `Draft` · `Spec ready` ·
   `Plan ready` · `In progress` · `Awaiting QC` · `QC PASS` · `Done (no QC)` · `Paused` · `Superseded` · `Already satisfied` ·
   `Legacy`. The index lists a folder only when it holds `<slug>-story.md`, `<slug>-implementation-plan.md`
   or `<slug>-findings.md`, and it folds the `Legacy` items under one block headed `N old items`; their rows
   stay in the file.
3. Not committed yet → one line under `Commit instructions` with the human's own words.
4. Leaves a decision open → one line under `Waiting on you`, pointing at the file with the detail.
5. If the route includes **K**: knowledge review done (phases/memory.md) — or explicitly "none".

**Findings come first.** Close-out starts after every finding has the owner's decision: those of the sub-unit reviews before `burhan item finish`, those of a QC report before `burhan approve qc` (phases/review.md · Findings are decided before the finish). A finding the owner left out of scope is a discovery, already opened by the command (phases/discoveries.md).

**Already satisfied.** When the code already does what a draft or approved story asks, nothing is planned or built, and the owner decides: `burhan item close <slug> --already-satisfied "<reason>" --by <owner name>`. The command refuses an agent's name, an empty reason and a plan that is In progress, Completed, Paused or Superseded (such an item is finished or paused the usual way). It keeps the reason in `<slug>-already-satisfied.md` and, when the item has a block in `Now`, writes its closed line with the outcome `Already satisfied` and the commit `uncommitted`; it never ticks a gate of the plan.

**Pull request — only when the human asks.** After the commit, a pull request is the human's call:
offer it only if they ask. Build its description from the item files with the kit's PR command
(e.g. `burhan pr-body --item <slug> > /tmp/pr.md`, then `gh pr create --body-file /tmp/pr.md`).
Pushing and opening a PR are outward actions: each goes through your permission prompt, never on
your own judgment.


**Handoff.** At a safe boundary, or when a session grows large: update the state file (especially
*Primary objective* and *Next action*), leave the working tree intact, and continue in a fresh
session — which starts by reading the state file.

**Knowledge review default.** When nothing new and durable was learned, the plan records the single
line `Knowledge review: none` — no table. A proposal (phases/memory.md) only when there is a candidate.
