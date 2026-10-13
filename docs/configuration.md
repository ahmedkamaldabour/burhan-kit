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
.claude/settings.json · .claude/commands/burhan/{e2e,qc}.md · CLAUDE.md block    (claude)
.claude/agents/burhan-reviewer.md · .claude/skills/burhan-verify/SKILL.md (if WF_CHECK_CMD is set)   (claude)
.claude/agents/burhan-{planner,builder,explorer}.md (if WF_MODEL_CLAUDE_* is set)                (claude)
.codex/hooks.json · AGENTS.md block                                           (codex)
docs/burhan/work/ docs/burhan/discovery/                        optional shared work and discoveries
```

- `.burhan/bindings.md` (WORKFLOW §1) and `.burhan/workflow.config` are created **only if
  absent**, never overwritten by init/upgrade. Only the listed kit-owned files are refreshed on
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
- Claude commands go to `.claude/commands/burhan/` (`/burhan:e2e`, `/burhan:qc`). A command file you
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
| `burhan setup [dir] --set check=<cmd\|none> [sensitive=<p;q>] [--force]` | Sets the check and the sensitive paths directly |
| `burhan uninstall [dir] [--apply] [--all]` | Removes burhan from the project; a dry run without `--apply`. Keeps `workflow.config`, `bindings.md`, `.burhan/local/` and private work/discovery files; `--all` removes them too. Work outside `.burhan/`, project memory and unknown files always stay. Removes only owned kit files, blocks, exact hook commands and marked Claude files; keeps user ignore rules and protection for retained private data. Validates before the first change and never follows a symlink out of the project |
| `burhan upgrade [--apply]` | Refresh kit-owned files; agents default to the installed ones; idempotent. Never rewrites `workflow.config` — `doctor` lists keys a newer version added |
| `burhan doctor` | Read-only: bash ≥ 4, `jq` ≥ 1.6 (an older jq cannot compile the hooks' filters), a sha256 tool, `timeout`; kit version against the CLI; config lines the hooks cannot read, unknown and missing keys; every hook wired per agent; Codex hook trust (read from `~/.codex/config.toml`, never written); the state file's size. `ok` · `warn` · `fail` · `skip`; exit 1 only on a `fail` |
| `burhan status [--write]` | The work-item index, derived from the item files; `--write` regenerates `<docs>/README.md` (a hand-written index is never overwritten without `--force`, which keeps a backup) |
| `burhan stats [--json] [--docs <path>]` | Items per route, QC PASS / FAIL, QC by the implementing agent vs independently, escaped defects, per-phase timing. Reports written before these fields existed are read heuristically; anything unclear is `unknown` / `unrecorded`, never guessed |
| `burhan evidence [--item <slug>] [--session <id>] [--last N] [--json]` | The evidence ledger: each edit and command with its exit code, in order |
| `burhan changed --item <slug>` | Files changed since the story's **Verified at commit** (committed, uncommitted and new) |
| `burhan pr-body --item <slug>` | A pull-request description from the item's files: title, route, acceptance criteria with verified outcomes, review and QC (who performed, who accepted), verification, limitations. Missing parts are said to be missing |

## `workflow.config`

`.burhan/workflow.config` holds literal `KEY=value` lines (`KEY=word`, `KEY='text'`, or `KEY="text"`
without `$` `` ` `` `\`). Inside single quotes, $, backticks and \ are literal; a single-quoted value cannot contain a single quote. `init`/`upgrade` and `doctor` report any other line. Regexes are POSIX
extended (`grep -E`). Every check whose key is empty stays silent. `.burhan/local/workflow.config`
holds personal overrides, read after the team file, key by key.

| Key | Purpose |
|---|---|
| `WF_DOCS_DIR`, `WF_DISCOVERY_DIR`, `WF_STATE_FILE`, `WF_STATE_BUDGET` | where work items, discoveries and the live state file live |
| `WF_CHECK_CMD`, `WF_CHECK_TIMEOUT` | the fast, non-mutating check run before every commit |
| `WF_CODE_REGEX`, `WF_TEST_REGEX` | which paths are code / tests |
| `WF_EVIDENCE_REGEX` | which commands count as verification evidence |
| `WF_SENSITIVE_REGEX`, `WF_SENSITIVE_NOTE` | access-control paths and the reminder after editing one |
| `WF_STACK_SETUP` | `pending` = the agent sets up the project checks on first use (`setup --stack`); empty or `done` = nothing to do |
| `WF_SKILLS` | `superpowers` to bind the process-skill mapping, or `none` (see below) |
| `WF_MODE_DEFAULT`, `WF_MODE_<TYPE>_<SCOPE>` | the mode when an item does not set one: `step` (default) or `auto`; any other value = `step`. E.g. `WF_MODE_BUG_BOUNDED=auto` |
| `WF_MODEL_CLAUDE_REVIEWER` | model for the generated `burhan-reviewer` subagent (team-only); empty = the session's model |
| `WF_MODEL_CLAUDE_PLANNER`, `…_BUILDER`, `…_EXPLORER` | generate the `burhan-planner` / `-builder` / `-explorer` subagent on that model (team-only); empty = not generated |
| `WF_REVIEWER_AGENT` | `same` (default), or `codex` / `claude`: `/burhan:qc` runs the QC through the **other** agent's CLI |
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
| `prompt-router` | your prompt | Suggests the phase for the request (English and Arabic phrases, max 2 lines) — a suggestion only |
| `pre-commit-check` | before `git commit` | **Runs** your fast check and reports the measured result, plus the commit checkpoint |
| `post-edit-reminder` | after an edit | Test-first nudge, sensitive-path note |
| `turn-audit` | end of turn | Flags unverified "done" (no passing evidence after the last code edit), state not updated, state file over budget, contradictory status, skipped process skills, code written during read-only work, QC provenance |

Every hook **fails open** and **reports** — none blocks. "The turn" means the current turn — from
your last real message (compaction summaries, tool results and skill expansions don't count) — never
a window of recent lines, so an earlier turn's edit can't trigger a false alarm.

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
   `prompt-router`, `pre-commit-check`, `post-edit-reminder` or `turn-audit` — press `t` to trust it,
   then Esc to go back. Do the same for the other four events.
   - **Trust all and continue** (or `t` on the list) also works, but it trusts every listed hook,
     your Codex plugins' hooks included. Use it only if you want that.
5. Check: each burhan hook's **Trust** line now reads `Trusted`, and the list no longer says the
   burhan hooks need review. Then run `npx burhan-kit doctor`. Its trust check looks for the
   project's entries in `~/.codex/config.toml`, under a key format inferred from plugin hooks (a
   project hook's key was not observed). If it still warns after every burhan hook reads `Trusted`,
   the Trust line in Codex is what counts.

Codex keeps the trust in `~/.codex/config.toml`, as a `trusted_hash` under `[hooks.state."…"]`.
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

Setup checks plugin availability read-only, independently of the saved skills preference. If absent,
it suggests exactly one optional Claude Code command: `/plugin install superpowers@claude-plugins-official`.
It never installs plugins, writes plugin files or overrides an explicit `WF_SKILLS` value.

## Team use

- **Committed, changed through review:** `.burhan/bindings.md`, `.burhan/workflow.config`,
  work-item folders (one owner each), `.burhan/PROJECT.md` and `.burhan/context/` (project memory).
- **Per developer, git-ignored:** `.burhan/local/PROGRESS.md` (the state file) and
  `.burhan/local/workflow.config`.
- **Generated, never hand-edited:** the work-item index (`burhan status --write`); a merge conflict
  in it is resolved by re-running the command.
- **Project-memory fact IDs** are slugs (`DATA-email-unique`), never sequential numbers.

## Develop

The CLI needs Node ≥ 22; CI runs Node 22 and 24.

```bash
npm ci
npm test             # node:test suites (CLI) + every bash suite (hooks, init)
npm run lint         # bash -n on every script, GNU-only forms (macOS), tsc type check
```

The hook suites are black-box and run through `tests/impl.sh`, so a future port can be verified by
the same cases — see [`tests/CONFORMANCE.md`](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/tests/CONFORMANCE.md). Environment overrides (for
tests and unusual setups): `WF_CONFIG` (config file path), `WF_TIMEOUT_BIN` (timeout utility, or
`none`), `WF_CODEX_LEDGER_DIR` (Codex ledger location).

Adding an agent = one folder under `kit/hooks/adapters/<agent>/` (`normalize.sh`, `emit.sh`,
`hook.sh`, a config snippet) plus fixtures captured from that agent's real payloads. The core never
changes.
