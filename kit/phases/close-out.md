# State transitions and close-out
> Part of the burhan working agreement (core: `.burhan/WORKFLOW.md`). **Read this when:** you change a status, close an item, or hand off to a fresh session.

**Timing.** A new plan has no *Phase log*: a log is not written into the plan, and the evidence ledger timestamps every step.
`burhan stats` still averages the *Phase log* of an older plan.

**A snapshot, not a journal:**
- A line budget (`WF_STATE_BUDGET`, default 80) — it is read in full at every session start.
- Exactly four sections: `Now`, `Waiting on you`, `Commit instructions`, `Standing facts` (≤ 10).
- `Now` holds one block per item **in flight** — several may be in flight, one per session. Edit only
  your own block; never rewrite the file. Each block carries its type/scope, plan link,
  sub-unit status, `Read-only:` marker, **Primary objective** (why it is still open: a reopen reason,
  a blocker, the next deliverable) and **Next action**.
- A transition **edits the existing line**; it never appends a paragraph.
- **Pointer-only:** never copy review findings, test output or verification detail into it — link
  the file. The same rule holds for every index (`<docs>/README.md`, the discovery index).
- Remove a `Waiting on you` / `Commit instructions` line **in the same turn** it is resolved.
- **One session per item.** Work one item in a session and start the next in a fresh one (it begins by
  reading the state file). When an item closes, its block in `Now` shrinks to one line — slug, route,
  result and the path to its files — and its details stay in the item's files, so the file stays under
  its budget. When the file nears its budget, fold closed lines into one line per release or phase
  (slugs only; the commit ids stay in the item files).

**Status vocabularies** (use exactly these words):
- Sub-unit: ⬜ Draft → 🟡 Approved → 🔵 In progress → 🟢 Implemented → ✅ Reviewed
- Plan overall: Draft → Approved → In progress → Completed (`Paused` / `Superseded` when an item stops
  before completion)
- Story: Draft → Approved · Discovery: Planned → In progress → Resolved
- Index state (derived by the status command): plan `Completed` on a route with Q → `Awaiting QC`
  until the human accepts a QC PASS (recorded as `Accepted by` in the QC file) → `QC PASS`; plan
  `Completed` on a route without Q → `Done (no QC)`.

**Close-out** — whenever an item stops being in flight, in the same turn:
1. Shrink its block in `Now` to one line (a bullet, not a `###` heading: a heading counts as an item in flight).
2. Regenerate the docs index with the kit's status command (bindings · Kit command, e.g.
   `burhan status --write`); never hand-edit it. A merge conflict in the index is resolved by
   re-running the command. States (derived from the item files): `Draft` · `Spec ready` ·
   `Plan ready` · `In progress` · `Awaiting QC` · `QC PASS` · `Done (no QC)` · `Paused` · `Superseded`.
3. Not committed yet → one line under `Commit instructions` with the human's own words.
4. Leaves a decision open → one line under `Waiting on you`, pointing at the file with the detail.
5. If the route includes **K**: knowledge review done (phases/memory.md) — or explicitly "none".

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
