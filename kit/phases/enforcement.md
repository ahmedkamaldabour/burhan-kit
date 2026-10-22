# Automated enforcement
> Part of the burhan working agreement (core: `.burhan/WORKFLOW.md`). **Read this when:** you read a hook's finding, change the hooks, or need to know how strong a rule is.

The kit's `hooks/` enforce the high-value parts of this document at the agent's own lifecycle, for
every supported agent, from one shared core. They are configured only through `workflow.config`.

| Hook | Moment | What it does |
|---|---|---|
| `session-gates` | session start (incl. after compaction) | Re-injects the gates; prints the state file's `Now` section |
| `prompt-router` | user prompt | Suggests the phase/skill for the request (max 2 lines; matches English and Arabic keywords); a separate baseline reminder (project not understood yet / baseline is a draft) is printed outside that cap |
| `pre-commit-check` | before `git commit` | **Runs** the fast check and reports the measured result + the a/b/c checkpoint |
| `post-edit-reminder` | after a file edit | Test-first reminder; sensitive-path note |
| `turn-audit` | end of turn | Flags: unverified "done" (no passing evidence command after the last code edit), state file not updated, state file over budget, contradictory status in an item file, phase skill not used, code written during read-only work, a QC report without **Performed by** or written in the same turn as code, the BASELINE GATE (a story or code written while a project with code has no Approved or Waived baseline) |

**Evidence ledger.** At the end of every turn, `turn-audit` writes the turn's steps — each edit and
each command with its exit code, in order, tagged with the item in flight — to
`~/.local/state/burhan/evidence/<project>/<session>/<turn>.jsonl` (outside the project; command lines
only, never their output). The same shape on every agent: Claude Code reports exit codes in its
transcript, Codex in its rollout. On Claude Code a subagent's steps (a delegated build or review) are
recorded in place of its call (a background one by time, or after the turn), marked with the
subagent's name. `burhan evidence` reads it. The ledger is private to the user
(directories 700) and turned off with `WF_EVIDENCE_LEDGER=off`. A session folder older than 30 days
that holds only ledger files is removed; one that also holds session files stays. It stores
command **lines** — never output — so a secret typed on a command line would be stored too. A command
line with a pipe (`cmd | head`) records the exit of its last command, so a failing first command can show
as `exit 0`; `burhan evidence` marks such lines.

**Design principles for the hooks** (keep them when adding a check):
- **Fail open.** A broken check never breaks the agent.
- **Report facts, don't ask nicely.** Where a check can be *run*, run it and state the real result.
- **Different wording per moment.** Identical reminders in several places train the reader to skip them.
- **Silent unless relevant.** Fire only when the exact condition holds; an empty config key means off.
- **Consolidate.** A new check at the same moment as an existing one goes *inside* it.
- **Opt-in, per project.** Installed into a project, never globally.

**How strong each rule is — stated honestly:**

| Strength | Meaning | Rules |
|---|---|---|
| **Blocked** | Technically prevented | none by default — every hook fails open and reports (on agents whose end-of-turn hook can only reach the model by continuing the turn, a finding continues the turn **once**; it never blocks an action) |
| **Measured** | The check is run; the real result is reported | fast check before commit |
| **Detected** | Caught and challenged before the turn ends | unverified claims (no passing evidence after the last edit), state not written, read-only violations, QC without provenance |
| **Commitment** | Behavioural rule, reinforced at session start | spec approval, test-first, asking who verifies |

Only what is *blocked* and what the tooling *does itself* is guaranteed. Everything else is a strong
nudge — claiming more would be exactly the kind of unverified claim this agreement exists to catch.
