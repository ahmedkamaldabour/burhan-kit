# burhan — guided setup

> For the agent. Follow these steps in order, one at a time, after the kit's `init` (or `upgrade`)
> has been applied with the human's approval. Kit-owned: `burhan upgrade` refreshes this file.

**Rules for the whole setup — they override anything below:**
- **Never commit without asking (a) / (b) / (c)** — (a) commit now, (b) keep going and commit later,
  (c) the human commits. Setting up is not permission to commit.
- **Never edit global** or user-level settings (`~/.claude`, `~/.codex`, shell profiles, global git
  config). Everything you write is inside this repository.
- **Never enter, ask for, copy or print credentials** (tokens, passwords, keys). A check that needs
  them is the human's to run.
- Ask before anything you cannot verify. Say what you could not establish; never guess a value.

## 1. Installed or not
If `.workflow/WORKFLOW.md` already exists, this project has burhan: use the kit's `upgrade` (dry run
first, `--apply` after the human approves), never `init`. Keep the existing
`.workflow/workflow.config` and `.workflow/bindings.md`; in step 3 propose only missing or wrong
values. Kit-owned files (`WORKFLOW.md`, this file, `phases/`, `templates/`, `commands/`, `hooks/`)
are replaced on upgrade — a local edit there is lost.

If the kit's output says **BLOCKED** (your sandbox cannot write a path it needs — Codex protects
`.codex/`; the dry run then exits 1), do not work around it: show the human the exact command to run
outside the sandbox (`… init --agents … --apply`, later `… upgrade --apply`) and wait until they say
it ran.

## 2. Confirm the agents
Look for `.claude/` (Claude Code) and `.codex/` / `AGENTS.md` (Codex). Tell the human which agents
were installed and which you found, and **confirm the agents** they actually use. A missing one is
added by re-running the kit's command with `--agents` (dry run first).

## 3. Discover — change nothing
Read the build, test, lint and CI setup: package or build manifests, task runners, CI workflow files,
test folders, the README. Run nothing that writes, installs or calls the network. From that, propose
a value for each key below, **each with its evidence as file:line** (or "not found"):

| Key | What to propose |
|---|---|
| `WF_CHECK_CMD` | the fast pre-commit check (compile / type check / lint of the changed code) — seconds, not the full suite |
| `WF_CODE_REGEX` | paths that are application code (a change here needs a passing evidence run) |
| `WF_TEST_REGEX` | paths that are tests |
| `WF_EVIDENCE_REGEX` | commands that count as verification (the test runner, the check) |
| `WF_SINGLE_TEST_HINT` | how to run one test file, with `{{FILE}}` where the file goes (`node --test {{FILE}}`) |
| `WF_SENSITIVE_REGEX` + `WF_SENSITIVE_NOTE` | paths where a change is always architectural (auth, payments, migrations, secrets), and the reminder shown when one is edited — no reminder without the note |
| `WF_FORBIDDEN_REGEX` + `WF_FORBIDDEN_REASON` | commands the agent must never run here, and why |
| `WF_DOCS_DIR` | where work items live (default `AI_SPEC/docs`) |

Values are literal, in the forms `.workflow/workflow.config` documents. Regexes are POSIX
extended regular expressions (`grep -E`): no `\d`, `\w` or lookarounds — use `[0-9]`, `[[:alnum:]_]`.
A value that itself needs a single quote cannot be written; choose another pattern. Put every regex
**in single quotes** (`WF_CODE_REGEX='^src/.*\.js$'`): double quotes cannot hold `\`, `$` or a
backtick, and the hooks ignore such a line. The same holds for any value with one of those
characters (`WF_CHECK_CMD`, the hint). Keep the anchors (`^`, `$`) the value needs.

## 4. Ask only business questions
Ask them **all together, once**: the branch rule (where work happens, what may be merged where), the
commands that must never run here and why, and the paths that are sensitive. Do not ask what the
repository answers.

## 5. Write the config — after approval
Show the change to `.workflow/workflow.config` **as a diff** (and to `.workflow/bindings.md` if the
answers belong there). Write it only after the human approves. If `WF_CHECK_CMD`, `WF_CHECK_TIMEOUT`
or a `WF_MODEL_*` key changed, run the kit's `upgrade` (dry run, then `--apply`): it regenerates the
files built from them.

## 6. Prove it works
- Run `WF_CHECK_CMD` once and show the command, its full output and its **exit code**. Not 0 → say
  so; fix the value with the human, never the code.
- Run the kit's `doctor` (the same package command you used for `init`, e.g. `npx burhan-kit doctor`)
  and show its output. Every `fail` is fixed or explained before you finish.
- `.workflow/local/` must be git-ignored (`.workflow/.gitignore` holds `local/`); the doctor checks it.

## 7. Codex hook trust
If Codex is used: Codex runs project hooks only after the human trusts them, and skips untrusted
hooks silently. Until then, burhan does nothing on Codex, and there is no error. Trust is the
human's: **never approve the hooks yourself** and never edit `~/.codex/config.toml`. Tell the human
these steps as written (screens captured on Codex CLI 0.150.1):
1. Open Codex in this project: `codex`.
2. At **Hooks need review**, choose **Review hooks**, not **Continue without trusting**. Later, type
   `/hooks` to open the same list.
3. Do this for each of SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and Stop:
   - select the event and press Enter;
   - move to the hook whose Source is `Project config - <this project>/.codex/hooks.json`;
   - press `t`, then Esc.

   **Trust all and continue** trusts every listed hook, including the plugins'.
4. Check: each burhan hook's Trust line reads `Trusted`. Then re-run the kit's `doctor`. If its
   trust check still warns, the Trust line in Codex is what counts.
5. Trust again whenever Codex shows a burhan hook as `Modified since last trusted`, for example
   after an `upgrade` that changes a hook.

## 8. Close
Summarise: the agents, every config value with its evidence, the check's result, the doctor's
result, and what is still open (questions, Codex trust, anything not verified). Then offer — as a
suggestion — a baseline: "understand this project" (a read-only investigation recorded under the docs
folder). Start it only if the human says yes; never start it on your own.
