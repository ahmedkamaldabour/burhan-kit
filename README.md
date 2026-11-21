# burhan

Coding agents say “done” without proof.

burhan is **spec-driven development (SDD)** for Claude Code and Codex. The story and plan are the spec: you approve them before code, each acceptance criterion maps to a test, and a step that departs from them is recorded: a problem that needs your decision stops the work, a problem with a known fix is fixed and noted. Each step is reviewed, and task commands and hooks (small scripts that report at set moments) keep proof of what ran.

- **Agree first:** approve the story (what and why) and plan (how) before code.
- **Show proof:** record edits and commands; flag “done” without a passing check.
- **You commit:** choose now, later, or yourself.

[![npm version](https://img.shields.io/npm/v/burhan-kit.svg)](https://www.npmjs.com/package/burhan-kit) [![CI](https://github.com/ahmedkamaldabour/burhan-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/ahmedkamaldabour/burhan-kit/actions/workflows/ci.yml) [![MIT license](https://img.shields.io/github/license/ahmedkamaldabour/burhan-kit.svg)](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/LICENSE) **Node 22+**

[العربية](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/README.ar.md)

## Problem and answer

| An agent alone can | burhan helps it |
| --- | --- |
| Write before you agree what matters | Stop for your yes on the story and the plan |
| Call work done without current proof | Warn when the last code edit lacks a passing check |
| Review its own memory of the work | Have a separate reviewer check each step, where feasible |
| Lose the record in chat | Keep task files and a record of the edits and commands the agent reports (the ledger) |
| Start each session blind | Point it at project memory and the task state |

Use burhan when human decisions, reviewable records, and proportional process matter. It cannot physically stop an agent or prove unreported work.

## A 60-second tour

This is a shortened real run from the [first-task walkthrough](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/first-task.md).

```text
you    /burhan:e2e slugify — add a function slugify(text) in src/slugify.js … with a test
agent  burhan needs one thing before it can check your work: …
         Check before commit   `npm test` (runs `node --test` …) …
       ● Use these   ○ Change something
you    Use these.
agent  **Route:** feature / bounded. It's one pure function with no scope escalator, so it gets one combined story and plan gate. …
       **Waiting on you:** reply "approved" to approve both the story and the plan … I won't write code before then.
```

You choose the proposed checks. The agent names the route (how much process this task gets) and writes a story and plan. Your `approved` is its turn to build; it still stops for later human decisions. The first block is first-use setup: later tasks start at the route. Gate, route and scope escalator are in the terms table below.

## Quick start

**Requirements:** Node 22+; Claude Code 2.1.139 or newer and/or Codex with its hooks trusted; the kit installed in the project (`npm i -D burhan-kit`) or on the PATH (`npm i -g burhan-kit`). In these docs `burhan` means the project's kit command, the one in `.burhan/bindings.md`: `npx burhan-kit` runs the copy installed in the project, and a plain `burhan` works only where it is on the PATH. burhan does not run npm: when setup finds no kit command it prints the install command for you to run.

1. Nothing else to install: burhan ships its own process skills (story, plan, build, debug, review, done) and step 2 installs them.

2. In the project root, with Node 22 or newer, run:

   ```bash
   npx burhan-kit
   npx burhan-kit doctor
   ```

   Setup asks questions, shows a summary, and writes only after confirmation. Existing hooks stay. On Codex, [trust the project hooks](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md#codex-trust-the-hooks) in `/hooks`; otherwise they do not run. A healthy setup says `all 6 hooks wired`.

3. Open a **new** agent session in the project. Type `start` (any first message works); or use `/burhan:onboard` in Claude Code; or type `Follow .burhan/commands/onboard.md` in Codex. The agent proposes project checks and understanding for your approval.

Start a task with `/burhan:e2e <slug>` in Claude Code. In Codex, follow the command file under `.burhan/commands/`. The next section walks through a first task; the sections after it explain each part, and Reference at the end is for lookup.

## Your first task

After setup, ask for something small, such as a function with a test. The agent walks the stops below and waits for you at each one; the right column is what it runs (every command has `--help`, which prints its usage). In `step` mode, the default, you see every stop.

| Stop | You decide | The agent runs |
| --- | --- | --- |
| 1 · Intake | whether the route (type, scope, reason) fits | `item new <slug> --type feature --scope bounded`, then `guide <slug>` |
| 2 · Story and plan | answer its questions, read the one-screen card, say yes, then run `approve story <slug> --by <name>` and `approve plan <slug> --by <name>` with your name (the agent shows you the command) | writes the story, the plan and the build spec, then `item check <slug>` |
| 3 · One sub-unit | whether to go on (`step` stops after each) | the test first and seen failing (RED), the code, the same test passing (GREEN), the fast check; `item set <slug> unit 1 in-progress` before, `item set <slug> unit 1 implemented` after |
| 4 · Review | every finding: fixed, a discovery, or accepted with your reason | a fresh reviewer: `review add <slug> --kind review --unit 1 --by "<agent · model · context>"` and `finding add`; you answer with `finding decide`; then `item set <slug> unit 1 reviewed` |
| 5 · A surprise (at any stop) | only a problem that needs a decision stops the work | a known fix is fixed and noted with `deviation add <slug> … --apply` and the build goes on; a real choice is `deviation add <slug> …` and a stop until you run `deviation resolve` |
| 6 · Verify | who runs the real check (the agent asks first) | `verify <slug> -- npm test` (your project's own command), then `review add <slug> --kind verification` |
| 7 · QC | accept PASS, or send the task back to build | a fresh reviewer: `review add <slug> --kind qc --verdict PASS` and `finding add <slug> --in qc --none`; you accept it with `approve qc <slug> --by <name>` |
| 8 · Close | which lessons to keep; commit now, later, or yourself | `item finish <slug>` (it names each gate still open; tick one with `gate tick <slug> <gate> --evidence <proof>`), then `state close <slug> --outcome <state> --commit <id> --folder <path>` |

A smaller route skips the stops it does not need (see Routes). At any point `burhan guide <slug>` says the stage, whether code edits are authorized, and the next step.

## What burhan puts in your project

```text
.burhan/
  WORKFLOW.md SETUP.md VERSION phases/ templates/ commands/ skills/ hooks/  kit-owned; upgrade refreshes
  bindings.md workflow.config                                     yours; commit and review
  PROJECT.md context/                                             shared project memory, when onboarded
  local/PROGRESS.md                                               per developer; git-ignored
  work/NNN-slug/                                                  task files; private with init, in git if you choose so in setup
  discovery/                                                      side findings; private with init, in git if you choose so in setup
  .gitignore                                                      ignores local/, work/, discovery/
.claude/ or .codex/                                               hook settings and agent bindings
.claude/skills/burhan-*/                                          Claude Code only: managed copies of the skills
CLAUDE.md or AGENTS.md                                            marked burhan block; outside text stays yours
```

Do not edit kit-owned files. `upgrade` refreshes them. Keep `bindings.md`, `workflow.config`, memory, and shared task files in version control.

A task folder is named `NNN-slug`, for example `work/012-slugify/`: `item new` takes the next number (the highest plus one), and every command accepts the number, the plain slug or the full name. A folder made before numbering keeps its name. `skills/` holds the six process skills that come with the kit (see Reference); a skill of yours with the same name in `.claude/skills/` is never overwritten.

`init` keeps work and discovery private; the setup wizard recommends putting them in git. Either way, `WF_DOCS_DIR` and `WF_DISCOVERY_DIR` choose the folders, for example `docs/burhan/work` and `docs/burhan/discovery`; see [configuration](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md#workflowconfig).

## How burhan works

| Term | Meaning |
| --- | --- |
| Story | what and why, with acceptance criteria |
| Plan | how: the decisions, plus a build spec (the exact tests and code) |
| Route | a task's type, scope and a one-line reason; it sets the steps |
| Intake | the agent restates your request and picks the route |
| Task (item) | one piece of work with its own folder; its short name is the `<slug>` |
| Gate | a point where the agent waits for you |
| Sub-unit | one small planned build step |
| QC | the final independent quality check |
| Knowledge review | the agent proposes lessons worth keeping; you keep or reject them |
| Baseline | your approved (or waived) record of what the agent understood about the project |
| Deviation | a step that did not go as the build spec said, recorded as a row of the plan |
| Deviation, applied | a problem whose fix is already known: the agent fixes it, records it with `deviation add --apply`, and the build goes on |
| Deviation, open | a problem that needs a decision: the work stops until you decide it |
| Finding | a problem a review or QC reports, with a severity: Critical, Important or Minor |
| Decision | your recorded answer on a finding: fixed, a discovery, or accepted with a reason (never for a Critical) |
| Discovery | something found that the task did not ask for; it goes to its own file and is done as its own task |
| Legacy | the state of an old finished task with no route line and no QC file; the index folds these into one block |
| RED / GREEN | a test failing as expected / the same test passing |
| Hook | a small script that reports at a set moment |
| Ledger | the record of the edits and commands the agent reports |
| Scope escalator | a high-risk trait (listed under Routes) that makes a task architectural |

```text
you ask → Intake → Story ✋ → Plan ✋ → ┌ Build → Review ┐ → Verify ✋ → QC ✋ → Knowledge ✋ → Commit ✋
                                      └ repeats per sub-unit ┘

✋  always you, in both modes: approve, choose, accept
step  ⏸ also pauses after every sub-unit's build and review
auto  runs the loop straight through, keeping the ✋ stops; it also stops at a brake ⚠: a problem that needs your
      decision (a change of intent, a real choice, security, data, money, an action that
      cannot be undone); a problem with a known fix is fixed, recorded, and the build goes on
```

The route chooses gates. The mode chooses pauses between sub-units; it is not agent permission.

| A three-sub-unit task | step | auto |
| --- | --- | --- |
| Story and plan | you approve | you approve once on bounded work |
| Build and review | pauses after each | continues between them |
| Verification | asks when ready | asks once at the start |
| QC and commit | you decide | you decide |

`step` is the default. Say “go end to end” for `auto`, or “wait for my approval” for `step`. “Plan only” ends after an approved plan and writes no code.

## Life of a task

```text
work/NNN-slug/
  NNN-slug-story.md                Draft → Approved                 approve story
  NNN-slug-implementation-plan.md  Draft → Approved → In progress → Completed   approve plan; item set; item finish
  NNN-slug-build-spec.md           exact tests, code, commands      approved with plan
  NNN-slug-verify.jsonl            every proof run: command, exit code, time   verify
  reviews/                         review, verification, QC reports, each with a findings table   review add; finding add
  sources/                         originals you gave the agent; never edited
  repro/                           the agent's scripts and logs
  NNN-slug-state-notes.md          the full text of state lines shortened by state compact (when used)
  NNN-slug-already-satisfied.md    your written reason, when the code already met the story (when used)
.burhan/local/PROGRESS.md          one current-state block per task
```

Each sub-unit moves **Draft → Approved → In progress → Implemented → Reviewed**. `item set` permits one rung at a time. A review section is required before `Reviewed`.

The plan is two files: the decisions (with acceptance-criterion coverage and rulings) and a build spec. The spec gives each sub-unit its files, complete test and code, RED and GREEN commands, expected output, and interfaces. A sub-unit is its own step only for a reason: it touches a sensitive path, it writes your decision or a gate, or its behaviour needs its own failing test. `item check` reports a sub-unit with no reason, and a plan with more than six sub-units that does not say why.

Build exactly that spec. If RED does not fail as expected, GREEN fails, or a file differs, the agent first asks whether a decision is needed. When none is (the spec's wording does not match the code, or a review finding inside the task whose fix keeps the story), it fixes the problem, records it with `deviation add … --apply` and a written reason, and the build goes on; `guide` and `item finish` list every such row for you. A change of the approved intent or scope, a real choice, security, data, money, anything irreversible, or an edit of an older test needs your decision: the agent records an open `deviation add` row and asks, `guide` says code is not authorized until you decide it with `deviation resolve`, and an approved deviation updates the plan and spec first, then the code. Once the approved change is carried out, `deviation done` writes which sub-unit did it, and `item finish` refuses an approved row with no such trace.

## Routes

Every request gets a route before work: type, scope, and a one-line reason. You can correct it. Any one of these makes a task architectural, whatever its size, and is called a **scope escalator**: security or privacy impact · authorization or visibility rules · persistent data-model or migration changes · money or accounting correctness · derived state shared across modules · external integration contracts or public APIs · irreversible behaviour · concurrency or transaction rules. A `patch` exists only for a change, bug or refactor.

| Route | Required journey | Key point |
| --- | --- | --- |
| Feature, bounded | story + plan, build, review, verify, QC, knowledge | one approval for story and plan |
| Feature, architectural | story, plan, build, review, verify, QC, knowledge | plan presents design options |
| Change, bounded | story + plan, build, review, verify, knowledge | no QC |
| Change, architectural | story, plan, build, review, verify, QC, knowledge | two approvals |
| Bug, bounded | story + plan, build, review, verify, knowledge | root cause and failing regression test first |
| Bug, architectural | story, plan, build, review, verify, QC, knowledge | two approvals |
| Refactor, bounded | plan, build, review, verify | behavior-preserving tests first |
| Refactor, architectural | plan, build, review, verify, knowledge | plan presents options |
| Release | plan, verify, review | architectural release includes rollback |
| Patch | routing line, change, proof, commit checkpoint | one obvious safe change; no story or plan |
| Investigation | findings, knowledge | read-only; no application code |

## What only you decide

| Decision | How burhan holds it |
| --- | --- |
| Story and plan | `approve` records your name and refuses an agent's name; the decision stays yours |
| Baseline | the agent writes it only after you approve, correct, or waive |
| Who verifies | the agent asks before real verification |
| QC verdict | QC proposes PASS or FAIL; you accept it |
| A review or QC finding | `finding decide` records your answer: fixed, a discovery, or accepted with your reason (never for a Critical); `item finish` and `approve qc` wait for every decision |
| A deviation or discovery | a problem that needs your decision stops the work; one with a known fix is fixed and listed for you; a separate finding is not silently fixed |
| Closing a task the code already satisfies | `item close` with `--already-satisfied`, a written reason and your name; an agent's name is refused |
| Commit | you choose now, later, or yourself; “finish” is not approval |
| Push or pull request | only when you ask |
| Codex hook trust | you grant it; burhan never does |

## Reviews

| Review | When | What it establishes |
| --- | --- | --- |
| Sub-unit | after build, before the next unit | the planned small change is sound |
| Review group | after a planned group | one short review for one non-sensitive area |
| Re-review | after findings | the fix and prior findings; widen when needed |
| Verification | after reviewed sub-units | runs against every acceptance criterion |
| Final QC | routes that require QC | fresh, adversarial convergence review |

A reviewer reads the task files, diff, and ledger, then writes a report. Reviews record `Performed by`: agent, model, and context. The other agent can review when configured. Same-session QC is marked and counted as self-review.

A review or QC report ends with a findings table: `finding add` writes a row, or the line `No findings.`. Every row waits for your decision (see What only you decide). QC proposes `PASS` or `FAIL — N issues`, with Critical, Important, or Minor findings. PASS is evidence, not a guarantee. A FAIL returns the task to build; the next QC confirms the fix or widens the review.

## Proof

Hooks report and fail open; they never block. Task commands refuse a wrong lifecycle step, but an agent can skip them.
The block `burhan init` writes into `CLAUDE.md` and `AGENTS.md` tells the agent to run `burhan guide` before it edits and to follow the answer, and `guide` still answers when no item exists. That is an instruction, not a lock: a direct edit, a shell write and who approved are not stopped. `burhan verify <slug> -- <command>` runs a proof command itself and records its exit code and the code state it ran on; `item finish` accepts that record, so a project without hooks gets a recorded proof, or states one with `--evidence`. The record shows that a command ran and how it ended, not that it tests the right thing. `verify` refuses an item that has not reached build: nothing is built yet, so a proof would prove nothing, and nothing is recorded.

| Moment | Hook | Purpose |
| --- | --- | --- |
| Session start | `session-gates` | gates, task state, first-use setup, tasks in flight, a missing kit command |
| Your prompt | `prompt-router` | phase and mode suggestion; baseline reminder |
| Before commit | `pre-commit-check` | fast check and your commit choice |
| Before a write | `pre-edit-skill` | missing skill and another session's state block |
| After an edit | `post-edit-reminder` | test-first and sensitive-path reminder |
| End of turn | `turn-audit` | evidence, lifecycle, and completion audit |

The audit flags “done” without passing proof after the last code edit. It also flags stale state, code before a decided baseline, read-only code, skipped skills, weak QC provenance, and broken task-file contracts.

```text
⚠ VERIFICATION GATE: completion was claimed, but the last run of `npm test 2>&1 | tail -15` was blocked and never ran. Run it, show the output — or retract the claim.
```

The [recorded run](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/first-task.md) shows that warning making an agent retract “Done.”

The ledger is outside the project at `~/.local/state/burhan/evidence/`. It records reported edits, command lines, exit codes, order, and task association; not command output. It is written when a turn ends, so the steps of the current turn are not in it yet. `evidence --item <slug>` prints it.

A passing whole-suite run after the last code edit can serve verification, QC, and commit. Reuse it until code or tests change. `guide` reports `full run:` status.

## Reference

Look things up here; you do not need it for your first task.

### Settings

`WF_CHECK_CMD` is the fast pre-commit check. `WF_CODE_REGEX` and `WF_TEST_REGEX` identify code and tests. `WF_EVIDENCE_REGEX` says which commands count as proof. `WF_FULL_TEST_REGEX` identifies the whole suite. `WF_SENSITIVE_REGEX` and `WF_SENSITIVE_NOTE` add a sensitive-path reminder. With empty code or proof patterns, the “done” warning cannot work. A project created by `burhan init` has task-file checks on (`WF_ITEM_CONTRACT=on`). `burhan setup --set` saves the check and the code, test, proof, whole-suite and sensitive-path settings without a hand edit.

`WF_STACK_SETUP` says whether first-use setup is still waiting. `WF_MODE_DEFAULT` is `step` or `auto`; a key such as `WF_MODE_BUG_BOUNDED=auto` sets one route. `WF_MODEL_CLAUDE_PLANNER`, `WF_MODEL_CLAUDE_BUILDER`, `WF_MODEL_CLAUDE_EXPLORER` and `WF_MODEL_CLAUDE_REVIEWER` choose a model for each Claude Code role; empty keeps the session's model. `WF_REVIEWER_AGENT` says who runs QC. `WF_EVIDENCE_LEDGER` and `WF_EVIDENCE_DIR` switch the ledger and move it. [Configuration](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md#workflowconfig) lists every key.

### Commands

Every command has `--help` (`burhan item --help`, `burhan finding add --help`); it only prints the usage. In the table, `<slug>` is a task's short name, its number or its full folder name.

| What you do | Commands |
| --- | --- |
| Start and find your way | `item new` creates the route-shaped files and the task's block in your state file; `guide` says the stage, whether code edits are authorized, the skill to run and the next step; `use <slug>` links a session to one task; `item list` prints one line per task (id, route, state) and writes nothing |
| Decide (yours) | `approve` records your approval of a story, plan or QC; `finding decide` and `finding discover` answer findings; `deviation resolve` decides an open deviation; `item close <slug> --already-satisfied` closes a task the code already satisfies; each takes your name with `--by` and refuses an agent's |
| Record the work | `item set` moves one allowed status; `gate tick` ticks a gate once its evidence exists; `review add` writes a review, QC or verification with reviewer provenance; `finding add` and `finding list`; `deviation add` (with `--apply` for a problem that needs no decision) and `deviation done`; `verify <slug> -- <command>`; `item finish` needs reviewed units, ticked gates, no open deviation and fresh proof; `item check` names every fault in a task's files |
| Your state file | `state show` prints your task's block; `state set` and `state close` change only that block, under a lock; `state compact` shortens the lines of closed tasks (a dry run until `--apply`) |
| Read-only reports | `status` (`--write` also writes the task index), `stats`, `evidence`, `changed`, `pr-body`, `memory`, `inspect`, `doctor` |
| Install | `init`, `upgrade` and `uninstall` (dry runs until `--apply`); `setup` with `--stack`, `--set`, `--agent` or `--answers` |

The agent changes its own block of the state file only through `burhan state`; a hand edit is still possible and nothing stops it. In `status`, an old finished task with no route line and no QC file shows as `Legacy`, folded into one counted block. The agent runs these as `npx burhan-kit` followed by the command; you can too. Every command except `init` finds the project from any subfolder, as git does: it walks up to the nearest folder with `.burhan/WORKFLOW.md` and names it on stderr.

### Project memory

Onboarding scans the project and drafts `.burhan/PROJECT.md` plus fact files in `.burhan/context/`. You approve, correct, or waive the baseline. Facts cite a path and a short hash, not file content. `memory status` marks facts fresh, changed, missing, or unchecked; `memory check` can run in CI; `memory affected` names the facts whose files changed since a git ref. Knowledge review proposes durable lessons for your decision.

### Claude Code and Codex

Claude Code uses `/burhan:e2e`, `/burhan:qc`, and `/burhan:onboard`; Codex follows installed command files through `AGENTS.md`. Codex hook results need trust. A command with no recorded result is not passing.

burhan ships six process skills and installs them with the kit, so there is nothing to add from elsewhere. Each is a short checklist the agent opens at the start of a phase, before it acts; the rules stay in the phase files.

| Skill | The agent opens it | What it is for |
| --- | --- | --- |
| `burhan-story` | a request that adds or changes behaviour, before the story | one round of questions, the route, a story you can approve in one reading |
| `burhan-plan` | the story is approved, before the plan and build spec | a plan a builder can follow word for word, in the fewest sub-units |
| `burhan-build` | before the code of a sub-unit | the test first and seen failing |
| `burhan-debug` | a bug, a failing test or a failed QC | find the root cause before any fix |
| `burhan-review` | a sub-unit is implemented | review the diff, record findings |
| `burhan-done` | before saying done, fixed or passing | no claim without a command run now |

They land in `.burhan/skills/` for both agents and, for Claude Code, as managed copies in `.claude/skills/`; Codex reads the file in `.burhan/skills/` when the phase starts. A skill of yours with the same name is never overwritten, and `uninstall` removes only what burhan wrote. A skipped skill is reported at the end of the turn and never blocks.

Claude Code can generate planner, builder, explorer, and reviewer roles on configured models. Codex uses your own model configuration; burhan never writes it.

Several sessions can work on separate tasks. Keep one task per session. Shared configuration, memory, and shared task folders go through review; `.burhan/local/` stays personal.

### Safety and rollback

`init`, `upgrade`, and `uninstall` are dry runs until `--apply`. Setup validates before its first write. Upgrade refreshes kit files and merges exact hook entries without overwriting `workflow.config` or `bindings.md`. Writes through a link outside the project are refused unless you explicitly allow them.

Uninstall removes the kit folders under `.burhan/` whole: `WORKFLOW.md`, `SETUP.md`, `VERSION`, `phases`, `templates`, `commands`, `skills`, and `hooks`. Under `.claude/` it removes only the files that carry burhan's mark: the skill copies, commands and agents burhan wrote; a file of yours is never removed. It keeps `workflow.config`, `bindings.md`, `.burhan/local/`, and task files unless you add `--all`. `--all` removes the private `work/` and `discovery/` folders; a shared task folder you pointed `WF_DOCS_DIR` at is never removed.

### Limits

- Hooks never block; task commands refuse a wrong step; an agent can skip both.
- The start-up list in the agent file is an instruction; nothing stops an agent that ignores it.
- Hooks see only activity the agent reports. Shell edits are visible only through `>`, `>>`, and `tee`.
- Codex hooks need trust. Missing recorded command results do not pass.
- Windows CI runs the Node suite on `windows-latest`, Node 24, without bash or `jq`. It is not PowerShell-only coverage or a real agent session.
- The ledger grows until you delete it. It does not prove activity outside reported tool calls.

### FAQ

**Does every task use every stage?** No. The route chooses the proportional path; a patch skips story and plan.

**Does burhan require a language or framework?** No. You configure the checks and patterns for your project.

**Does burhan send project data over the network?** Its source contains no network client calls. Package installation can use the network.

### Docs

[Features and routes](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/features.md) · [Configuration](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md) · [Recorded first task](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/first-task.md) · [Upgrading](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/upgrading.md) · [CI and Windows](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/ci-and-windows.md) · [Changelog](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/CHANGELOG.md) · [Roadmap](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/ROADMAP.md) · [Issues](https://github.com/ahmedkamaldabour/burhan-kit/issues) · The long guide is the handbook: read the [PDF](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/handbook/en/burhan-handbook-en.pdf), or open `handbook/en/handbook.html` after you clone.

## License

MIT. See [LICENSE](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/LICENSE).
