# burhan — guided setup

> For the agent. Run `setup --agent` (e.g. `npx burhan-kit setup --agent`) and follow what it prints:
> the questions, the recommended answers, the rules. First use in a project: `setup --stack`
> (e.g. `npx burhan-kit setup --stack`). Kit-owned.

**Rules — they override anything below:**
- **Never commit without asking (a) / (b) / (c)** — (a) commit now, (b) keep going, (c) the human commits.
- **Never edit global** or user-level settings (`~/.claude`, `~/.codex`, shell profiles); write only inside this repository.
- **Never enter, ask for, copy or print credentials** (tokens, passwords, keys); a check that needs them is the human's to run.
- Ask before anything you cannot verify; never guess a value.

## 1. Installed or not
If `.burhan/WORKFLOW.md` exists, use `upgrade` (dry run, then `--apply` once approved), never `init`; keep the existing config. If the output says **BLOCKED** (the sandbox cannot write a path, e.g. Codex protects `.codex/`), show the human the exact command to run outside it and wait.
## 2. Confirm the agents
Look for `.claude/` and `.codex/` / `AGENTS.md`; Confirm the agents the human uses. Add a missing one with `--agents` (dry run first).
## 3. Discover — change nothing
Read the build, test, lint and CI files; run nothing that writes, installs or calls the network. Propose each key with its evidence as file:line (or "not found"): `WF_CHECK_CMD` (fast check, seconds), `WF_CODE_REGEX`, `WF_TEST_REGEX`, `WF_EVIDENCE_REGEX`, `WF_SENSITIVE_REGEX` + `WF_SENSITIVE_NOTE` (no reminder without the note), `WF_DOCS_DIR`.
Regexes are POSIX extended regular expressions (`grep -E`): no `\d`, `\w` or lookarounds. Put every regex in single quotes (`WF_CODE_REGEX='^src/.*$'`); keep its anchors.
## 4. Ask only business questions
All together, once: the branch rule, the sensitive paths. For the setup work-files question, name each task's story,
plan and reviews; fresh projects recommend shared `docs/burhan/work/`, while existing saved choices stay unchanged.
When project evidence (`CLAUDE.md`, `AGENTS.md`, or project commands) names a stories/specs folder, offer it as a folder the person chooses; never guess or select it. There are three questions, or four when both agents are used.
## 5. Write the config — after approval
The agent may edit .burhan/workflow.config only, after showing the diff and getting approval; it is a shared file, so the change reaches the team through review (a pull request) like code; never the kit-owned files. Show the change as a diff; Write it only after the human approves. If `WF_CHECK_CMD`, `WF_CHECK_TIMEOUT` or a `WF_MODEL_*` key changed, run `upgrade` (dry run, then `--apply`).
## 6. Prove it works
Run `WF_CHECK_CMD` once; show the command, its full output and its exit code (not 0: fix the value with the human, never the code). Run the kit's `doctor` (e.g. `npx burhan-kit doctor`); every `fail` is fixed or explained. `.burhan/local/` must be git-ignored.
## 7. Codex hook trust
Codex skips untrusted project hooks silently, so burhan does nothing there until the human trusts them. Trust is theirs: **never approve the hooks yourself**, never edit `~/.codex/config.toml`. Tell them (screens from Codex CLI 0.150.1):
1. Open Codex in this project; at **Hooks need review** choose **Review hooks** (later: `/hooks`).
2. For each of SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and Stop: select it, move to the hook whose Source is `Project config - <this project>/.codex/hooks.json`, press `t`, then Esc. **Trust all and continue** trusts every listed hook.
3. Each burhan hook's Trust line must read `Trusted`; re-run `doctor`; if its trust check still warns, the Trust line in Codex is what counts. Trust again when Codex shows `Modified since last trusted`.
## 8. Close
Close in the user's writing language in at most six short lines: what changed, what remains open, and how to undo. No table or setting names. Then relay the "Step 3" block that setup printed, as it appears and on its own: the human opens a NEW agent session in this project and runs the understanding command there (Claude Code `/burhan:onboard`; Codex: "Follow .burhan/commands/onboard.md"). Never start it in this session; never start it on your own.
