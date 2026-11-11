---
name: burhan-story
description: Use when a request would add or change behaviour, or asks for an investigation, before the story file is written
---

# burhan-story

Turn the request into a story the owner can approve in one reading. Nothing is planned or built until they do.

## When
- A feature, a change, a refactor or a bug that needs a story, or an investigation.
- A story the owner sends back for changes.
- Not for a patch: one obvious change with no scope escalator needs only its routing line.

## Rules
1. Route the request first: type, scope and one line of reason. Any scope escalator makes it architectural, however small the change looks. A doubt about an escalator (for example whether a new method of an exported class is a public API) is one of your questions to the owner, with a recommendation, never decided silently. While it is open, hold the lighter route provisionally and say so in the story; the owner's answer settles it.
2. Open the item with `burhan item new <slug> --type <type> --scope <scope>`, then fill the files it made. They live in the item's folder under the docs location, nowhere else. `item new` prints the full id with its number (for example 001-<slug>): use that id in every command and file name. The lines under Decisions taken at approval are the owner's: leave them as placeholders until they have answered.
3. Read the code before you ask anything. A question the repository can answer is yours to answer; the owner gets only business rules, policy and acceptance criteria.
4. For a bug, run the failing test only to confirm that it fails; look for the cause after burhan-debug is open. Re-check each fact the story leans on and record the commit sha you checked it at. When the code already does what the story asks, tell the owner and ask whether to close the item as already satisfied or to change the story; do not plan it.
5. If the request reads two ways, write both readings as one question with your recommended answer. For an architectural story, consider two or three approaches and recommend one; the owner decides. How to build it is the plan's job, not the story's.
6. Send every open question in one round: numbered, the material ones marked, a recommendation on each. A later round is only for an answer that raises a new material question.
7. Write acceptance criteria that can be observed: what happens, for whom, with which data. A criterion that names a technique is a plan detail.
8. Put the decision card first, then stop. Approval is the owner's yes followed by `burhan approve story`; no agent runs `burhan approve`, not as a test and not with any name: the owner runs it or tells you the command to run. With a combined gate (route S+P) write the story and the plan together and stop once, writing the plan and the build spec with burhan-plan open; with separate gates (an architectural item) stop after the story and write the plan after the approval.
9. `burhan item check` reports the still-empty plan until the plan is written; that is expected at the story stage.

## Shortcuts you will tell yourself

| Shortcut | Answer |
|---|---|
| "It is clear enough, I will skip the story" | Clear to you is not approved by them; a story costs minutes, a wrong build costs days. |
| "I will ask as the questions come up" | Each separate question is a round trip for the owner; collect them and send one list. |
| "I can guess the policy" | A guessed rule about money, access or visibility ships as a defect. Ask. |
| "They said it sounds good, that is approval" | Approval is an explicit yes to this story, then the command with their name. |
| "It is only a small change" | Check the escalators first; a small change to permissions is architectural. |
| "I will note the sha later" | A fact with no commit sha goes stale without anyone seeing it. |

## Where the rules are
`.burhan/phases/stage-story.md` holds intake, the question round, the decision card and decomposition; the shape of the file is `.burhan/templates/story.md`.
