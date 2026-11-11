---
name: burhan-review
description: Use when a sub-unit is implemented and needs its review, whether you are asking for it or performing it
---

# burhan-review

Review the diff, not the author's intentions. A reader who did not write the code sees what its writer cannot.

## When
- A sub-unit is Implemented, or a review group has just had its last sub-unit built.
- A re-review after findings were fixed.
- QC is different: it runs from its own command in a fresh context.

## Rules
1. Asking: give the reviewer only the plan's section of the sub-unit, `git diff --name-only <range>`, the item's file paths and the build's commands with their exit codes, word for word. No history and no summary of what you believe is right.
2. Use a fresh context where the agent allows it: the `burhan-reviewer` subagent in Claude Code, another session or agent elsewhere. A review in the same context says so under Limitations.
3. Wait for the report before the next sub-unit starts.
4. Reviewing: read the plan's section, every hunk of the diff in full, then the code the diff points to. Security comes first: authorization, record-level visibility and secrets, tested for the allowed and the denied case.
5. Choose the lane by risk: short for a sub-unit that touches nothing sensitive and no escalator, full otherwise, and full when in doubt.
6. Read the order of events from the ledger (`burhan evidence --item <slug>`): a failing run before the edit, a passing run after the last one. When the ledger cannot show it yet, run the GREEN command yourself and write that the order is stated by the builder.
7. A finding is the claim, the location and the result in one line, with a severity of Critical, Important or Minor. Record it with `burhan finding add <slug> --in review:<unit> --severity <S> --text <t>`, or with `--none` in place of the severity and text after a full read finds nothing. The reviewer proposes; the owner decides each row.
8. Write the section with `burhan review add <slug> --kind review --unit <N> --by "<agent> · <model> · <context>"`, the context being exactly one of fresh subagent | other agent | human | same session. It writes the section header; the Checks run and Limitations lines are added by hand. When the kit command cannot run, do not write the section by hand: report the findings in the handback for the caller to record.
9. With an open Critical or Important finding the sub-unit is not marked reviewed: fix the finding in scope, re-run the tests it touches and re-do the review as the section Re-review after findings of `.burhan/phases/review.md` says. Mark it reviewed only after the section is written and none is open. A finding outside the item's scope becomes a discovery.
10. A RED of the spec that cannot fail on the code as it stands is a plan defect: record it as a finding for the owner, not as a fault of the builder.

## Shortcuts you will tell yourself

| Shortcut | Answer |
|---|---|
| "The diff is small, I will skim it" | Small diffs in access rules do the most harm; read every hunk. |
| "The tests pass, so it is fine" | Tests show what was tested; a review looks for what was not. |
| "I wrote it, so I know it is right" | That is exactly why you cannot review it. |
| "I will fix the finding quietly" | Record it first; the owner decides the row and the row stays. |
| "The reviewer is wrong, I will ignore it" | Answer with evidence in the row; the owner decides. |

## Where the rules are
`.burhan/phases/review.md` holds the lanes, the reading discipline, how findings are decided and the checklist; `.burhan/phases/stage-build.md` holds when a review runs.
