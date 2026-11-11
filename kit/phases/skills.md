# Process skills
> Part of the burhan working agreement (core: `.burhan/WORKFLOW.md`). **Read this when:** you start one of the phases below, or a hook names a skill.

burhan ships six process skills with the kit: `.burhan/skills/<skill>/SKILL.md` for every agent and, for Claude Code, a managed copy in `.claude/skills/<skill>/SKILL.md` (a skill of yours with that name is never overwritten). Invoke the skill of the phase **before acting**: Claude Code with the Skill tool, Codex by reading the file. A skill holds the entry point and the discipline of its moment; the rules stay in the phase file it points to.

| Phase / trigger | Skill | Rules in |
|---|---|---|
| A request that adds or changes behaviour, before the story | `burhan-story` | `phases/stage-story.md` |
| Story approved, before the plan and the build spec | `burhan-plan` | `phases/stage-plan.md` |
| Writing feature, change or fix code | `burhan-build` | `phases/stage-build.md` |
| A bug, a failing test, a failed QC or an investigation | `burhan-debug` | `phases/stage-build.md`, `phases/stage-story.md` |
| Reviewing a sub-unit's diff | `burhan-review` | `phases/review.md` |
| Before saying done, fixed or passing | `burhan-done` | `phases/stage-finish.md` |

`burhan-verify` is not one of the six: it runs the fast check before a commit. Other plugins' skills may run beside these; the kit's rules win over any other skill, so a skill that asks for one question at a time, an early commit or a file outside the item's folder is overruled by the phase files. A skipped skill is reported at the end of the turn and never blocks (`phases/enforcement.md`); there is no setting that turns the skills off.
