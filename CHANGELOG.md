# Changelog

## Unreleased

### Changed
- Rewrote the English and Egyptian-Arabic READMEs around a concise, verified first-use path for
  GitHub and npm.
- Sessions can link to one in-flight work item for item-specific gates and evidence; `burhan use <slug>`
  queues the link through the turn-end hook, and concurrent state blocks are protected by a warning.
- Unified installs under `.burhan/`, with private work/discovery defaults, scoped ignore rules,
  namespaced `burhan-verify` and project memory.
- Bootstrap blocks use exact `<!-- burhan:start -->` / `<!-- burhan:end -->` delimiters;
  hook ownership uses exact snippet commands, without JSON command markers.
- Existing project hooks always coexist; setup no longer offers hook removal or shared-folder moves.
- Setup offers optional Claude Code Superpowers guidance without installing plugins or overriding
  explicit skills preferences.
- Fresh setup now recommends shared `docs/burhan/work/` for each task's story, plan and reviews, and
  its Superpowers summary distinguishes available, absent, and explicitly disabled plugins.

### Removed
- Removed never-run configuration and setup options, the NEVER RUN gate and turn-audit check C;
  audit labels D–H remain unchanged.
- Removed RAM/resource rules and `WF_SINGLE_TEST_HINT`, including its reminders and setup guidance.

### Compatibility
- Legacy configuration keys are silently ignored, including personal overrides; `doctor` does not
  warn about them and upgrades preserve the user's configuration.
- Removed setup options exit 2 with a short removal error and leave configuration unchanged.

## 0.2.1

### Setup
- `setup` now rejects unknown answer-file fields and incompatible option combinations before writing,
  and accepts the choices it presents, including the combined-agent choice.
- Existing project hooks are listed before approval and can be kept alongside burhan's hooks; burhan
  never removes them. Setup also identifies settings files that resolve outside the project.
- New shared installs put work and discovery files in `docs/burhan/`. Existing shared installs are
  asked first whether to keep their current folder or move to `docs/burhan/`; nothing moves automatically.
- Setup and `doctor` warn when expected committed files are ignored, and setup supplies an access-control
  reminder when a sensitive-path rule has no note.
- Setup guidance now limits agent edits to the project configuration after showing a diff and receiving
  approval, and preserves literal `$` and `\\` characters in quoted configuration values.
- After setup, the summary reminds you to start a new agent session in the project directory.

### Never-run commands
- Never-run command matching now recognises whole commands only at a shell-command start, and custom
  patterns are checked before they are saved.
- Never-run commands are still reported, not blocked. Use your agent's deny rules to block them today;
  burhan blocking is planned for 0.3.

### Docs
- The English and Arabic READMEs now explain the work-item flow: story, plan, reviewed sub-units,
  progress states, progress tracking and final QC.
- Configuration guidance covers new sessions, worktrees and how to block a never-run command with an
  agent's own deny rules.

### Tests (development)
- Node test temporary folders are cleaned up on success and failure.
- Node tests now choose a RAM-aware parallelism level, print it, and allow an explicit override.

## 0.2.0

### Package and CLI
- `burhan setup`: a guided wizard, plus `--agent` for an AI agent and `--answers [--apply]` for
  answer files.
- First use can guide an agent through project checks with `burhan setup --stack` and save those
  settings with `burhan setup --set`.
- `burhan uninstall [--apply] [--all]`: preview removal by default, then remove burhan-managed
  files while keeping your settings and work files unless `--all` is chosen.
- Running `npx burhan-kit` in a terminal opens the setup wizard.
- Adds the first runtime dependency, `@clack/prompts`, and uses `@types/node` `^22` for development.

### Hooks
- Issue #1 fixed: the story and plan are one approval gate even though they are two files.
- Groundwork for a future Node hook runtime is included, but it is not used yet.

## 0.1.0

The first release of **burhan-kit**: a technology-neutral working agreement and hook kit for AI coding
agents (Claude Code, Codex). No "done" without proof.

### Package and CLI
- Requires Node ≥ 22 (CI runs Node 22 and 24).
- `burhan init` / `burhan upgrade`: install or refresh the kit in any project (dry run by default,
  `--apply` to write). Team-safe layout: shared rules in `.workflow/`, each developer's state file
  and overrides in the git-ignored `.workflow/local/`.
- `burhan status [--write]`: the work-item index, generated from the item files.
- `burhan stats`: routes, QC verdicts, self vs independent QC and review, escaped defects, phase
  timing, file sizes.
- `burhan evidence`: the evidence ledger — every command with its exit code, in order, per turn.
- `burhan changed --item <slug>`: files changed since the commit a story's facts were verified at.
- `burhan doctor`: read-only health check of runtime, install, config (missing and unknown keys),
  hook wiring, Codex hook trust, and the state file; jq ≥ 1.6 is checked.
- `burhan pr-body --item <slug>`: a pull-request description built from the item's files.
- Agent-guided setup: `.workflow/SETUP.md` walks the agent through discovering the build, test and
  lint setup (read-only), proposing `workflow.config` values with file:line evidence, asking only
  business questions, writing the config after approval, and proving it with the check and `doctor`.
- A dry run that cannot write a path (an agent's sandbox) still shows the whole plan and names what
  would block `--apply`.

### Working agreement
- A lean core (`WORKFLOW.md`, ≤ 1,600 words) with phase files loaded when needed; every rule has a
  key phrase checked in its file (`tests/rule-inventory.txt`).
- Routing by type × scope, with scope escalators; a `patch` lane for one obvious change.
- Two autonomy modes per item: `step` (stops after every sub-unit) and `auto` (story and plan once,
  brakes, the commit always stops). "Plan only" is a stopping point that closes the item at `Plan ready`.
- Independent QC: a fresh subagent (`burhan-reviewer`) or the other agent (`WF_REVIEWER_AGENT`), with
  the provenance recorded and counted.
- Fields read by hooks and stats have one exact form (`phases/files.md` · Fields).

### Hooks (Claude Code and Codex)
- Run on jq ≥ 1.6 (checked in CI on 1.6, 1.7.1 and the current release) and under any locale (they
  switch to an installed UTF-8 locale to match Arabic text). If the Codex ledger record cannot be built,
  a minimal record of the call is kept, marked `"record": "minimal"`.
- Session gates, prompt routing hints, pre-commit check, post-edit reminder and a turn audit
  (verification evidence, state file, forbidden commands, state size, skills, read-only work, QC
  provenance).
- The evidence ledger records each edit and command with its exit code, including a Claude Code
  subagent's own steps.
- Optional role agents per phase (`WF_MODEL_CLAUDE_*`).

### Known limits and plans
See [docs/configuration.md](docs/configuration.md#known-limits) and [ROADMAP.md](ROADMAP.md).
