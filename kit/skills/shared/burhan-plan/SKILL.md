---
name: burhan-plan
description: Use when a story is approved and its plan and build spec are about to be written, before either file is
---

# burhan-plan

Write the plan so that a builder who has not seen the story can follow it word for word. What the plan leaves open, the builder will guess.

## When
- The story is approved and no plan exists yet, or the route has a combined gate and the plan is written with the story.
- A plan is revised after a deviation the owner decided.
- Not for a patch.

## Rules
1. Start with the diff: `burhan changed --item <slug>` lists what moved since the story's sha. Re-check those facts only, and write what the story got wrong with file:line.
2. Read every file a sub-unit touches before you write its code. Each code block comes from the real file, never from memory; list what you could not read or run under Not verified.
3. Decide the sub-units last. Never invent a sub-unit or an A-reason for code that needs no change: stop and give the owner the choice between closing the item as already satisfied and changing the story. Take the fewest that stay inside one scope; each carries a `Why separate:` line holding only A1, A2, A3 or a list of them, at most six in all; the explanation goes in a paragraph under the sub-unit heading, because `burhan item check` rejects any other text on that line.
4. Write the plan and the build spec from the templates the item already holds, in the item's folder. This step writes nothing else and edits no code.
5. Per sub-unit the spec gives the files, the complete test, the RED and GREEN commands with their expected output, the complete code and the interfaces.
6. Never write a plan failure: "TBD" or "implement later", "add error handling" with no code, "tests for the above" with no test, "same as sub-unit 2" in place of the code, a step that says what to do but not how, a name that no sub-unit defines.
7. Check the plan against the story before you show it: every acceptance criterion maps to a test, names and signatures agree across sub-units, every command exists in this repository, and `burhan item check <slug>` passes.
8. For an architectural route give two or three options with a recommendation. Anything the owner must decide goes on the decision card as a numbered question.
9. Show the card and stop. With a combined gate (route S+P) the story and the plan are shown together and stopped on once; with separate gates the plan is written only after the story is approved. Approval is the owner's, given in this conversation. The owner runs `burhan approve plan` or tells you the command to run: no agent runs `burhan approve`; see burhan-story.

## Shortcuts you will tell yourself

| Shortcut | Answer |
|---|---|
| "The code is obvious, the spec can say implement it" | The builder follows the spec literally; a gap is a guess made later by a weaker reader. |
| "I remember that file" | Files drift between reading and writing; open it and cite file:line. |
| "More sub-units feel safer" | Each one costs a review; split only for a reason in the Sub-units section of the stage file. |
| "I will fix the plan after they approve" | Approval covers the text as shown; a later change is a deviation. |
| "I can start the first sub-unit while they read" | No code before the approval; the guide will say not authorized. |
| "The names will sort themselves out" | A function called by two names in two sub-units is a bug the spec wrote. |

## Where the rules are
`.burhan/phases/stage-plan.md` holds the plan step, the commands that own the item files and the sub-unit criteria; the shapes are `.burhan/templates/plan.md` and `.burhan/templates/build-spec.md`.
