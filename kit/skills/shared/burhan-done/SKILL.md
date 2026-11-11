---
name: burhan-done
description: Use when about to say that work is done, fixed, passing or ready, and before any finish or the commit checkpoint
---

# burhan-done

No claim of success without evidence from a command run now.

## When
- Any sentence that says done, fixed, passing, working or ready.
- Before `burhan item finish`, before handing the work over, before the commit checkpoint.

## Rules
1. Name the claim, then the command that proves it.
2. Run that command fresh and in full through `burhan verify <slug> -- <command>`, so the result is recorded. It proves built work only: run before any code exists it proves nothing, and it is not to be run at the story or plan stage. Read all of the output and the exit code.
3. If the output does not back the claim, report the real state with the output. If it does, state the claim together with the output.
4. Match the claim to what proves it:

| Claim | Needs | Not enough |
|---|---|---|
| Tests pass | the test command's output with no failures | an earlier run, "it should pass" |
| The check is clean | the fast check's output with no errors | a partial run, a guess from nearby |
| The bug is fixed | the original symptom tested and passing | the code changed, so it must be fixed |
| The regression test works | it failed before the fix and passes after | it passed once |
| The agent finished | the diff shows the change | the agent said it succeeded |
| The requirements are met | each acceptance criterion checked line by line | the tests pass |

5. Evidence comes after the last edit: an edit after a passing run makes that run stale.
6. Check delegated work yourself, in the diff and in the output, not in the delegate's report.
7. Say what you did not run and what you assumed; a skipped step is said out loud.
8. An end-to-end verification pass is asked of the owner first: who runs it, them or you.
9. After the evidence, `burhan item finish <slug>`. Nothing is committed before the a/b/c checkpoint: show the files and ask.

## Shortcuts you will tell yourself

| Shortcut | Answer |
|---|---|
| "It should work now" | Run the command. |
| "I am confident" | Confidence is not evidence. |
| "The linter passed" | A linter does not run the tests or the build. |
| "A partial check is enough" | A partial check proves nothing about the rest. |
| "The agent said it worked" | Read the diff and the output yourself. |
| "I am tired and want it over" | Being tired is not a reason to claim what you have not seen. |

Words that give you away before the command has run: "should", "probably", "seems", "great", "done".

## Where the rules are
`.burhan/phases/stage-finish.md` holds the verification, the QC and the close-out; `.burhan/phases/close-out.md` holds the commit checkpoint.
