# burhan — upgrading, rolling back, removing

[README](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/README.md) · [Configuration](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md)

`init`, `upgrade` and `uninstall` print what they would do and change nothing until you add `--apply`. Run them without `--apply` first.

## Upgrade

```bash
npx burhan-kit upgrade          # the plan, nothing written
npx burhan-kit upgrade --apply
npx burhan-kit doctor
```

- `upgrade` refreshes the kit-owned files (`.burhan/WORKFLOW.md`, `phases/`, `templates/`, `commands/`, `hooks/`, the Claude commands and agents) and the hook entries of the agents already installed. It is safe to repeat.
- It never rewrites `.burhan/bindings.md` or `.burhan/workflow.config`. `doctor` lists keys a newer version added; copy them from `kit/workflow.config.example` when you want them.
- It creates the empty state file (`.burhan/local/PROGRESS.md`, or the path in `WF_STATE_FILE`) when it is missing, and never changes one that exists.
- Your own hooks and settings stay: burhan's hooks run beside them.
- In Codex, trust the hooks again after an upgrade that changes one (Codex shows it as "Modified since last trusted"; see [Codex: trust the hooks](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md#codex-trust-the-hooks)).

## Upgrading from 0.6.0

`npx burhan-kit upgrade --apply` refreshes the kit files (the phase files, the commands, the templates and the hook scripts); your `workflow.config` and `bindings.md` are kept and no hook entry is added. The new task-file commands (`item new`, `item set`, `item check`, `item finish`, `gate tick`, `review add`, `approve`, `deviation`, `guide`) are available at once. **To switch on the checks that read the task files and the stage, add `WF_ITEM_CONTRACT="on"` to `.burhan/workflow.config`**: without it the contract, stage and deviation checks stay off (a project made by `burhan init` starts with it on). Two things run either way: the approval report, and the prompt hook now records whether your message had approval wording (a small file in the evidence store). A task started before 0.7.0 is checked as advice until its files carry `**Contract:** 1`. The agent reaches the commands through the kit command in `.burhan/bindings.md`; make sure it runs from the agent's shell.

Two things changed that a script could notice: a plan now has a second file, the build spec (`<slug>-build-spec.md`), and `burhan stats --json` no longer has the `words` key (there is no limit on how long a story, plan or review file may be, so there is no file size to report). `approve plan` refuses a plan that has no build spec (or a spec or plan with template placeholders left), whatever `WF_ITEM_CONTRACT` says for a plan made with the contract.

## Upgrading from 0.5.0

`npx burhan-kit upgrade --apply` refreshes the kit files; your `workflow.config` and `bindings.md` are kept. One thing can change for you: if a project links part of `.claude/`, `.burhan/`, `CLAUDE.md` or `AGENTS.md` to a place outside the project, `init`, `upgrade` and `setup` now stop before writing and list each file; pass `--allow-outside-links` (the 0.5.0 name `--allow-outside-settings` still works) or remove the link. Without such a link nothing changes. See [Files that are symbolic links](#files-that-are-symbolic-links).

## Upgrading from 0.4.1

`npx burhan-kit upgrade --apply` refreshes the kit files and adds one sixth hook entry: `pre-edit-skill`, a `PreToolUse` entry in `.claude/settings.json` (`Write|Edit|MultiEdit|NotebookEdit`) and in `.codex/hooks.json` (`apply_patch`). Your own hooks are kept, and a second upgrade changes nothing. In Codex, trust the hooks again afterwards (open `/hooks` and trust what it lists as new or modified; the existing entries are byte-identical to 0.4.1's, and Codex itself was not run for this release). The entry is silent unless `WF_SKILLS=superpowers`.

## Upgrading from 0.4.0

`npx burhan-kit upgrade --apply` refreshes the kit files and creates the empty state file (`.burhan/local/PROGRESS.md`, or the path in `WF_STATE_FILE`) when it is missing; one that exists is never changed. The hook entries it writes to `.claude/settings.json` and `.codex/hooks.json` were byte-identical to 0.4.0's (measured on a 0.4.0 install on Linux), so Codex has nothing new to trust.

## Upgrading from 0.3.0

`npx burhan-kit upgrade --apply` refreshes the kit files and adds the `/burhan:onboard` command. The hook entries it writes to `.claude/settings.json` and `.codex/hooks.json` are byte-identical to 0.3.0's (measured on a real 0.3.0 install), so Codex shows nothing new to trust; its own screen in `/hooks` is the reference. Then, in a new session, run `/burhan:onboard` once. Versions before 0.4.0 are deprecated.

## Upgrading from 0.2.2

`npx burhan-kit upgrade --apply` replaces the 0.2.2 bash hooks with the Node hooks and removes the old hook folders; your own hooks are kept. In Codex, trust the hooks again afterwards. Installs from 0.2.1 or older (under `.workflow/`) are not migrated: uninstall with that version, then run `npx burhan-kit`. See the [changelog](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/CHANGELOG.md).

## Going back to 0.2.2

Uninstall first, then install the old version, naming the agents you use. Running `upgrade` with 0.2.2 on a Node-hooks project would leave both sets of hooks, so every hook would run twice.

```bash
npx burhan-kit uninstall --apply
npx burhan-kit@0.2.2 init --agents claude,codex --apply
```

Your `workflow.config` and `bindings.md` are kept.

## Remove burhan

```bash
npx burhan-kit uninstall          # the plan
npx burhan-kit uninstall --apply  # remove the kit-owned files, blocks and hook entries
```

It keeps `workflow.config`, `bindings.md`, `.burhan/local/` and your work and discovery files unless you add `--all`, and never touches project memory, your own files, or anything outside the project.

## Files that are symbolic links

Any file the install writes may be a link: the hooks files (`.claude/settings.json`, `.codex/hooks.json`), `CLAUDE.md` and `AGENTS.md`, the managed `.claude/` files, `.burhan/` and the folders in it, `.gitignore`. A link whose real file stays inside the project is written as before. If the write would land **outside** the project (a link to the file, to a folder above it, or a dangling link), the dry run of `init` and `upgrade` prints `OUTSIDE:` followed by the file, an arrow and its real path and exits 1, and `--apply` refuses, names the first such file and changes nothing unless you pass `--allow-outside-links` (`--allow-outside-settings` still works as an alias). `setup` (the wizard, `--answers --apply` and `--set`) refuses the same way before its first write and takes the same flag.

`uninstall` is not changed by this rule.
