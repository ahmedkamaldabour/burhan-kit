# burhan

No “done” without proof: agree on the work first, build in reviewed steps, and show what ran.

- A project-local working agreement and hooks for Claude Code and Codex.
- Story and plan approval, review, and verification stay visible instead of becoming chat promises.
- An evidence ledger records edits and commands, so a claimed result has something to show.

[العربية](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/README.ar.md)

## What burhan stops

- Agent: “done” after an edit, with no check run. → The hook says: “code changed and completion was claimed, but no verification command ran this turn.”
- Agent starts coding without the required approval. → The shared gate says: “no code before the approved story/plan the route requires.”
- Two active tasks, one session. → Run `burhan use <slug>` so the turn is linked to the right item.
- A commit is about to happen. → burhan asks you to choose: commit now, keep going and commit later, or commit it yourself.

## Install / Quick start

The first run is three steps, in this order.

### Step 1 — Superpowers first

Superpowers is strongly recommended, and optional: burhan never installs it. With it, burhan uses its skills at each step (brainstorming before a story, TDD while building, verification before "done").

- Claude Code: `/plugin install superpowers@claude-plugins-official`
- Codex — if it is not installed yet: in Codex CLI run `/plugins`, search `superpowers`, choose Install Plugin.

### Step 2 — Set up burhan

1. Use Node 22 or newer in the repository you want to set up. The hooks need nothing else: no bash, no jq.
2. Run:

```bash
npx burhan-kit
```

3. Answer the three (four when you use both agents) questions:
   - Which coding agents do you use?
   - When should the agent come back to you?
   - Where should burhan save each task's story, plan and reviews? The recommended answer is “In git, for the team — docs/burhan/work/”.
   - When you use both agents: who should review and QC independently? The recommended answer is the other agent.
4. Review the proposed changes and confirm them; nothing is written before confirmation.
5. Check it worked: the setup summary lists the managed `.burhan/` files; then run `npx burhan-kit doctor`. Project checks are proposed by the agent on first use, then approved by you.

Or let your agent do it: ask it to run `npx burhan-kit setup --agent` and follow the printed guidance. If project evidence already names a stories/specs folder, it can offer that folder without guessing or selecting it.

### Step 3 — Understand this project

Once, after setup: open a NEW agent session inside the project, then:

- Claude Code — type: `/burhan:onboard`
- Codex — say: `Follow .burhan/commands/onboard.md`

The agent reads the whole project, shows you a draft and what it could not examine, and saves it in the repo only after you approve. Run it once: an approved understanding is not repeated, and a draft is completed.

## What happens in your first task

Setup puts burhan’s managed working agreement, configuration, and hooks in `.burhan/`. It keeps existing hooks: they run alongside burhan’s hooks, so reminders can repeat.

Start an item with your agent. Each task has a story, plan, and reviews in the location you chose. Run `burhan use <slug>` to link the current session to that item—especially useful when more than one task is active.

**A real first task:** an agent edited `src/add.js`, ran no check, and replied “Done.”

```text
⚠ VERIFICATION GATE: code changed and completion was claimed, but no verification
command ran this turn. Run the checks now and show the real output, or explicitly
retract the claim.
```

## How it works

burhan combines a project-local agreement, hooks that remind the agent of it, and an evidence ledger. The workflow is goal-first: agree on the story and plan, build one reviewed part at a time, then show what was actually checked.

### Basic workflow

1. Agree on the story and plan; burhan pauses when your chosen mode requires approval.
2. Build one reviewed part at a time.
3. Review the evidence, then choose whether to commit now, later, or yourself.

| You get | Why it matters |
| --- | --- |
| Approval gates | The agent waits for the story and plan approval its route needs. |
| Hooks and ledger | Edits, commands, and their exit codes have a durable record. |
| Review checkpoints | A separate review can catch what the builder missed. |
| Session links | `burhan use <slug>` keeps a session attached to the right active task. |

## Settings

`.burhan/` is managed by burhan. Setup shows the proposed changes and asks before writing; later, use `npx burhan-kit setup` to change choices. See the [configuration reference](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md) for every setting, including [Codex hook trust](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md#codex-trust-the-hooks).

## Scripts and CI

For automation rather than first-time setup:

```bash
npx burhan-kit@latest init --agents claude,codex
npx burhan-kit upgrade --apply
npx burhan-kit doctor
```

`init` and `upgrade` show their plan before writing unless you add `--apply`; `doctor` is read-only.

## Upgrading from 0.2.2

`npx burhan-kit upgrade --apply` replaces the 0.2.2 bash hooks with the Node hooks and removes the old hook folders; your own hooks are kept. In Codex, trust the hooks again afterwards. Installs from 0.2.1 or older (under `.workflow/`) are not migrated; see the [changelog](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/CHANGELOG.md).

To go back to 0.2.2, uninstall first and then install the old version. Running `upgrade` with 0.2.2 instead would leave both sets of hooks, so every hook would run twice. Name the agents you use:

```bash
npx burhan-kit uninstall --apply
npx burhan-kit@0.2.2 init --agents claude,codex --apply
```

Your `workflow.config` and `bindings.md` are kept.

## Supported agents

Claude Code (2.1.139 or newer) and Codex are supported. In Codex, trust the project hooks after setup or they will not run; the configuration reference explains the trust step.

**Windows:** the hooks run on Node, without bash or jq. CI runs them on `windows-latest` with Node 22 and 24, with and without Git Bash. Not verified yet: Windows with PowerShell only (no Git Bash), and a real Claude Code or Codex session on Windows.

## Limits

burhan reports and guides—it does not replace human judgment. It can only assess the edits and commands the agent reports to its hooks; shell edits are visible only through the supported shell forms.

## Links

- [Configuration](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md)
- [Changelog](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/CHANGELOG.md)
- [Roadmap](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/ROADMAP.md)
- [Arabic README](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/README.ar.md)
- [Issues](https://github.com/ahmedkamaldabour/burhan-kit/issues)

## License

MIT. See [LICENSE](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/LICENSE).
