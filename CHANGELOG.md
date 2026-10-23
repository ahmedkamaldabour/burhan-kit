# Changelog

## 0.4.1 — 2026-10-23

Fixes from a first trial of 0.4.0 on a real project.

### Upgrading from 0.4.0
- Run `npx burhan-kit upgrade --apply`. It refreshes the kit files and creates the empty state file
  `.burhan/local/PROGRESS.md` when it is missing; one that exists is never changed. Your `workflow.config` and
  `bindings.md` are kept. The hook entries in `.claude/settings.json` and `.codex/hooks.json` were byte-identical
  before and after the upgrade (measured on a 0.4.0 install made by the published 0.4.0 package, on Linux), so
  Codex has nothing new to trust; its `/hooks` screen is the reference.

### Added
- **The discovery folder is asked.** `npx burhan-kit` and `setup --agent` ask where side findings (discoveries) go.
  The recommended choice uses a `discovery` folder that already sits next to the work files, else
  `<work files>-discovery`; the wizard names the folder. The answer is saved to `WF_DISCOVERY_DIR` and to the
  discovery row of `bindings.md`. A folder that is, or runs through, a link leaving the project is refused, for the
  work files folder too, and `.git` and `.burhan` are refused in any letter case.
- **The state file always exists.** `init`, `upgrade` and `setup` create `.burhan/local/PROGRESS.md` (or the path in
  `WF_STATE_FILE`) with the four empty sections when it is missing, so "read the state file first" never fails; it is
  git-ignored. When the path cannot be created (outside the project, behind a link, an unwritable folder, or a file
  burhan writes itself) a NOTE says so and nothing is written.
- Close-out rule: one session per item, and a closed item's block in the state file shrinks to one line.
- Review rules: a review starts from the diff, the plan and the ledger; a re-review after findings reads only the
  fix and the findings; a QC re-run after a FAIL is a confirmation round; small short-lane sub-units can share one
  review group.

### Changed
- Setup's final "Step 3" and the first-use reminder say that any first message in a new session starts the project
  setup: the reminder tells the agent to set up the check command first (if it is not set yet), then to present the
  onboarding in the same session. It is a reminder, not a lock. The start was measured once, on Claude Code, with a
  build of this code (the agent began the first-use setup on "hi"); Codex and the published package were not
  measured.
- README: the install section is two parts, one where you run the commands and one where you copy a prompt for your
  agent. The configuration docs say how to write a Windows path in `workflow.config`.

### Known limits
- The limits of 0.4.0 still apply.
- `init --no-bootstrap` also creates the state file.
- Nothing prunes the one-line closed items in the state file except the fold rule in the close-out text.
- The new setup question and the state file were checked on Linux only; Codex and Windows were not run for them.

## 0.4.0 — 2026-10-22

burhan now learns your project once, and the first run is three steps. Versions before 0.4.0 are deprecated:
use 0.4.0 or later.

### Upgrading from 0.3.0
- Run `npx burhan-kit upgrade --apply`. It refreshes the kit files and adds the `/burhan:onboard` command; your
  `workflow.config` and `bindings.md` are kept. The hook entries in `.claude/settings.json` and `.codex/hooks.json`
  are byte-identical to 0.3.0's (measured on a real 0.3.0 install), so Codex has nothing new to trust; its `/hooks`
  screen is the reference.
- Then, in a new session, run `/burhan:onboard` once.
- Installs from 0.2.2 or older: see [upgrading](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/upgrading.md).

### Added
- **Project memory.** `/burhan:onboard` (Codex: say "Follow .burhan/commands/onboard.md") reads the whole project,
  writes a draft of `.burhan/PROJECT.md` and `.burhan/context/`, shows what it covered and what it could not, and
  stops. The baseline is `Approved` or `Waived` only after you decide, with the name you give.
- `burhan inspect [dir] [--json]`: a names-only look at the project (greenfield or brownfield), bounded in depth,
  entries and time.
- `burhan memory check | status | affected --since <ref>`: fact shape, duplicate IDs, merge markers and
  secret-looking text; each fact `fresh`, `changed`, `missing` or `unchecked` from the hashes of the files it cites
  (changed does not mean false); the facts a diff touches. `memory check` exits 1 on a fail, for CI.
- While a project with code has no `Approved` or `Waived` baseline: a reminder on every prompt, a turn-end warning
  (the BASELINE GATE) and a `doctor` warning. Not for greenfield projects, the patch lane, read-only items or the
  onboarding itself. Guidance only, nothing is blocked.
- Setup ends with a titled "Step 3" (a new session, then the onboarding). The Superpowers line says it is optional,
  strongly recommended, never installed by burhan.
- `setup --set` takes `code=`, `test=` and `evidence=` next to `check=`; each pattern is validated before anything
  is saved. `doctor` warns when `WF_CODE_REGEX` is empty after first use, because the "done without proof" warning is
  then off.
- `init` and `upgrade` refuse, and print `OUTSIDE:`, when `.claude/settings.json` or `.codex/hooks.json` resolves
  outside the project, unless you add `--allow-outside-settings`.
- `doctor` reads which burhan hooks Codex has a trust entry for (table names in `~/.codex/config.toml` only, never
  a value) and says so per event; it cannot see "Modified since last trusted" or a disabled hook.
- `burhan evidence` marks a command line with a pipe (its recorded exit is the last command's); `--json` adds
  `"piped": true`.
- README (English and Arabic) rewritten: the promise, the flow, a real recorded run, the features, a three-step
  install, honest limits; new `docs/features.md`, `docs/first-task.md`, `docs/upgrading.md`, `docs/ci-and-windows.md`.

### Changed
- On Claude Code each end-of-turn audit looks only at what is new since the previous Stop of the same prompt, so a
  background agent's wake-up no longer repeats earlier warnings.
- A fix note a reviewer adds to its own review file no longer fires the review SKILL GATE; the code SKILL GATE
  remembers the item's earlier TDD or debugging skill in the same session.
- The prompt router reads "auto mode" and "step mode" after a verb or preposition, in English and Arabic.
- The FIRST USE message and `kit/commands/e2e.md` name `npx burhan-kit …`; a new `bindings.md` carries it in its
  Kit command row.
- The STALE-STATUS check skips `*.log` files. `doctor` names a `WF_*_REGEX` the hooks refuse and why.
- `uninstall --all` works after a plain `uninstall`; project memory stays either way.
- CI runs three jobs, one per system, on Node 24: Ubuntu 24.04, macOS and Windows without bash. Node 22 (the
  minimum) and Windows with Git Bash are no longer run by CI.

### Known limits
- The Codex hook-trust check was observed on Linux with Codex CLI 0.150.1; macOS and Windows are not verified.
- On Codex a finished command may have no recorded exit code, and that counts as passing evidence.
- Windows with PowerShell only, and a real Claude Code or Codex session on Windows, are not verified.
- `init` and `upgrade` still write through a symlink for `CLAUDE.md`, `AGENTS.md`, managed `.claude` files and a
  linked `.burhan`; `setup --set` and `setup --answers --apply` write the hooks file through an outside link without
  the guard.
- A Windows path with backslashes in `workflow.config` is ignored inside double quotes; use single quotes or
  forward slashes (`doctor` reports the line).

## 0.3.0 — 2026-10-19

The hooks now run on Node only. bash and `jq` are no longer needed, and CI runs the hooks on Windows too (see
Requirements for what is and is not verified there).

### Upgrading from 0.2.2
- Run `npx burhan-kit upgrade --apply`. It replaces the bash hooks with the Node hooks in
  `.burhan/hooks/node/`, removes the old `.burhan/hooks/core/` and `.burhan/hooks/adapters/` folders, and
  rewrites every installed agent's hook entries; your own hooks are kept.
- **Codex:** the hook commands changed, so Codex lists them as "Modified since last trusted" and skips
  them silently until you trust them again (`/hooks`, then `t` on each burhan hook).
- Installs from 0.2.1 or older (under `.workflow/`) are still not migrated: uninstall with that version,
  then run `npx burhan-kit`.
- **Going back to 0.2.2:** run `npx burhan-kit uninstall --apply`, then
  `npx burhan-kit@0.2.2 init --agents <your agents> --apply`. Do not run `upgrade` with 0.2.2 on a 0.3.0
  project: it keeps the Node entries and adds the bash ones, so every hook runs twice. `workflow.config`
  and `bindings.md` are kept either way.

### Requirements
- Node ≥ 22 on the PATH the agent starts with. Nothing else: no bash, `jq`, sha256 tool or `timeout`.
- Claude Code ≥ 2.1.139: the Claude Code hooks use the exec form (`node` + args, no shell). There is no
  other hook path for older versions.
- Windows: CI runs the hooks on `windows-latest` with Node 22 and 24, with and without Git Bash. Not
  verified yet: Windows with PowerShell only (no Git Bash), and a real Claude Code or Codex session on
  Windows.

### Changed
- The hooks are a Node program (`node .burhan/hooks/node/main.mjs …`). Their gates, reminders and
  messages are the same as in 0.2.2.
- Measured on one Linux machine, the Node hooks are faster in every case: about 1.4× for the shortest
  hook (the pre-commit check on a non-commit command) and about 5–8× for the turn-end audit, which reads
  the transcript. Not measured on macOS or Windows.
- Behaviour changes:
  - The hooks read only literal config lines (`KEY=value`, `KEY="value"`, `KEY='value'`). A line that
    needs a shell to evaluate (for example `$(…)`) is ignored; `doctor` already reported such lines.
  - `WF_*_REGEX` values go through a POSIX ERE translator instead of `grep -E`. Back-references are not
    supported: a pattern that uses one makes that check stay silent.
  - The hook ledgers and state files are written with mode 0600 (owner only) on Linux and macOS; the bash
    Codex ledger file used to follow the umask.
- `doctor` checks Node ≥ 22 and no longer checks bash, `jq`, a sha256 tool or `timeout`.

### Removed
- The bash hook runtime (`kit/hooks/core/*.sh`, the bash adapters and their snippets).
- `WF_HOOK_RUNTIME`. It never shipped in a 0.2.x release; a leftover `WF_HOOK_RUNTIME=bash` gives a
  `doctor` warning and an `upgrade` note, and any value means Node.
- `WF_TIMEOUT_BIN`. Only the bash hooks read it.

## 0.2.2 — 2026-10-15

### Upgrading from 0.2.1
- The install folder is now `.burhan/` (it was `.workflow/`). Projects installed with 0.2.1 are **not**
  migrated: remove the old install with `npx burhan-kit uninstall` (0.2.1) and run `npx burhan-kit` again.

### Fixed
- The state-transition gate no longer warns when the state file was edited by a shell command; a
  per-turn fingerprint kept outside the project decides, and a turn that did not touch it still warns.

### Changed
- Setup now asks a fourth reviewer/QC question only when both agents are selected, stores `other` (the
  other agent than the one running `/burhan:qc`) or `same`, and improves agent-led folder and
  closing-report guidance. Existing `claude` / `codex` / `same` values keep working.
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
