# burhan

Coding agents say “done” without proof.

burhan is **spec-driven development (SDD)** for Claude Code and Codex. The story and plan are the spec: you approve them before code, each acceptance criterion maps to a test, and work that departs from them stops and is recorded. Each step is reviewed, and task commands and hooks (small scripts that report at set moments) keep proof of what ran.

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

1. Optional, recommended: install Superpowers first, so setup can switch its skills on. burhan never installs it. In Claude Code use `/plugin install superpowers@claude-plugins-official`; in Codex use `/plugins`, search `superpowers` and install it; after step 2, also set `WF_SKILLS='superpowers'` in `.burhan/workflow.config` (setup cannot see Codex plugins). Superpowers is a plugin of process skills for the agent; burhan maps its phases to them.

2. In the project root, with Node 22 or newer, run:

   ```bash
   npx burhan-kit
   npx burhan-kit doctor
   ```

   Setup asks questions, shows a summary, and writes only after confirmation. Existing hooks stay. On Codex, [trust the project hooks](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md#codex-trust-the-hooks) in `/hooks`; otherwise they do not run. A healthy setup says `all 6 hooks wired`.

3. Open a **new** agent session in the project. Type `start` (any first message works); or use `/burhan:onboard` in Claude Code; or type `Follow .burhan/commands/onboard.md` in Codex. The agent proposes project checks and understanding for your approval.

Start a task with `/burhan:e2e <slug>` in Claude Code. In Codex, follow the command file under `.burhan/commands/`.

## What burhan puts in your project

```text
.burhan/
  WORKFLOW.md SETUP.md VERSION phases/ templates/ commands/ hooks/  kit-owned; upgrade refreshes
  bindings.md workflow.config                                     yours; commit and review
  PROJECT.md context/                                             shared project memory, when onboarded
  local/PROGRESS.md                                               per developer; git-ignored
  work/<task>/                                                    private task files by default
  discovery/                                                      private side findings by default
  .gitignore                                                      ignores local/, work/, discovery/
.claude/ or .codex/                                               hook settings and agent bindings
CLAUDE.md or AGENTS.md                                            marked burhan block; outside text stays yours
```

Do not edit kit-owned files. `upgrade` refreshes them. Keep `bindings.md`, `workflow.config`, memory, and shared task files in version control.

By default work and discovery are private. To share them, point `WF_DOCS_DIR` at a path such as `docs/burhan/work` and `WF_DISCOVERY_DIR` at `docs/burhan/discovery`; see [configuration](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md#workflowconfig).

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
| Deviation | a step that left the approved plan |
| RED / GREEN | a test failing as expected / the same test passing |
| Hook | a small script that reports at a set moment |
| Ledger | the record of the edits and commands the agent reports |
| Scope escalator | a high-risk trait (listed under Routes) that makes a task architectural |

```text
you ask → Intake → Story ✋ → Plan ✋ → ┌ Build → Review ┐ → Verify ✋ → QC ✋ → Knowledge ✋ → Commit ✋
                                      └ repeats per sub-unit ┘

✋  always you, in both modes: approve, choose, accept
step  ⏸ also pauses after every sub-unit's build and review
auto  runs the loop straight through, keeping the ✋ stops; it also stops at a brake ⚠: a scope escalator appears,
      something unrequested turns up, the plan must change, the same test fails twice,
      or an action cannot be undone
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
work/<task>/
  <task>-story.md                Draft → Approved                 approve story
  <task>-implementation-plan.md  Draft → Approved → In progress → Completed   approve plan; item set; item finish
  <task>-build-spec.md           exact tests, code, commands      approved with plan
  reviews/                       review, verification, QC reports review add
  sources/                       originals you gave the agent; never edited
  repro/                         the agent's scripts and logs
.burhan/local/PROGRESS.md        one current-state block per task
```

Each sub-unit moves **Draft → Approved → In progress → Implemented → Reviewed**. `item set` permits one rung at a time. A review section is required before `Reviewed`.

The plan is two files: the decisions (with acceptance-criterion coverage and rulings) and a build spec. The spec gives each sub-unit its files, complete test and code, RED and GREEN commands, expected output, and interfaces.

Build exactly that spec. If RED does not fail as expected, GREEN fails, or a file differs, stop. `deviation add` records the difference. Until you resolve it, `guide` says code is not authorized; an approved deviation updates the plan and spec first, then the code.

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
| A deviation or discovery | work pauses; a separate finding is not silently fixed |
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

QC proposes `PASS` or `FAIL — N issues`, with Critical, Important, or Minor findings. PASS is evidence, not a guarantee. A FAIL returns the task to build; the next QC confirms the fix or widens the review.

## Proof

Hooks report and fail open; they never block. Task commands refuse a wrong lifecycle step, but an agent can skip them.

| Moment | Hook | Purpose |
| --- | --- | --- |
| Session start | `session-gates` | gates, task state, first-use setup, tasks in flight |
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

The ledger is outside the project at `~/.local/state/burhan/evidence/`. It records reported edits, command lines, exit codes, order, and task association; not command output. `evidence --item <slug>` prints it.

A passing whole-suite run after the last code edit can serve verification, QC, and commit. Reuse it until code or tests change. `guide` reports `full run:` status.

## Reference

### Settings

`WF_CHECK_CMD` is the fast pre-commit check. `WF_CODE_REGEX` and `WF_TEST_REGEX` identify code and tests. `WF_EVIDENCE_REGEX` says which commands count as proof. `WF_FULL_TEST_REGEX` identifies the whole suite. `WF_SENSITIVE_REGEX` and `WF_SENSITIVE_NOTE` add a sensitive-path reminder. With empty code or proof patterns, the “done” warning cannot work. A project created by `burhan init` has task-file checks on (`WF_ITEM_CONTRACT=on`).

### Commands

`item new` creates route-shaped files. `approve` records a human decision. `item set` advances one allowed status. `review add` requires reviewer provenance. `deviation add` freezes code authorization until resolution. `item finish` requires reviewed units, gates, no open deviation, and fresh proof. `item check` reports task-file faults. `state compact` shortens the lines of closed tasks in your state file (a dry run until `--apply`).

Read-only reports include `status` (`--write` also writes the task index), `stats`, `evidence`, `changed`, `pr-body`, `memory`, `inspect`, and `doctor`. `use <slug>` links a session to one task. The agent runs these as `npx burhan-kit <command>`; you can too. Run `doctor` from the project root: from a subfolder it says burhan is not installed.

### Project memory

Onboarding scans the project and drafts `.burhan/PROJECT.md` plus fact files in `.burhan/context/`. You approve, correct, or waive the baseline. Facts cite a path and a short hash, not file content. `memory status` marks facts fresh, changed, missing, or unchecked; `memory check` can run in CI. Knowledge review proposes durable lessons for your decision.

### Claude Code and Codex

Claude Code uses `/burhan:e2e`, `/burhan:qc`, and `/burhan:onboard`; Codex follows installed command files through `AGENTS.md`. Codex hook results need trust. A command with no recorded result is not passing.

Superpowers is optional. When enabled, burhan maps phases to brainstorming, planning, test-first, debugging, review, and verification skills. Claude Code can generate planner, builder, explorer, and reviewer roles on configured models. Codex uses your own model configuration; burhan never writes it.

Several sessions can work on separate tasks. Keep one task per session. Shared configuration, memory, and shared task folders go through review; `.burhan/local/` stays personal.

### Safety and rollback

`init`, `upgrade`, and `uninstall` are dry runs until `--apply`. Setup validates before its first write. Upgrade refreshes kit files and merges exact hook entries without overwriting `workflow.config` or `bindings.md`. Writes through a link outside the project are refused unless you explicitly allow them.

Uninstall removes the kit folders under `.burhan/` whole: `WORKFLOW.md`, `SETUP.md`, `VERSION`, `phases`, `templates`, `commands`, and `hooks`. It keeps `workflow.config`, `bindings.md`, `.burhan/local/`, and task files unless you add `--all`. `--all` removes the private `work/` and `discovery/` folders; a shared task folder you pointed `WF_DOCS_DIR` at is never removed.

### Limits

- Hooks never block; task commands refuse a wrong step; an agent can skip both.
- Hooks see only activity the agent reports. Shell edits are visible only through `>`, `>>`, and `tee`.
- Codex hooks need trust. Missing recorded command results do not pass.
- Windows CI runs the Node suite on `windows-latest`, Node 24, without bash or `jq`. It is not PowerShell-only coverage or a real agent session.
- The ledger grows until you delete it. It does not prove activity outside reported tool calls.

### FAQ

**Does every task use every stage?** No. The route chooses the proportional path; a patch skips story and plan.

**Does burhan require a language or framework?** No. You configure the checks and patterns for your project.

**Does burhan send project data over the network?** Its source contains no network client calls. Package installation can use the network.

### Docs

[Features and routes](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/features.md) · [Configuration](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md) · [Recorded first task](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/first-task.md) · [Upgrading](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/upgrading.md) · [CI and Windows](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/ci-and-windows.md) · [Changelog](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/CHANGELOG.md) · [Roadmap](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/ROADMAP.md) · [Issues](https://github.com/ahmedkamaldabour/burhan-kit/issues)

## License

MIT. See [LICENSE](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/LICENSE).
