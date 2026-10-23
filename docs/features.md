# burhan — features in detail

[README](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/README.md) · [العربية](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/README.ar.md) · [Configuration](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md)

Every feature has four lines: **What it is**, **When it shows up**, **Example**, **Limit**. A rule that is behavioural (the agent is told to follow it) is called that; a check that runs is called a check. Nothing here blocks an action: every hook reports and fails open.

## Agree before you build

### Routing — how much process a request gets
- **What it is:** every request is classified before work starts: a type (`feature`, `bug`, `investigation`, `change`, `refactor`, `release`) and a scope (`spike`, `bounded`, `architectural`, `patch`). Security, access rules, data model, money, public APIs, irreversible and concurrent behaviour make work `architectural` whatever its size. One obvious change (a typo, a config line) takes the small `patch` lane.
- **When it shows up:** at the start of each item; the prompt router suggests it on your prompt.
- **Example (illustrative):** "fix a typo in the README" is a `patch`; "change who can see an invoice" is `architectural`.
- **Limit:** the router matches phrases (English and Arabic) and only suggests; the route is whatever the item records.

| Type | bounded | architectural |
| --- | --- | --- |
| feature | story + plan · build · review · verify · QC · knowledge | story · plan (with options) · build · review · verify · QC · knowledge |
| change | story + plan · build · review · verify · knowledge | story · plan · build · review · verify · QC · knowledge |
| bug | story + plan (root cause in it) · build (failing regression test first) · review · verify · knowledge | story · plan · build · review · verify · QC · knowledge |
| refactor | plan · build · review · verify | plan (with options) · build · review · verify · knowledge |
| release | plan (checklist) · verify · review | plan (checklist and rollback) · verify · review |
| investigation | read-only: findings, no application code | read-only |
| patch | routing line · the change · evidence after it · commit (no story or plan) | — |

A `spike` is exploratory: only an investigation or a bug diagnosis may be one, and it is read-only.

### Story and plan, then your approval
- **What it is:** the agent writes a **story** (what and why, with acceptance criteria) and a **plan** (how, in steps) and asks for your explicit yes before code. On bounded work they are one gate; on architectural work the story and the plan are separate.
- **When it shows up:** after intake, before any code.
- **Example:** in the recorded run the agent wrote both files, showed a one-screen "decision card" and waited ([the walkthrough](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/first-task.md)).
- **Limit:** behavioural. No hook stops an agent that ignores it; a story or plan written without the planning skill is flagged at the end of the turn when Superpowers is on.

### Modes — where the work stops for you
- **What it is:** `step` stops after every sub-unit; `auto` stops at the story and plan once, then runs until a brake (a scope escalator, an out-of-scope discovery, a plan change, the same test failing twice, an irreversible action). The commit always stops, in both modes.
- **When it shows up:** set per item; switch in plain words ("go end to end", "wait for my approval", or the Arabic phrases).
- **Example:** `WF_MODE_BUG_BOUNDED=auto` makes bounded bugs start in `auto`.
- **Limit:** a mode is a step in burhan's flow, not the agent's permission setting.

### The commit checkpoint
- **What it is:** before `git commit` the pre-commit hook runs your check command (`WF_CHECK_CMD`) and tells the agent the measured result, and asks whether you chose: (a) commit now, (b) keep going and commit later, (c) you commit.
- **When it shows up:** on any `git commit` the agent runs.
- **Example:** `Pre-commit gate — measured: PASS — `npm test` run by this hook just now.`
- **Limit:** it asks the agent to confirm your choice; it does not stop the command. A check that times out is reported as `NOT VERIFIED`.

### Test-first and sensitive-path nudges
- **What it is:** after a code file is edited (not a test file) a short reminder to write the failing test first; after a file matching `WF_SENSITIVE_REGEX` is edited, your own note (`WF_SENSITIVE_NOTE`).
- **When it shows up:** right after the edit.
- **Example:** `Code changed — was the failing test written FIRST? If not, test-first was skipped: say so. Then run only the affected test file and the fast check.`
- **Limit:** needs `WF_CODE_REGEX` (and `WF_TEST_REGEX`); with them empty the reminder stays silent.

### Read-only investigations and discoveries
- **What it is:** an `investigation` (or a bug diagnosis marked spike) writes findings and no application code; a `READ-ONLY GATE` warning appears if code was written. Something found mid-task that the task did not ask for is written to the discovery folder for you to decide, never silently fixed.
- **When it shows up:** at the end of a turn (read-only); whenever the agent finds something extra (discoveries).
- **Example:** a found bug is a `Planned` file in your discovery folder until you approve a routed item for it.
- **Limit:** behavioural for discoveries; the read-only warning only sees edits and commands the agent reports.

### Superpowers (optional)
- **What it is:** with `WF_SKILLS=superpowers`, each phase maps to a Superpowers skill (brainstorming before a story, planning before a plan, test-driven development for code, review before a review file) and a skipped one is flagged at the end of the turn. burhan never installs Superpowers.
- **When it shows up:** at each phase, if the plugin is installed and the setting is on.
- **Example:** `⚠ SKILL GATE (story): a story was CREATED this turn without superpowers:brainstorming.`
- **Limit:** without the plugin nothing is referenced; setup detects only a plugin folder under `~/.claude/plugins`.

## Prove what was done

### "Done" with no proof
- **What it is:** at the end of a turn that edited code and claimed completion, the audit checks that a passing evidence command ran after the last code edit. It warns when none ran, when the run was before the last edit, when it failed (with its exit code), or when it was blocked or ran in the background.
- **When it shows up:** at the end of the turn, in the agent's context, once.
- **Example:** `⚠ VERIFICATION GATE: completion was claimed, but the last run of `npm test 2>&1 | tail -15` was blocked and never ran. Run it, show the output — or retract the claim.`
- **Limit:** it needs `WF_CODE_REGEX` and `WF_EVIDENCE_REGEX`. The agent proposes them in first-use setup, `npx burhan-kit setup --set check=… code=… test=… evidence=…` saves them, and `npx burhan-kit doctor` warns, once first-use setup is done, when `WF_CODE_REGEX` is empty. It reads a claim from the agent's final message, so an agent that says it could not verify triggers nothing, and it sees only the edits and commands the agent reports.

### The evidence ledger
- **What it is:** each edit and command with its exit code, in order, tagged with the item in flight, written at the end of every turn under `~/.local/state/burhan/evidence/<project>/<session>/` — outside your project. It stores command lines and exit codes only, never their output (a secret typed on a command line would be stored too). Folders are private (0700, files 0600). `npx burhan-kit evidence [--item <slug>] [--json]` reads it. A subagent's steps are tagged with its name.
- **When it shows up:** `evidence` lists it; reviews and QC reports cite it.
- **Example:** `cmd  exit 0  ok  npm test  [slugify]`
- **Limit:** it is written when the turn ends, so a reviewer working inside the same turn does not see that turn yet. On Claude Code the exit code comes from the transcript; on Codex a finished command may have no recorded exit code, and an unknown result counts as passing evidence (a known gap, listed in the [roadmap](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/ROADMAP.md)). A command line with a pipe (`npm test | head`) records the exit of its last command, so a failing first command can show as `exit 0`; `evidence` marks those lines. Cleanup: a session folder older than 30 days that holds only ledger files is removed (folders that also hold session files stay), and you can delete the whole folder at any time. `WF_EVIDENCE_LEDGER=off` turns it off; `WF_EVIDENCE_DIR` moves it.

### Independent review and QC
- **What it is:** each sub-unit's diff is reviewed, and the final QC (`/burhan:qc <slug>`) runs in a fresh context — in Claude Code the `burhan-reviewer` subagent, or the other agent through `WF_REVIEWER_AGENT`. Every review and QC records **Performed by**; a QC written in the same turn as the code is flagged. Review depth follows risk (a short checklist, or the full security-first one).
- **When it shows up:** after each sub-unit and at the end of routes that include QC.
- **Example:** `**Performed by:** claude · claude-sonnet-5-5 · fresh subagent`
- **Limit:** you accept the verdict (the agent never writes `Accepted by`); same-session work is recorded as a limitation and counted as self-review by `stats`.

### Records and reports
- **What it is:** every item keeps readable files (story, plan, reviews, verification, QC) in the folder you chose; `burhan status --write` builds an index, `stats` counts routes and QC outcomes, `changed --item <slug>` lists files changed since the story's facts were checked, `pr-body --item <slug>` builds a pull-request description from the files.
- **When it shows up:** at close-out and whenever you run the command.
- **Example:** `| [slugify](slugify/) | feature / bounded | — | — | Awaiting QC | 2026-10-22 |`
- **Limit:** reports are built only from the item files; a missing part is said to be missing.

### Other end-of-turn checks
The audit also warns when a work-item file changed but the state file did not (`STATE-TRANSITION`), when the state file is over its budget (`STATE-SIZE`), when a file says both pending and done (`STALE-STATUS`; `*.log` files are never judged), when a QC report has no **Performed by** (`QC PROVENANCE`) or was written with the code (`QC INDEPENDENCE`), and when a project with code has no decided baseline (`BASELINE GATE`). Each fires only on its exact condition.

## Memory and team

### Understand the project once
- **What it is:** `/burhan:onboard` (Claude Code) or "Follow .burhan/commands/onboard.md" (Codex). The agent reads the whole project, writes a draft of `.burhan/PROJECT.md` and `.burhan/context/`, shows it with what it could not examine, and keeps it only after you decide: approve, correct, or waive, with your name.
- **When it shows up:** once, in a new session after setup; an approved baseline is not redone, a draft is completed.
- **Example:** `Baseline: Approved — <name> · YYYY-MM-DD` in `PROJECT.md`.
- **Limit:** the agent never writes Approved or Waived itself; burhan checks the form of the line, not who wrote it. Until it is decided, a project with code gets a short reminder on each prompt and a warning at the end of a turn that wrote a story or code — guidance, never a block.

### Project memory and its freshness
- **What it is:** one fact per row, with confidence and evidence (a file path and the first 16 characters of its SHA-256, never content). `npx burhan-kit memory check` finds malformed rows, duplicate IDs, merge markers and secret-looking text; `memory status` marks each fact `fresh`, `changed`, `missing` or `unchecked`; `memory affected --since <ref>` lists the facts whose files changed (needs Git); `npx burhan-kit inspect` is a names-only look at the tree.
- **When it shows up:** `status` after a large change or release; `check` in CI.
- **Example:** `memory check: no project memory (.burhan/PROJECT.md, .burhan/context/) — nothing to check`
- **Limit:** a changed hash means the file moved on, not that the fact is false; the hash covers the whole file.

### Session links and the state file
- **What it is:** `npx burhan-kit use <slug>` validates an in-flight item, and the session is linked when the turn ends, so gates and the ledger use the right one; a session start lists the items in flight when it is not linked. The state file (`.burhan/local/PROGRESS.md`) is a short per-developer snapshot of where you are, kept under `WF_STATE_BUDGET` lines (default 80); removing an item block that another session is working on is warned.
- **When it shows up:** at session start and at the end of turns.
- **Example:** `⚑ ITEMS IN FLIGHT: a, b — this session isn't linked to one yet — say which, or run /burhan:e2e <slug>.`
- **Close-out:** one session per item; when an item closes, its block shrinks to one line and its details stay in the item folder, so the file stays under its budget.
- **Limit:** the state file is local and git-ignored; the durable record is the item folder.

### Team sharing
- **What it is:** committed and reviewed like code: `.burhan/bindings.md`, `.burhan/workflow.config`, work-item folders (one owner each), `.burhan/PROJECT.md`, `.burhan/context/`. Per developer and git-ignored: `.burhan/local/`.
- **When it shows up:** when two people add facts to the same area.
- **Example:** a text conflict in `context/data.md` is resolved by keeping each row; `memory check` then catches a duplicate ID or one fact in two states.
- **Limit:** never use `merge=union` on these files — it merges silently and hides duplicates.

## Where it runs

### Claude Code and Codex
- **What it is:** one shared hook core, five hooks per agent (session start, your prompt, before a tool, after a tool, end of turn). Your existing hooks are kept and run beside burhan's.
- **When it shows up:** after setup, in a new session.
- **Example:** `ok    .claude/settings.json: all 5 hooks wired` from `doctor`.
- **Limit:** Codex runs project hooks only after you trust them in `/hooks`, and says nothing when they are untrusted; `doctor` reads the trust state from the table names in `~/.codex/config.toml` (never a value) and warns, and the `AGENTS.md` block tells the agent to ask you once. Trust again after an upgrade that changes a hook. Claude Code 2.1.139 or newer is needed.

### Optional extras
- **Role subagents on chosen models (Claude Code):** setting `WF_MODEL_CLAUDE_PLANNER`, `WF_MODEL_CLAUDE_BUILDER` or `WF_MODEL_CLAUDE_EXPLORER` generates a subagent on that model, and `/burhan:e2e` hands that phase to it with only paths. The reviewer subagent exists without a setting (`WF_MODEL_CLAUDE_REVIEWER` sets its model). Their limits are instructions in the agent file, not a sandbox; for Codex use your own profiles in `~/.codex/config.toml`, which burhan never writes.
- **The `burhan-verify` skill:** when `WF_CHECK_CMD` is set, setup generates a Claude skill that runs it before commits; a skill of yours with that name is never overwritten, and Claude Code calls it at the model's discretion (the pre-commit hook runs the check on every commit regardless).
- **The `CLAUDE.md` / `AGENTS.md` block:** a marked block between `<!-- burhan:start -->` and `<!-- burhan:end -->` points the agent at `.burhan/WORKFLOW.md`; text outside it is never touched, and `--no-bootstrap` skips it.
- **Arabic setup:** `npx burhan-kit setup --lang ar` asks its questions in Arabic, and the prompt router understands Arabic phrases.

### Setup, doctor, upgrade
- **What it is:** `npx burhan-kit` in a terminal asks four questions (five when you use both agents), shows a summary and writes nothing until you confirm; `setup --agent` prints the same questions for an agent to ask. `init`, `upgrade` and `uninstall` are dry runs until `--apply`. `doctor` is a read-only health check: runtime, kit version, config, hooks wired, Claude Code version, Codex trust, memory baseline, state file size.
- **When it shows up:** at install and whenever you want a check.
- **Example:** `0 fail · 0 warn · 14 ok · 1 skip`
- **Limit:** see [upgrading and rollback](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/upgrading.md) and [CI and Windows](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/ci-and-windows.md).

### Runtime
- **What it is:** the hooks are a Node program: Node 22 or newer, and nothing else (no bash, `jq` or `timeout`).
- **When it shows up:** `doctor` checks it.
- **Example:** `ok    node 24.13.0`
- **Limit:** see [CI and Windows](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/ci-and-windows.md) for what is verified on which system.

## Glossary

- **Story:** the written what and why of one piece of work, with acceptance criteria.
- **Plan:** how it will be built, in small steps called sub-units.
- **Route:** how much process a piece of work gets, from its type and scope.
- **Gate:** a point where the agent stops for you (a story and plan approval, the commit), or a check that warns at the end of a turn.
- **QC:** the final independent check of a finished item, run in a fresh context.
- **Hook:** a small script the agent runs at set moments (session start, your prompt, before a commit, after an edit, end of turn).
- **Ledger:** the private record of every edit and command with its exit code.
- **Baseline:** your recorded decision (approved or waived) on the agent's understanding of the project.
- **Session:** one agent conversation in the project; `burhan use <slug>` links it to an item.
