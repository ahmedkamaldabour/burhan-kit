# Roadmap

Plans are not promises. Each item is built test-first and lands only with its tests.

## Done

- **Hooks without bash (0.3.0).** The hooks run on Node only, with no bash or `jq`, and CI runs them on Windows
  too; the README says what is and is not verified there.
- **Project memory and a three-step first run (0.4.0).** `/burhan:onboard`, `burhan inspect`, `burhan memory`, the
  baseline reminder and gate; first-use setup saves what counts as code and proof; a guard against hook files that
  resolve outside the project; Codex hook trust read per event.

- **First-run fixes (0.4.1).** Setup asks where discoveries go and never fails on a missing state file; the first
  message of a new session starts the project setup; the README shows two ways to install.

- **Skill lines and quiet sources (0.5.0).** With Superpowers installed, the router and a pre-write check name the
  skill to invoke before each phase; a saved source or a raw output raises no state or status warning.

- **Outside links refused, proof by command (0.6.0).** Every writer of the installer refuses a write that lands
  outside the project through a link unless `--allow-outside-links` is passed; the "done needs proof" check counts
  only a command the line runs; the commit and shell-write checks read commands; a tag-triggered release workflow
  with SHA-pinned actions.

- **Commands that own a task's files, an executable plan, strict execution (0.7.0).** `item new|set|check|finish`, `gate tick`,
  `review add`, `approve`, `deviation` and `guide` on one written contract that the hooks share; a plan is a decision file plus a
  build spec the builder follows exactly, a failing step stops the work until the owner decides, and there is no limit
  on how long a story, plan or review file may be; with `WF_ITEM_CONTRACT=on` the turn-end audit flags a hand-made or misshapen task
  file, code edited before the plan is approved or outside the spec, and the approval an agent runs is reported.

## Candidates

- **Codex results not yet written.** A command whose result is not in Codex's session record when the turn ends
  counts as not a pass. How often that happens on real Codex is not measured.
- **Content hashes in the ledger.** The ledger cannot tell whether an edited file was later reverted.
  Recording a hash with each edit would let it.
- **Ordered shell writes.** The main agent's shell writes (`>`, `>>`, `tee`) carry no position in the
  turn. A shell write after the evidence run therefore does not reopen the "done" check.
- **Evidence across item close.** Closing an item in the same turn tags that turn's last runs with no
  item. `burhan evidence --session` still shows them.
- **CI hardening.** Keep the action pins current: they are bumped by hand today; a bot such as Dependabot could do it.
- **A plugin route.** A commands-and-skills-only plugin that points at `npx burhan-kit init`, if users
  ask for discovery through a plugin marketplace.

## Known heuristics

These are by design, and listed so nobody mistakes them for guarantees:

- **The prompt router.** Its mode and "plan only" hints come from matching phrases, so it can miss
  or misfire on some wordings. It only suggests. The mode the hooks act on is the exact `Mode` field.
- **What counts as evidence.** The evidence pattern is matched on the commands a line runs, with quoted text
  masked and printing or searching commands (`echo`, `grep`…) left out. A tool that only mentions the words
  (`git grep`, `xargs echo`) can still count, and a run hidden in a variable or `eval` is missed. A Codex
  patch path is resolved against the session folder only when that is inside the project.
- **`Accepted by`.** The field checks its form (`<name> · YYYY-MM-DD`), not who the name belongs to.
  The working agreement forbids the agent from writing it.
- **Codex trust in `burhan doctor`.** The doctor reads only the table names under `[hooks.state."…"]`
  in `~/.codex/config.toml`. The key form was observed on Linux with Codex CLI 0.150.1; macOS and
  Windows are not verified. It cannot see a hook that is `Modified since last trusted` or disabled, so
  it can say `present` for a hook Codex will not run — the `Trusted` line in Codex's `/hooks` is what
  counts. In Codex, the missing `⚑ WORKFLOW GATES` line is a hint, not proof, that the hooks are off.
- **The `burhan-verify` skill.** Claude Code calls it at the model's discretion. The pre-commit hook runs
  `WF_CHECK_CMD` on every `git commit` regardless.
- **Hook-file formatting.** Setup writes `.claude/settings.json` and `.codex/hooks.json` back as
  indented JSON, and `uninstall` does the same when it removes burhan's entries. Your settings and
  hooks are kept, but a compact file's original layout is not restored.
