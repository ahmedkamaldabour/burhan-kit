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
- Your own hooks and settings stay: burhan's hooks run beside them.
- In Codex, trust the hooks again after an upgrade that changes one (Codex shows it as "Modified since last trusted"; see [Codex: trust the hooks](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md#codex-trust-the-hooks)).

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

## Settings files that are symbolic links

A hooks file (`.claude/settings.json`, `.codex/hooks.json`) may be a link. A link to a file inside the project is written as before. If it resolves **outside** the project (a link to the file, to a folder above it, or a dangling link), `init` and `upgrade` print `OUTSIDE:` followed by the file, an arrow and its real path in the plan and with `--apply`, and `--apply` refuses and changes nothing unless you pass `--allow-outside-settings`.

**Limit:** this guard covers `init` and `upgrade` and those two hooks files. `setup --set`, `setup --answers --apply`, and the other files `init` writes (`CLAUDE.md`, `AGENTS.md`, the managed `.claude/` files, a linked `.burhan`) still write through an outside link without it.
