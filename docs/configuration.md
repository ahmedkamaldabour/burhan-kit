# burhan — configuration and reference

[README](../README.md) · [العربية](../README.ar.md)

## What `init --apply` writes

```
.burhan/  WORKFLOW.md SETUP.md VERSION phases/ templates/ commands/ hooks/   kit-owned, refreshed on upgrade
            bindings.md workflow.config                        team-owned: created once, committed
            .gitignore  ("/local/", "/work/", "/discovery/")
            local/      PROGRESS.md workflow.config            per developer, git-ignored
            work/ discovery/                                  private work and discoveries, when created
            PROJECT.md context/                               project memory, only when the memory workflow creates it
.claude/settings.json · .claude/commands/burhan/{e2e,qc,onboard}.md · CLAUDE.md block    (claude)
.claude/agents/burhan-reviewer.md · .claude/skills/burhan-verify/SKILL.md (if WF_CHECK_CMD is set)   (claude)
.claude/agents/burhan-{planner,builder,explorer}.md (if WF_MODEL_CLAUDE_* is set)                (claude)
.codex/hooks.json · AGENTS.md block                                           (codex)
docs/burhan/work/ docs/burhan/discovery/                        optional shared work and discoveries
```

- `.burhan/bindings.md` (WORKFLOW §1) and `.burhan/workflow.config` are created **only if
  absent**, never overwritten by init/upgrade. A new `bindings.md` has its **Kit command** row set to
  `npx burhan-kit` (the agent runs the kit with it); `setup` fills that row, and the two work-file rows, in an
  existing file only while they are still the template's placeholders — a value you wrote is never replaced. Only the listed kit-owned files are refreshed on
  upgrade — to customise a template, copy it elsewhere. Memory, work and unknown files are not kit-owned.
- The installer appends missing `/local/`, `/work/` and `/discovery/` rules to `.burhan/.gitignore`
  without changing existing text or the root `.gitignore`. Kit, team config and memory remain trackable.
  Private defaults are `.burhan/work/` and `.burhan/discovery/`; shared paths are
  `docs/burhan/work/` and `docs/burhan/discovery/`. Custom paths need no burhan namespace.
- Agent hook config is merged: your existing settings and hooks stay active; only exact command
  matches from shipped/installed burhan snippets are replaced. Merely mentioning an adapter path
  does not make a command owned. Hook JSON has no ownership comments in command strings. The pre-commit hook's
  timeout is `WF_CHECK_TIMEOUT + 10` (run `burhan upgrade` after changing it).
- A versioned, hashed **bootstrap block** in `CLAUDE.md` / `AGENTS.md` points the agent at
  `.burhan/WORKFLOW.md`, between exact `<!-- burhan:start -->` and `<!-- burhan:end -->` lines;
  version/hash metadata stays inside the pair. Text outside the block is never touched (CRLF files and symlinks
  included). If you edited text *inside* the block, the file is backed up to `<file>.burhan-backup`
  before the block is refreshed. A file with a broken marker pair is refused, not repaired.
  `--no-bootstrap` skips it.
- A hooks file (`.claude/settings.json`, `.codex/hooks.json`) may be a symlink — to a file inside the project it is
  written as before. If it resolves **outside** the project (a link to the file, to a folder above it, or a dangling
  link), `init`/`upgrade` print `OUTSIDE: <file> → <real path>` in the dry run and with `--apply`, and `--apply`
  refuses and changes nothing unless you pass `--allow-outside-settings`. (`setup` shows the same link in its summary
  before you approve.)
- Claude commands go to `.claude/commands/burhan/` (`/burhan:e2e`, `/burhan:qc`, `/burhan:onboard`). A command file you
  wrote yourself is never overwritten. Codex reads them from `.burhan/commands/` via `AGENTS.md`.
- **Safety:** everything is validated before the first write — any problem (invalid agent config,
  broken markers, unwritable file) exits non-zero and writes nothing. A dry run that meets an
  unwritable path (an agent's sandbox — Codex protects `.codex/`) still prints the whole plan, marks
  the path `BLOCKED`, and exits 1. Files are rewritten in place, so symlinks and file modes survive.

## Commands

| Command | What it does |
|---|---|
| `burhan init --agents claude,codex [--apply]` | Install the kit (dry run without `--apply`) |
| `burhan setup [dir] [--lang en\|ar]` | Guided setup in a terminal (also bare `npx burhan-kit` in a terminal); shows a summary and writes nothing until you confirm |
| `burhan setup [dir] --agent [--lang en\|ar]` | Prints the questions and rules for an AI agent to ask, with the recommended answers |
| `burhan setup [dir] --answers <file> [--apply]` | Shows, or with `--apply` writes, the setup for the answers in a JSON file |
| `burhan setup [dir] --stack` | Prints the first-use instructions for an AI agent  |
| `burhan setup [dir] --set check=<cmd\|none> [code=<re>] [test=<re>] [evidence=<re>] [sensitive=<p;q>] [--force]` | Sets the check, what counts as code, tests and proof, and the sensitive paths directly. Each pattern is checked before anything runs or is written (a back-reference or an oversized pattern is refused). A key you leave out keeps its saved value, and an empty value does not clear one — edit `.burhan/workflow.config` for that |
| `burhan uninstall [dir] [--apply] [--all]` | Removes burhan from the project; a dry run without `--apply`. Keeps `workflow.config`, `bindings.md`, `.burhan/local/` and private work/discovery files; `--all` removes them too. Work outside `.burhan/`, project memory and unknown files always stay. Removes only owned kit files, blocks, exact hook commands and marked Claude files; keeps user ignore rules and protection for retained private data. Validates before the first change and never follows a symlink out of the project |
| `burhan upgrade [--apply]` | Refresh kit-owned files; agents default to the installed ones; idempotent. Never rewrites `workflow.config` — `doctor` lists keys a newer version added |
| `burhan doctor` | Read-only: `node` ≥ 22 on PATH (the hooks need nothing else — no bash, `jq`, sha256 tool or `timeout`); a leftover `WF_HOOK_RUNTIME=bash` is a warning (the bash hooks were removed in 0.3.0); Claude Code ≥ 2.1.139 for the exec-form hooks; kit version against the CLI; config lines the hooks cannot read, unknown and missing keys, a `WF_*_REGEX` the hooks refuse (back-reference, too large, invalid); every hook wired per agent; Codex hook trust per event (table names only, from `~/.codex/config.toml`, never written); the state file's size; once first-use setup is done, a warning that `WF_CODE_REGEX is empty` (the "done without proof" warning and the test-first reminder are off); the project-memory warnings (no decided baseline on a project with code, a Draft, `memory check` fails, changed or missing facts — warnings only). `ok` · `warn` · `fail` · `skip`; exit 1 only on a `fail` |
| `burhan inspect [dir] [--json]` | Read-only, bounded look at the tree (names only, no file content, no LLM): brownfield or greenfield, why, the files a newcomer opens first, and what was cut (depth 12, 20,000 entries, 1,000 per folder, 10 s). Symlinks are counted, never followed. A path that is not a folder is exit 2 |
| `burhan memory check [dir]` | Read-only check of the project memory: the Baseline line, fact rows, duplicate IDs, one state per ID, leftover merge markers (fail); secret-looking text (warn, the value never printed). Exit 1 on a fail — usable in CI |
| `burhan memory status [dir]` | Each current fact `fresh`, `changed`, `missing` or `unchecked`, from the hashes in its evidence; no Git needed |
| `burhan memory affected [dir] --since <ref>` | The facts whose evidence files changed since `<ref>` (renames list the old path too; untracked files are not included); needs Git |
| `burhan status [--write]` | The work-item index, derived from the item files; `--write` regenerates `<docs>/README.md` (a hand-written index is never overwritten without `--force`, which keeps a backup) |
| `burhan stats [--json] [--docs <path>]` | Items per route, QC PASS / FAIL, QC by the implementing agent vs independently, escaped defects, per-phase timing. Reports written before these fields existed are read heuristically; anything unclear is `unknown` / `unrecorded`, never guessed |
| `burhan evidence [--item <slug>] [--session <id>] [--last N] [--json]` | The evidence ledger: each edit and command with its exit code, in order |
| `burhan changed --item <slug>` | Files changed since the story's **Verified at commit** (committed, uncommitted and new) |
| `burhan pr-body --item <slug>` | A pull-request description from the item's files: title, route, acceptance criteria with verified outcomes, review and QC (who performed, who accepted), verification, limitations. Missing parts are said to be missing |

## `workflow.config`

`.burhan/workflow.config` holds literal `KEY=value` lines (`KEY=word`, `KEY='text'`, or `KEY="text"`
without `$` `` ` `` `\`). Inside single quotes, $, backticks and \ are literal; a single-quoted value cannot contain a single quote. `init`/`upgrade` and `doctor` report any other line. On Windows, a path with backslashes goes in single quotes, for example `WF_EVIDENCE_DIR='C:\Users\me\ev'`; in double quotes the line is refused and ignored (`doctor` names it). Forward slashes (`C:/Users/me/ev`) are also accepted by the hooks; CI runs only the single-quote form on Windows. Regexes are POSIX
extended (`grep -E`). Every check whose key is empty stays silent. A pattern the hooks refuse (a
back-reference, or one too large) also leaves its check silent; `doctor` names it. `.burhan/local/workflow.config`
holds personal overrides, read after the team file, key by key.

| Key | Purpose |
|---|---|
| `WF_DOCS_DIR`, `WF_DISCOVERY_DIR`, `WF_STATE_FILE`, `WF_STATE_BUDGET` | where work items, discoveries and the live state file live; setup asks for the discovery folder (recommending a `discovery` folder already next to the work files) and creates the state file empty when it is missing, never overwriting one |
| `WF_CHECK_CMD`, `WF_CHECK_TIMEOUT` | the fast, non-mutating check run before every commit |
| `WF_CODE_REGEX`, `WF_TEST_REGEX` | which paths are code / tests; with `WF_CODE_REGEX` empty the "done without proof" warning stays off |
| `WF_EVIDENCE_REGEX` | which commands count as verification evidence |
| `WF_SENSITIVE_REGEX`, `WF_SENSITIVE_NOTE` | access-control paths and the reminder after editing one |
| `WF_STACK_SETUP` | `pending` = the agent sets up the project checks on first use (`setup --stack`); empty or `done` = nothing to do |
| `WF_SKILLS` | `superpowers` to bind the process-skill mapping, or `none` (see below) |
| `WF_MODE_DEFAULT`, `WF_MODE_<TYPE>_<SCOPE>` | the mode when an item does not set one: `step` (default) or `auto`; any other value = `step`. E.g. `WF_MODE_BUG_BOUNDED=auto` |
| `WF_MODEL_CLAUDE_REVIEWER` | model for the generated `burhan-reviewer` subagent (team-only); empty = the session's model |
| `WF_MODEL_CLAUDE_PLANNER`, `…_BUILDER`, `…_EXPLORER` | generate the `burhan-planner` / `-builder` / `-explorer` subagent on that model (team-only); empty = not generated |
| `WF_REVIEWER_AGENT` | `same` (default), `other` (resolve the other CLI when QC runs), or `codex` / `claude` (legacy explicit choices) |
| `WF_EVIDENCE_LEDGER` | `on` (default) or `off` |
| `WF_EVIDENCE_DIR` | where the ledger lives: an **absolute literal** path (no `$HOME`, no `~`); empty or relative = `${XDG_STATE_HOME:-~/.local/state}/burhan/evidence` |

[`kit/workflow.config.example`](../kit/workflow.config.example) documents each key with examples for
several stacks.

## New sessions

After setup, start a new agent session in the project directory. Do the same after switching to a
worktree or when setup changes hooks during a session, so the new session reads the project hooks.

## Hooks

| Hook | Moment | Behaviour |
|---|---|---|
| `session-gates` | session start | Re-injects the gates; shows the state file's `Now` section and the item's mode |
| `prompt-router` | your prompt | Suggests the phase for the request (English and Arabic phrases, max 2 lines; a separate baseline reminder is printed outside that cap) — a suggestion only. With Superpowers it adds one more line, outside the cap, naming the skill to invoke before the item's next phase |
| `pre-commit-check` | before `git commit` | **Runs** your fast check and reports the measured result, plus the commit checkpoint |
| `pre-edit-skill` | before a write | With Superpowers: before a new story, plan or review, or a code file, is written without its skill, says so once per session and item. A skill run earlier in the session, or before any item existed, counts here and in the turn-end story, plan and review checks; the completion check still needs the verification skill in the same turn. Never blocks |
| `post-edit-reminder` | after an edit | Test-first nudge, sensitive-path note |
| `turn-audit` | end of turn | Flags unverified "done" (no passing evidence after the last code edit), state not updated, state file over budget, contradictory status, skipped process skills, code written during read-only work, QC provenance, the BASELINE GATE (a story or code written while a project with code has no Approved or Waived baseline) |

The pre-write hook has two limits on Codex: Codex gives it the patch but not your message, so a `patch —` turn is not recognised there; and it cannot tell a subagent's write from yours. Every hook **fails open** and **reports** — none blocks. "The turn" means the current turn — from
your last real message (compaction summaries, tool results and skill expansions don't count) — never
a window of recent lines, so an earlier turn's edit can't trigger a false alarm. On Claude Code each Stop of a prompt audits only what is new since the previous Stop of that prompt.

### Known limits

The end-of-turn audit reads the agent's tool calls, not the disk:
- shell edits are seen only through `>`, `>>` and `tee` targets — `sed -i`, generators and moves are
  not;
- on Claude Code, a subagent's edit and command calls are read from its own transcript and placed in
  the turn's order (a background agent by timestamp). They count for the "done" check (a failure
  from any agent counts; a subagent's blocked or background run is dropped, since it never ran), for
  the state-file, read-only and QC-provenance checks, and in the ledger tagged
  with the subagent's name. A subagent's shell redirections are not seen;
- failed edit calls are not counted, and the final message is taken from the Stop payload.

## Evidence ledger

At the end of every turn the hooks record each edit and each command with its **exit code and its
order** — the same shape on Claude Code and Codex — under `~/.local/state/burhan/evidence/` (never
inside the project, never command output). A "done" counts only with a passing evidence command
after the last code edit. `burhan evidence --item <slug>` lists what was really run, for verification
and QC reports to cite.

A command line with a pipe (`npm test | head`) records the exit of its last command, so a failing first
command can show as `exit 0`; `burhan evidence` marks those lines (`--json` adds `"piped": true`). A session
folder older than 30 days that holds only ledger files is removed; one that also holds session files stays.

## Independent QC and model per phase

QC uses a fresh context: in Claude Code `/burhan:qc` delegates to the
generated `burhan-reviewer` subagent, which reads only the files; other agents run it in a new
session. Every QC and review records **Performed by** (`<agent> · <model> · <context>`); same-session
work is written down as a limitation and counted as self-review. With Claude Code ≥ 2.1.286, the
generated `burhan-verify` skill (your `WF_CHECK_CMD`) is available before commits; an existing `burhan-verify` skill
of yours is never overwritten.

In Claude Code, `WF_MODEL_CLAUDE_*` generates role subagents with a `model:`, and `/burhan:e2e`
delegates each phase to them in the foreground, handing over only paths: the plan is the hand-off.
Their limits (the explorer reads only, the planner writes only the item folder) are instructions in
the agent file, not a sandbox; the hooks still audit what they do. Codex has no per-subagent model
field: use Codex profiles in your own `~/.codex/config.toml` (`codex -p <profile>`); burhan never
writes it. With `WF_REVIEWER_AGENT=codex`, Claude Code runs the QC through `codex exec` (and the
reverse with `claude -p`), so the reviewer is a different agent altogether.

## Codex: trust the hooks

Codex runs a project's hooks only after you trust them. **Until you do, burhan does nothing on Codex
— and you get no error**: Codex skips untrusted hooks silently (`codex exec` included). Trust is
yours to give, in Codex itself; burhan never grants it. Plan to do it in each project where you
install burhan. The screens below were captured on Codex CLI 0.150.1.

1. Open Codex in the project root: `codex`.
2. Codex shows **Hooks need review** ("N hooks are new or changed") with three choices:
   **1. Review hooks**, **2. Trust all and continue**, **3. Continue without trusting (hooks won't
   run)**. Choose **Review hooks** and press Enter. If you skipped this screen, type `/hooks` in a
   session to open the same list (that path was not captured on 0.150.1).
3. The list shows every event with its `Installed`, `Active` and `Review` counts. burhan adds one
   hook to each of **SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and Stop**. Select an
   event with the arrow keys and press Enter.
4. With the arrow keys, move to the hook whose **Source** is
   `Project config - <your project>/.codex/hooks.json`; its command mentions `session-gates`,
   `prompt-router`, `pre-commit-check`, `pre-edit-skill`, `post-edit-reminder` or `turn-audit` — press `t` to trust it (`PreToolUse` has two hooks: trust both),
   then Esc to go back. Do the same for the other four events.
   - **Trust all and continue** (or `t` on the list) also works, but it trusts every listed hook,
     your Codex plugins' hooks included. Use it only if you want that.
5. Check: each burhan hook's **Trust** line now reads `Trusted`, and the list no longer says the
   burhan hooks need review. Then run `npx burhan-kit doctor`: it names each of the five events as
   `present` or `absent`. If it still warns after every burhan hook reads `Trusted`,
   the Trust line in Codex is what counts.

Trusting the project **folder** is a separate step and does not trust its hooks: on Linux with
Codex CLI 0.150.1, a folder trust alone left the burhan hooks not running in `codex exec`.

Codex keeps the trust in `~/.codex/config.toml`, one `[hooks.state."<absolute path of the
project>/.codex/hooks.json:<event>:<group>:<handler>"]` table per hook, holding its `trusted_hash`
(seen on Linux with Codex CLI 0.150.1; macOS and Windows not verified). The doctor's trust check:

- reads only the **names** of those tables, never a value, and prints only burhan's event names with
  `present` or `absent` — no other key, path or value;
- reads only `~/.codex/config.toml` (`CODEX_HOME` is not read), and skips it with the reason when it
  is not found or not a regular file, when it or `~/.codex` is a symbolic link (not followed), when it
  is larger than 1 MiB, or when it cannot be read;
- matches any group and handler number, and on Windows treats `\` and `/` alike and ignores case;
- cannot see whether a hook is `Modified since last trusted` or disabled, and reads only the
  `[hooks.state."…"]` header form (not dotted keys or inline tables).

In Codex, the AGENTS.md block also tells the agent that a session without the `⚑ WORKFLOW GATES` line
(the first line of burhan's session context) may mean the hooks are not running, and to ask you once
to trust them in `/hooks`. The agent never trusts anything itself.

**Trust again** whenever Codex shows a burhan hook as `Modified since last trusted - review
required`, or shows "Hooks need review" at startup. That can happen after `burhan upgrade` changes a
hook, or after a `WF_CHECK_TIMEOUT` change plus `burhan upgrade`, because the pre-commit hook's
timeout is part of its definition.

## Codex notes

- Codex runs project hooks only after you trust them: see [Codex: trust the hooks](#codex-trust-the-hooks).
- Codex's `workspace-write` sandbox cannot write `.codex/`: run `init`/`upgrade --apply` yourself,
  outside the sandbox (the dry run says `BLOCKED`).
- At the end of a turn Codex only accepts `decision: block` + `reason`, so an audit finding continues
  the turn once with the finding; the turn then ends normally.
- The Codex adapter keeps a small per-turn ledger of tool calls under `~/.local/state/burhan/codex/`
  (consumed at the end of each turn, pruned after 2 days) — never inside your project.
- `init` writes the bootstrap block to each agent's own file: `CLAUDE.md` for Claude Code,
  `AGENTS.md` for Codex.

## Optional integration: Superpowers

With `WF_SKILLS=superpowers`, the working agreement maps each phase to the matching process skill of
the [Superpowers](https://github.com/obra/superpowers) plugin (brainstorming, plans, test-driven
development, debugging, review), and the turn audit notes a skipped skill. With `none` (or empty)
no skill is referenced.

Setup checks plugin availability read-only, independently of the saved skills preference. If it finds a Superpowers plugin folder under `~/.claude/plugins`,
it says: "Superpowers found — burhan uses its skills at each step: brainstorming before a story, TDD while building,
verification before "done". Strongly recommended; turn off with `WF_SKILLS='none'`." If it finds one but the project
explicitly has `WF_SKILLS='none'`, it says: "Superpowers found, but turned off for this project (`WF_SKILLS='none'`). To
use it, set `WF_SKILLS='superpowers'`." If absent, it says Superpowers is strongly recommended, and optional (burhan
never installs it), and, when Claude Code is selected, gives one command: `/plugin install superpowers@claude-plugins-official`.
Detection looks only under `~/.claude/plugins` (Claude Code); setup never reads `~/.codex`. So, unless Superpowers is
turned off, whenever Codex is selected, and always in `setup --agent` (it runs before the agents are answered),
the line adds the official Codex route, worded conditionally:
"if it is not installed yet: in Codex CLI run `/plugins`, search `superpowers`, choose Install Plugin". It never installs plugins, writes plugin files or overrides an
explicit `WF_SKILLS` value.

## Project memory

burhan keeps one shared understanding of the project in the repository: `.burhan/PROJECT.md` (purpose, areas,
where to look first, coverage, discovery limitations) and one file per area in `.burhan/context/` (architecture,
stack, data, integrations, environments, conventions, business rules, decisions), one fact per row with its
confidence, evidence and verification point. Formats: `.burhan/templates/project.md` and
`.burhan/templates/context-area.md`; rules: `.burhan/phases/memory.md`.

- **Onboarding.** Once, in a new agent session: `/burhan:onboard` in Claude Code; in Codex, say
  "Follow .burhan/commands/onboard.md". The agent runs `burhan inspect`, scans the whole project, writes a
  draft, shows it with what it could not examine, and waits. A later run does not redo an approved
  baseline; it completes a Draft, or refreshes the facts `memory status` reports as changed or missing.
- **The Baseline line** in PROJECT.md is exactly one of `Baseline: Draft`,
  `Baseline: Approved — <name> · YYYY-MM-DD` or `Baseline: Waived — <name> · YYYY-MM-DD`. The agent writes
  Approved or Waived only after the person decides, with the name the person gives. burhan checks the shape of the Baseline line, not who wrote it:
  it is a record, not proof. Older projects: `Memory status: Approved <date>` counts as Approved; any other
  `Memory status:` value counts as Draft.
- **What burhan does while a project with code has no decided baseline** — guidance, never a block:
  a short reminder on every prompt (shorter for a Draft), a warning at the end of a turn that wrote a story
  or code, and a `doctor` warning. Exempt: greenfield projects, the patch lane, read-only items, and prompts
  that run the onboarding. The hooks cannot tell an operational question from work, so operational questions also see the reminder.
- **Brownfield** means at least 10 source files (`WF_CODE_REGEX` when set, else a built-in list of source
  extensions). The hooks look at most 5,000 entries and 1 second per turn and answer "greenfield" past that;
  `burhan inspect` says when it cut the walk. A folder with more than 1,000 entries is read only in part
  (the first 1,000 names), so code listed after them is not seen.
- **Freshness.** Evidence is a path and the first 16 hex characters of the file's SHA-256 — never content;
  the hash covers the whole file, so an edit anywhere in it marks every fact that cites it `changed`;
  changed does not mean false: re-check the fact, then reconfirm or supersede it. CRLF line endings count as LF, so
  a Windows checkout gives the same hash. A fact without a hash is `unchecked`, and files over 64 MiB are `unchecked` (not hashed).
- **CI.** Add `npx burhan-kit memory check` to fail a build on malformed or conflicting memory.
- **Team.** Different slugs never collide. Two people adding facts to the same area can get a text conflict:
  resolve it by keeping each row; `memory check` catches a duplicate ID or one fact in two states. On these files,
  never use `merge=union`: it merges silently and hides duplicates.

## Team use

- **Committed, changed through review:** `.burhan/bindings.md`, `.burhan/workflow.config`,
  work-item folders (one owner each), `.burhan/PROJECT.md` and `.burhan/context/` (project memory).
- **Per developer, git-ignored:** `.burhan/local/PROGRESS.md` (the state file) and
  `.burhan/local/workflow.config`.
- **Generated, never hand-edited:** the work-item index (`burhan status --write`); a merge conflict
  in it is resolved by re-running the command.
- **Project-memory fact IDs** are slugs (`DATA-email-unique`), never sequential numbers.

## Develop

The CLI needs Node ≥ 22; CI runs Node 24 only (one job each on Ubuntu, macOS and Windows).

```bash
npm ci
npm test             # node:test suites (CLI, hooks) + the shell suites in tests/ (hooks black-box, init)
npm run lint         # bash -n on the test scripts, GNU-only forms (macOS), tsc type check
```

The shell suites under `tests/` judge the hooks black-box through `tests/impl.sh` (the built Node hooks by default; its
header explains `WF_IMPL_*` for trying another implementation). They need `bash` and `jq` on the machine that runs the
repo's own tests; the product does not. Environment overrides (for tests and unusual setups): `WF_CONFIG` (config file
path), `WF_CODEX_LEDGER_DIR` (Codex ledger location).

The Node hooks are installed to `.burhan/hooks/node/` (a copy of the package's `dist/hooks`); Claude Code runs them in exec form
(`node` + args, no shell, Claude Code ≥ 2.1.139) and Codex through a one-line `node -e` launcher that finds that folder from the
session's directory upward (it runs the first `.burhan/hooks/node/main.mjs` it finds, so a nested copy of the kit would win — keep one install per project tree). Codex trusts hooks by their command's hash, so after the first Node `upgrade` Codex lists them as
"Modified since last trusted" until you trust them again.

Adding an agent = one adapter under `src/hooks/adapters/<agent>/` (normalize, emit, hook, and its entry in `main.mts`) and one
snippet under `kit/hooks/adapters/<agent>/`, plus fixtures captured from that agent's real payloads. The core never
changes.
