# Stage — intake and story
> Part of the burhan working agreement (core: `.burhan/WORKFLOW.md`). **Read this when:** a request comes in and you route it, write a story, or ask the open questions.

## Intake and the story step
- **No item yet** → intake (.burhan/phases/lifecycle.md ①): restate the request, **classify type + scope + one-line
  reason** (§3, including scope escalators), preserve material inputs under `sources/`. Discover
  before asking — question the human only about business ambiguity.
  - **Read-only route** (investigation, bug + spike) → write `<slug>-findings.md` from
    `templates/findings.md`; mark `**Read-only:** yes` in the state file; never modify application code.
    Finish with the conclusion and, if code should change, propose a new routed item. Then run the
    knowledge review (.burhan/phases/memory.md) and the close-out (.burhan/phases/close-out.md) with state `Done (no QC)` — onboarding a repository
    instead stops for the human to approve the baseline. Stop.
  - Route includes **S** → write `<slug>-story.md` from `templates/story.md`.
  - Route says **S+P** → one approval gate, two files: write both `<slug>-story.md` and
    `<slug>-implementation-plan.md` from their templates (the plan as in phases/stage-plan.md), present
    them together and stop once. The approval covers both: the story's **Status** and the plan's
    **Overall status** become `Approved`.
  - Which files an item has: `.burhan/phases/files.md`.
  - Route starts at **P** (refactor, release) → skip the story; go to phases/stage-plan.md. Too big for one plan → propose a split into a parent and children
    (Decomposition, below). **Present it and STOP for approval.**

## Read-only work

**Read-only work (investigation, bug + spike).** Question → evidence → findings → limitations →
conclusion. **No application code is modified.** "Don't change application code" is not "write
nothing": the work item's own docs, discovery files and the state file may still be written. When
the human asks for a fully read-only pass, write nothing at all and report what would be recorded.
Output: `<slug>-findings.md` from `templates/findings.md`. Mark the item `**Read-only:** yes` in the
state file (core §5). To implement a finding, open a new routed item.

## A story the code already satisfies

When the facts you checked show that the code already does what the story asks, plan nothing and build nothing: tell the owner and put two choices to them, closing the item or changing the story. Closing is theirs to decide, with `burhan item close <slug> --already-satisfied "<reason>" --by <owner name>` (phases/close-out.md · Already satisfied); write the reason with the file and line that show it.

## The patch lane

For one obvious change (core §3 · `patch`). The state file records it as a `Now` entry
`### <slug>` with `- **Route:** <type> / patch` — or not at all when it is committed in the same turn. A patch that grows (an
escalator, a sensitive path, a second concern, any doubt) is promoted to `bounded` at once, and the
promotion is **said out loud** in the reply.

## Routing examples

| The request | Route | Why |
|---|---|---|
| Correct a typo in a message, or change the value of one setting | `change / patch` | One obvious change to what exists, with no escalator, nothing sensitive and no doubt. |
| Add one option that prints one more line of an existing report | `feature / bounded` | A one-line feature is bounded, never patch: it adds behaviour, so it has a story and a plan. |
| Add a method to a class its module exports, when nothing outside the module imports it | a doubt, not a settled escalator | Whether it is a public API is the owner's to settle, as the paragraph below says. |
| Change who may see a record, in one line | `change / architectural` | A visibility rule is an escalator, however small the change. |

When it is unclear whether a change meets a scope escalator, the agent does not settle it. It puts one question to the owner, with its recommendation, in the question round; it keeps the lighter route provisionally and says so in the story; the owner's answer settles the route.

## Decision card — the first lines of a story and a plan

The first lines of `<slug>-story.md` and `<slug>-implementation-plan.md`, down to the first blank line, are a **decision card**:
what changes, the files it touches, the risks, the route, and the **decisions needed from the human**.
Present the card at the ⛔ STOP; **approval is given on the card** — the rest of the file is the
evidence behind it, read only when the human wants to.

## Questions — one round

Ask **all open questions together, once**, as a numbered list (`Q-1`, `Q-2`, …) in the story — never
trickle them across turns. An answer that changes scope is an intent change (phases/stage-build.md · When the intent changes mid-flight).

## Decomposition

An item too large for one plan becomes a **parent** with **children**, each its own folder and
route. Each child lists the parent's AC IDs it answers for and its `depends on` siblings. The parent
is done only when every required child is done. **Language rule:** a child reaching done is
reported as "child X done, N/M children complete" — never as "project done".
