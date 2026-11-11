---
name: burhan-build
description: Use when a sub-unit of an approved plan is about to be built, or any code is about to be written for a feature or a fix, before the first line of code
---

# burhan-build

A test you have not seen fail tells you nothing about the code it covers. Write the failing test first; code comes only after it.

## When
- Writing or changing code for a feature, a change, a refactor or a fix.
- Not for a patch with no escalator, and not while `burhan guide <slug>` says code edits are not authorized.

## Rules
1. Run `burhan guide <slug>` first: it says whether code may be edited and which sub-unit is next. Not authorized means stop and say why.
2. One sub-unit at a time, in the plan's order. Mark it `in-progress` with `burhan item set` before the first edit: `burhan item set <slug> unit <N> in-progress`, later `implemented`.
3. Write the sub-unit's test first, exactly as the build spec has it. Run the RED command: the failure must be the one the spec names, a missing behaviour and not a typo or a broken import.
4. Write the smallest code that passes, the spec's code as written. Add no feature, no refactor and no improvement beyond the test.
5. Run the GREEN command, then the fast check, and show both outputs. After a sub-unit run only its test files and the fast check; the whole suite runs at QC, before the a/b/c commit checkpoint, or when a fix lands outside the tests you ran.
6. Code written before its test is deleted and rewritten from the test. Keeping it as a reference or adapting it is testing after.
7. A step that does not behave as the spec says (a RED that passes, a GREEN that fails, a file that differs) is classified before anything else: a known answer is fixed and recorded as an applied deviation; one that needs a decision stops the build. A RED that passes at once means a premise of the spec is false: that is class B, so stop and never write the same test again. A line range or count in the spec that does not match the real file is class A: record it with `--apply` and go on.
8. Record a deviation with `burhan deviation add <slug> --unit <N> --what <t> --where <w> --output <o>`, adding `--apply "<why>"` only for class A, and keep your state line with `burhan state set <slug> <Label> <value>`.
9. When the sub-unit is green mark it `implemented` and ask for its review with burhan-review. Commit nothing: the commit waits for the a/b/c checkpoint.

## Shortcuts you will tell yourself

| Shortcut | Answer |
|---|---|
| "It is too simple to test" | Small code still breaks, and one short test costs less than the bug. |
| "I will write the test after" | A test that passes at once proves nothing; it has never been shown to fail. |
| "I tested it by hand" | A hand run leaves no record and cannot be repeated on the next change. |
| "The test is hard to write" | Hard to test means hard to use; change the design, not the rule. |
| "The spec's code looks wrong, I will improve it" | A difference from the spec is a deviation: record it, do not decide it. |

Stop and start the sub-unit over from its test if you catch yourself with code before a test, a test that passed at once, a RED you cannot explain, or tests "added later".

## Where the rules are
`.burhan/phases/stage-build.md` holds the build step, the modes and the two classes of problem found while building.
