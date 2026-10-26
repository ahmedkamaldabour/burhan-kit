# Burhan

Coding agents say “done” without proof. burhan installs a working agreement and hooks in your project, asking your agent to agree the work with you first, build reviewed steps, and show what it ran. For Claude Code and Codex: `npx burhan-kit`.

- **Agree first:** story and plan need your yes before code.
- **Show proof:** edits and commands are recorded; “done” without a passing check gets a warning.
- **You commit:** before each commit you choose: now, later, or yourself.

[العربية](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/README.ar.md)

## The flow at a glance

```text
 1. Intake     the agent restates your request and picks a route: type + scope + a one-line reason
 2. Story      what and why, with acceptance criteria         <- you approve
 3. Plan       how, in small steps called sub-units           <- you approve
 4. Build      one sub-unit at a time, test first             <- `step` mode pauses here
 5. Review     a fresh reviewer checks that sub-unit          (repeat 4 and 5 per sub-unit)
 6. Verify     a real end-to-end check                        <- asks: you or the agent?
 7. QC         the final independent check, on the routes that need it   <- you accept the verdict
 8. Knowledge  lessons worth keeping                          <- you promote or reject them
 9. Commit     you choose: now, later, or yourself            <- always stops
```

Every request is classified first: type + scope + a one-line reason. That is its **route**: the agent states it at the start and you can override it, and it decides which steps follow, so a feature and a bug do not take the same path. Type is `feature`, `bug`, `change` (to existing behaviour), `refactor`, `release` or `investigation`. Scope is `bounded` (local and well understood), `architectural` (cross-cutting, or touching security, data, money or an interface others rely on) or `patch` (one obvious change). On bounded work the story and the plan are one approval.

| You ask for | Classified as | Path |
| --- | --- | --- |
| a new feature | feature / bounded | story + plan (one approval) → build → review → verify → QC → knowledge |
| a bug | bug / bounded | story + plan (one approval; the story holds the root cause, found with evidence before any fix) → build (starting from a failing regression test) → review → verify → knowledge; no QC |
| a typo | change / patch | the change, a passing check run after it, the commit; no story or plan |
| a feature, bug or change touching, for example, security, permissions, the data model, money or a public API | architectural | story and plan as two approvals → build → review → verify → QC → knowledge |
| a question to investigate | investigation | read-only: findings, no code |

A **story** is what and why, with acceptance criteria; a **plan** is how, in small steps. A **gate** is a point where the agent stops for you (every `<-` above, and after every sub-unit in `step` mode); **QC** is the final check by a fresh, independent reviewer. Refactors and releases have their own shorter paths ([the full table](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/features.md#agree-before-you-build)).

The route sets how many approvals a task has; the mode only decides whether the build pauses between sub-units. For a task with three sub-units:

| A task with three sub-units | `step` (default) | `auto` |
| --- | --- | --- |
| story + plan | you approve | you approve, once |
| build + review of each sub-unit | stops after each of the three | runs straight through |
| verify | asks whether you or the agent runs it | asked once, at the start |
| QC verdict (on routes with QC) | you accept it | you accept it |
| commit | you choose | you choose |

In `auto` the agent asks you again at a **brake**: a scope escalator (the task turns out to touch security, data, money or an interface others rely on), a discovery (something found that the task did not ask for), a plan change, the same test failing twice, or an irreversible action. The commit always stops, in both modes. Switch modes any time in plain words (“go end to end”, “wait for my approval”); “plan only” stops once the plan is approved and writes no code.

## See it work

An excerpt of a real run (Claude Code, a one-function task, shortened with `…`; the full walkthrough is in [docs/first-task.md](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/first-task.md)):

```text
you    /burhan:e2e slugify — add a function slugify(text) in src/slugify.js … with a test
agent  burhan needs one thing before it can check your work: …
         Check before commit   `npm test` (runs `node --test` …) …
       ● Use these   ○ Change something
you    Use these.
agent  **Route:** feature / bounded. It's one pure function with no scope escalator, so it gets one combined story and plan gate. …
       **Waiting on you:** reply "approved" to approve both the story and the plan … I won't write code before then.
```

The `Check before commit` block above came from a run that started with `/burhan:e2e`; after the install steps below, the session-start reminder asks the agent for it in your first session (Step 3), as long as the checks are not set up yet.

A **hook** is a small script the agent runs at set moments (session start, your prompt, before a commit, after an edit, end of turn). In another run an agent edited a file, could not run the check, and said “Done.” The end-of-turn hook answered, and the agent took the claim back. The **ledger** is the private record of every edit and command; `npx burhan-kit evidence` prints it, here with that run's `npm test` — refused by the agent's own permission prompt, not by burhan — marked `blocked`:

```text
⚠ VERIFICATION GATE: completion was claimed, but the last run of `npm test 2>&1 | tail -15` was blocked and never ran. Run it, show the output — or retract the claim.
2026-10-22T09:29:59Z  claude  …/… #2  cmd  exit ?  blocked  npm test 2>&1 | tail -15  (pipeline: exit is the last command's)  [slugify]
```

## What you get

**[Agree before you build](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/features.md#agree-before-you-build)**
- The agent routes every request first, so a typo is not a ceremony and a permissions change is never “small”.
- The agent asks for your approval of the story and the plan before code; `step` or `auto` mode decides where else it pauses.
- Before each commit it runs your check and asks you to choose: now, later, or yourself.

**[Prove what was done](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/features.md#prove-what-was-done)**
- A “done” with no passing check after the last code edit gets a warning (the check ran before it, failed, or never ran), once your project says what counts as code and as a check.
- The ledger lists each edit and command, with its exit code on Claude Code, outside your project.
- A fresh reviewer (a subagent in Claude Code, or the other agent if you choose that: Claude builds and Codex reviews, or the reverse) checks each step and the finished work, and every review records who did it.
- Reports come from the records: a pull-request description for a task, how many QC reviews were independent, escaped defects.

**[Memory and team](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/features.md#memory-and-team)**
- The agent learns your project once and shows you what it understood; each fact names the file it came from, and `memory status` tells you which facts cite a file that has changed since. Understanding and settings travel through git, and so do task files when you chose the shared folder; your own state stays local.

**[Where it runs](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/features.md#where-it-runs)**
- Claude Code and Codex, with your existing hooks kept; `doctor` checks the setup, Codex trust included.
- Safe to try: `init`, `upgrade` and `uninstall` are dry runs until `--apply`; `init` and `upgrade` never overwrite your `workflow.config`; `uninstall` removes only what burhan wrote and keeps your `workflow.config` and `bindings.md` unless you add `--all`.

## Install in 3 steps

**Which part do I use?**

| You want to… | Use |
|---|---|
| type the commands yourself in a terminal | Part 1 |
| copy a prompt and let your agent run the setup | Part 2 |

**Part 1 — Manual install (you run the commands)**

### Step 1 — Superpowers (recommended)

Superpowers is optional, but strongly recommended: burhan never installs it. With it, burhan uses its skills at each phase (brainstorming before a story, test-driven development while building, verification before “done”). Want to try burhan first? Start at Step 2.

Claude Code — type this inside Claude Code:

```text
/plugin install superpowers@claude-plugins-official
```

Codex — if it is not installed yet: run `/plugins`, search `superpowers`, choose Install Plugin.

You should see: in Step 2's summary, “Superpowers found” (Claude Code only; setup does not look in Codex).

### Step 2 — Set up burhan

In your project, with Node 22 or newer, run this in a terminal. It asks four questions (five when you use both agents): which agents, when the agent comes back to you, where the task files live, where side findings (discoveries) go, and, with both agents, who reviews. It shows a summary and writes nothing until you confirm. Setup adds hooks to your agent's settings and keeps the ones you have.

```bash
npx burhan-kit
```

Then check the setup:

```bash
npx burhan-kit doctor
```

Codex only — trust burhan's hooks in `/hooks` or they will not run ([the steps](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md#codex-trust-the-hooks)); `doctor` warns when they are not trusted.

You should see: the list of files created, and `npx burhan-kit doctor` printing a last line that starts with `0 fail`.

### Step 3 — Let the agent understand your project

Once, open a NEW agent session (a **session** is one conversation with the agent) in the project and type any message, for example `start`.

burhan's reminders tell the agent to set up your project's check command first, if it is not set yet (you approve it once). Then the agent reads the whole project, shows a draft and what it could not examine, and keeps it only after you approve: your **baseline**.

If the agent only greets you, or to go straight to the understanding step, type this instead. Claude Code:

```text
/burhan:onboard
```

Codex:

```text
Follow .burhan/commands/onboard.md
```

Run it once: an approved understanding is not repeated, and a draft is completed.

You should see: a draft of what the project is and does, and the questions the agent could not answer. Nothing is saved until you decide.

**Part 2 — Install through your agent (you copy, the agent runs)**

Copy this into your agent, in your project.

```text
Run `npx burhan-kit setup --agent` and follow what it prints. Ask me the questions it gives you, one question per message, then show me the summary. Apply nothing until you have my approval.
```

When setup has finished: with Codex, first trust burhan's hooks in `/hooks` (as in Step 2). Then copy this into a NEW agent session in the project, or just type any message there:

```text
Set up this project's check command if it is not set yet, then follow `.burhan/commands/onboard.md`: show me the draft and what you could not examine, and save nothing until I approve.
```

## Your first task

Start a small change with `/burhan:e2e <slug>` (a short title works too). If your project's checks are not set up yet, the agent sets them up first (one block you approve). Then it writes a story and a plan and stops for your “approved”. You answer its few questions, it builds test-first, a fresh reviewer checks the work, and it asks before it commits. With several tasks open, `npx burhan-kit use <slug>` links the session to one. The whole recorded run, every message and warning, is in [docs/first-task.md](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/first-task.md).

## Teams and project memory

- Committed and reviewed like code: `.burhan/PROJECT.md`, `.burhan/context/`, `.burhan/bindings.md` (your project's commands and folders), `.burhan/workflow.config` and each task's folder. Yours alone and git-ignored: `.burhan/local/`.
- Two people adding facts to one area can get a text conflict: keep each row; `npx burhan-kit memory check` catches duplicate IDs. Never use `merge=union` on these files.
- The evidence ledger lives outside your project (`~/.local/state/burhan/evidence/`): command lines and exit codes only, never their output. It is yours to delete.

## Limits

- burhan reports and guides — it does not block. Approvals and test-first are rules the agent is told to follow.
- It only sees the edits and commands the agent reports; a shell edit shows up only through `>`, `>>` and `tee`.
- The “done” warning needs `WF_CODE_REGEX` and `WF_EVIDENCE_REGEX` (settings in `.burhan/workflow.config`); the agent proposes them on first use, and once first use is done `doctor` warns when the code pattern is empty.
- Codex runs project hooks only after you trust them in `/hooks`, and says nothing when they are untrusted. On Codex a finished command whose result is missing from the session record counts as not passing; how often that happens is not measured ([the roadmap](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/ROADMAP.md)).
- Windows: the hooks run on Node and CI covers `windows-latest`. Not verified yet: Windows with PowerShell only, and a real Claude Code or Codex session on Windows.

## Commands and links

| Command | What it does |
| --- | --- |
| `npx burhan-kit` · `npx burhan-kit setup --agent` | guided setup (writes nothing until you confirm) · the questions, for your agent to ask |
| `npx burhan-kit doctor` | read-only health check |
| `npx burhan-kit status` · `npx burhan-kit evidence --item <slug>` | the task index · the ledger for a task |
| `npx burhan-kit memory check` · `npx burhan-kit inspect` | check the project memory (also for CI) · a names-only look at the project |
| `npx burhan-kit use <slug>` | validate a task; the session is linked when the turn ends |
| `npx burhan-kit upgrade` · `npx burhan-kit uninstall` | refresh · remove (a dry run until `--apply`) |

[Configuration](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md) · [Features in detail](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/features.md) · [First task, recorded](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/first-task.md) · [Upgrading and rollback](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/upgrading.md) · [CI and Windows](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/ci-and-windows.md) · [Changelog](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/CHANGELOG.md) · [Roadmap](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/ROADMAP.md) · [Issues](https://github.com/ahmedkamaldabour/burhan-kit/issues)

## License

MIT. See [LICENSE](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/LICENSE).
