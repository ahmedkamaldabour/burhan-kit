# Stage — plan
> Part of the burhan working agreement (core: `.burhan/WORKFLOW.md`). **Read this when:** the story is approved (or the route has none) and you write the plan and the build spec.

## The plan step
- **Story approved (or no story on this route), no plan** → investigate the real code (cite file:line), re-verify the story's
  facts, then write `<slug>-implementation-plan.md` from `templates/plan.md` and `<slug>-build-spec.md` from
  `templates/build-spec.md` (read the real files and base every code block on them; list what you could not verify). An open *material*
  question blocks approval. **Present it and STOP for approval.**

```
  ③  PLAN   (P)  templates/plan.md and templates/build-spec.md — re-verify the story's facts against the CURRENT code
                 (what the story got wrong, with file:line), options + recommendation, rulings, the AC → test coverage, the
                 executor rules; the build spec holds, per sub-unit, the files, the complete test, the RED and GREEN commands
                 with their expected output, the complete code and the interfaces. An open material question blocks approval. A template placeholder left in the story, the plan or the build spec blocks it too (`approve` names it).
```

## The commands own the item files
Make and change an item's files with burhan's commands (the kit command in `.burhan/bindings.md`), so their shape is always the one the checks read:

| Step | Command |
|------|---------|
| start an item | `item new <slug> --type <t> --scope <s>`: the story, plan or findings from the templates with `**Contract:** 1`, and the item's block in Now |
| where am I, what next, may I edit code | `guide [slug]` |
| the owner approved a story, plan or QC | `approve story\|plan\|qc <slug> --by <owner's name>` (a plan is approved together with its build spec): only after the owner said yes in this conversation, never with your own name |
| a sub-unit moves on | `item set <slug> unit <N> in-progress\|implemented\|reviewed`: one rung at a time; Reviewed needs its review section |
| a gate is met | `gate tick <slug> <gate> [--evidence "…"]` |
| a review, QC or verification | `review add <slug> --kind review\|qc\|verification --by "<agent · model · context>"` (a review needs `--unit <N>`, a QC needs `--verdict`) |
| a step deviated from the plan | `deviation add <slug> --unit N --what … --where … --output …`: an open row in the plan's Deviations; the executor STOPS. The owner's decision: `deviation resolve <slug> <n> --approved\|--rejected --by <owner's name>` |
| the plan is done | `item finish <slug>`: every sub-unit Reviewed, the gates before Completed ticked, a passing proof after the last code edit |
| anything looks off | `item check <slug>` names every fault |

Writing the prose of a story or plan by hand is normal. Creating a file by hand, or editing a status or a gate line by hand, is the fallback: with `WF_ITEM_CONTRACT=on` the turn-end audit flags a file you wrote directly that breaks the contract or was created by hand without `**Contract:** 1`, and code edited while `guide` says "NOT authorized". The commands refuse a wrong step and say why; they never replace the owner's decisions.

## Re-validation by diff

The story's *Codebase verification* records **Verified at commit** (the sha at which its facts were
checked). Before the plan, and again before the first sub-unit, run `burhan changed --item <slug>`:
re-check only the facts whose files it lists, and write the list — or "no change since <sha>" — in the
plan. No sha, or a sha that is not a commit here → re-check every fact.
