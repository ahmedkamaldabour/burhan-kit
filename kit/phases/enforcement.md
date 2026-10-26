# Automated enforcement
> Part of the burhan working agreement (core: `.burhan/WORKFLOW.md`). **Read this when:** you read a hook's finding, change the hooks, or need to know how strong a rule is.

The kit's `hooks/` enforce the high-value parts of this document at the agent's own lifecycle, for
every supported agent, from one shared core. They are configured only through `workflow.config`.

| Hook | Moment | What it does |
|---|---|---|
| `session-gates` | session start (incl. after compaction) | Re-injects the gates; prints the state file's `Now` section |
| `prompt-router` | user prompt | Suggests the phase/skill for the request (max 2 lines; matches English and Arabic keywords); a separate baseline reminder (project not understood yet / baseline is a draft) is printed outside that cap; with `WF_SKILLS=superpowers` one more line, also outside the cap, names the skill to invoke before the item's next phase (read from the item's story and plan files, not from your words) |
| `pre-commit-check` | before `git commit` | **Runs** the fast check and reports the measured result + the a/b/c checkpoint |
| `pre-edit-skill` | before a file write (Claude Code, Codex `apply_patch`) | With `WF_SKILLS=superpowers`: before a new story or plan, a review file or a code file is written without its skill (brainstorming, writing-plans, requesting-code-review, test-driven-development), says so once per session and item; it never blocks and says nothing to a subagent. With or without Superpowers, a write of the state file also takes the baseline below and, for a whole-file write, can warn (next paragraph) |
| `post-edit-reminder` | after a file edit | Test-first reminder; sensitive-path note; after a write of the state file, saves its `Now` list (see "Two sessions, one state file") |
| `turn-audit` | end of turn | Flags: unverified "done" (no passing evidence command after the last code edit), state file not updated, state file over budget, contradictory status in an item file, phase skill not used, code written during read-only work, a QC report without **Performed by** or written in the same turn as code, the BASELINE GATE (a story or code written while a project with code has no Approved or Waived baseline) |

**Two sessions, one state file.** The turn-end warning "You removed the `<slug>` block — another session
(active … ago) is working on it" compares the state file's `Now` list just before this session's own first write
of the turn (taken by the pre-write hook; the Bash entry too, for a `>` or `tee` write of the state file) with the
list right after its last write through an edit tool (taken by the post-edit hook). So a block another session
removed or added before this session's first write, or removed after its last write, is not blamed on this session;
when the turn also wrote the state file through the shell, the file at the turn end is used instead. A session never
gets the warning for its own block, and with no baseline (the pre-write hook not installed) the warning stays
silent. "active … ago" is the newest ledger activity of the session that owns the block, and only a session active
in the last 24 hours counts. A whole-file write — the Write tool, or a shell `>`/`tee` whose new content is a heredoc
in the command — that drops a block of another session gets a warning *before* the write ("This write drops the
`<slug>` block — another session (active … ago) is working on it"); it never blocks. An `Edit`/`MultiEdit` (and a
Codex patch) takes the baseline and is checked at the turn end, but gets no warning before it: it carries no whole
content to compare. A `printf`/`echo`/`cat` redirection is seen like any `>` write (the baseline and the turn-end
check, no warning before it: its content is not in the command). Not seen at all: `cp`, `sed -i` or a script writing
the state file (no baseline and no check). `1>`, `&>`, `>|` and a heredoc in a pipeline are seen like any redirection;
only a heredoc that is the content of a `>`/`tee` write is compared before the write. A removal by
another session between this session's first and last write of one turn — or, when the turn wrote the state file
through a shell redirection, or a write failed or was denied (no list is saved then), until the turn end — is blamed
on this one, and so is one made in the tens of milliseconds between this session's write and the post-edit hook
reading the file. A very long slug is cut at 80 characters in the warning.

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
