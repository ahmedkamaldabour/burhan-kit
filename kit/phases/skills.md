# Process skills (optional binding)
> Part of the burhan working agreement (core: `.burhan/WORKFLOW.md`). **Read this when:** `WF_SKILLS` is set in the config.

If the bindings (core §1) name a skills plugin (`WF_SKILLS`), invoke the matching skill **before acting** in each
phase. With the Superpowers plugin:

| Phase / trigger | Skill |
|---|---|
| New feature/behaviour, before the story | `superpowers:brainstorming` |
| Story approved → plan | `superpowers:writing-plans` |
| Writing feature or fix code | `superpowers:test-driven-development` |
| Any bug, failing test, unexpected behaviour | `superpowers:systematic-debugging` |
| Reviewing a sub-unit's diff | `superpowers:requesting-code-review` |
| Before claiming done / passing / fixed | `superpowers:verification-before-completion` |
| Finishing a branch | `superpowers:finishing-a-development-branch` |
| Independent parallel tasks | `superpowers:dispatching-parallel-agents` |

With `none`, the table is a mental checklist of the same phases.
