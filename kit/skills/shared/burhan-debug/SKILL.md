---
name: burhan-debug
description: Use when a bug, a failing test, a failed QC or unexpected behaviour shows up, before proposing or making any fix; also for an investigation
---

# burhan-debug

Find the root cause before you fix anything. A fix on a guess hides the bug and starts the next one.

## When
- A bug, a failing test or build, a failed QC, a wrong result, a slow path.
- Most of all under time pressure, after a fix that did not work, or when the cause looks obvious.
- An investigation: its route is read-only, so the work ends at findings and no code changes.

## Rules
1. Open this skill before you read the failure output past its first line.
2. Reproduce it with exact steps and read the whole error, the stack trace and the line numbers. If it does not reproduce, gather more evidence; do not guess.
3. Look at what changed: the diff, recent commits, config, the environment.
4. When the path crosses components (CLI, hook, file), find the boundary where good data turns bad: record what enters and leaves each one, once, then read the result.
5. Find similar code that works and list every difference from the broken one, however small.
6. State one hypothesis, "X is the cause because Y", and write it down. Test it with the smallest change that can prove it wrong, changing one thing per try. If it is wrong, form a new one; never pile a second fix on the first.
7. Only with the cause confirmed: write the failing regression test (burhan-build), then make one fix at the cause. No change that is not needed for it.
8. Show the regression test passing and its neighbours still passing: evidence, not words.
9. After three failed fixes stop. When each fix reveals a new problem elsewhere, the design is wrong rather than the hypothesis: take it to the owner before a fourth.
10. Something you find that is outside the item's scope is a discovery to record, not a fix to make quietly.
11. On a read-only route write evidence, findings and limitations, and change no application code.

## Shortcuts you will tell yourself

| Shortcut | Answer |
|---|---|
| "The issue is simple, I do not need the process" | A small bug still has a cause, and the process is quick for it. |
| "There is no time, I will try something first" | Guessing and checking takes longer than finding the cause. |
| "The cause is clear to me, so I will fix it" | Seeing the symptom is not knowing the cause. |
| "I will change several things and run the tests" | You cannot tell which change worked, and each one can add a bug. |
| "I will write the test once the fix works" | An untested fix does not stay fixed; the failing test comes first. |
| "One more attempt" after two failures | Three failures point at the design; question it instead of trying again. |

Stop and go back to the reproduction rule if you catch yourself proposing a fix before tracing the data, or about to change something only to see what happens.

## Where the rules are
`.burhan/phases/stage-build.md` holds how a problem found while building is classified and recorded; `.burhan/phases/stage-story.md` holds the read-only route; `.burhan/phases/discoveries.md` holds what to do with what you find outside the item.
