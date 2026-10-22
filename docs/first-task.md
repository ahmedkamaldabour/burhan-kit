# burhan — your first task, recorded

[README](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/README.md) · [Features in detail](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/features.md)

This is one small real task, from the request to the commit, copied from a recorded run. Nothing below is written by hand except the headings and the notes marked **Note**.

## How it was recorded

- A throw-away Node project (a `package.json` whose only script is `npm test` = `node --test`), set up with the recommended answers: Claude Code, pause after each part (`step`), task files in git under `docs/burhan/work/`. The same answers the setup wizard proposes; the run used `npx burhan-kit setup --answers answers.json --apply`.
- Claude Code 2.1.296, model claude-sonnet-5-5, run headless (`claude -p`), one `--resume` turn per message. The messages in "you" were typed by the maintainer's script, as a user would.
- Superpowers was **off** for the run (`WF_SKILLS='none'`): this is what you get if you skip step 1 of the install.
- Hook messages were read from the saved session transcript; ledger and index output come from `npx burhan-kit …` in that project. Long session ids are shortened to `…`.
- **Not recorded:** Codex (its trust step is interactive), Windows, macOS.

## 1. You ask. First use comes first

```text
you    /burhan:e2e slugify — add a function slugify(text) in src/slugify.js that lowercases the text and joins its words with hyphens, with a test
```

The project was just set up, so burhan's session-start hook told the agent to run first-use setup. The agent read `package.json` and showed this block (and nothing more) before doing anything else:

```text
burhan needs one thing before it can check your work:

Recommended for this project (Node.js, ES modules):
  Check before commit   `npm test` (runs `node --test`, the only script in `package.json`; no linter or type-checker found)
  Code files            JavaScript files (`.js`, `.mjs`)
  Test files            JavaScript files with `.test.` in the name, like `slugify.test.js`
  Proof                 `npm test`
  Sensitive             nothing

● Use these   ○ Change something

Once you pick, I'll save the setup and go on with `slugify`: route it, write the story and plan together, and stop for your approval before writing any code.
```

## 2. You approve the setup. The agent writes the story and the plan

```text
you    Use these.
```

The agent saved the values with `npx burhan-kit setup --set check='npm test' code='…' test='…' evidence='…'` (the patterns are regular expressions; you saw only the plain words above), ran the check once, then routed the request and wrote the story and the plan. Its reply:

```text
**Route:** feature / bounded. It's one pure function with no scope escalator, so it gets one combined story and plan gate. Mode is `step`, the default.

**Setup:** the check is `npm test`. I saved it, and it ran clean with 0 tests, exit 0.

**Status:** nothing exists yet for this item, and no code is written. I wrote these files:
- `docs/burhan/work/slugify/slugify-story.md`
- `docs/burhan/work/slugify/slugify-implementation-plan.md`
- `.burhan/local/PROGRESS.md`

**Decision card**
- **What changes:** a new `slugify(text)` in `src/slugify.js` that lowercases the text and joins its words with `-`. A new `src/slugify.test.js` uses `node:test`.
- **Acceptance criteria:**
  - `slugify("Hello World")` returns `"hello-world"`.
  - Leading, trailing and repeated whitespace is collapsed.
  - Empty or blank text returns `""`.
  - The test runs under `npm test`.
- **Plan:** one sub-unit, built test-first on a `feature/slugify` branch, which I'll create before the first edit.
- **Risk:** low. It's a pure function with no callers.
- **Q-1 (not blocking):** should "words" be split on whitespace only? By default, `"Hello, World!"` becomes `"hello,-world!"`, with punctuation left alone. That's the literal reading of your request. If you'd rather strip or split on punctuation, say so now. Otherwise the default applies.

**Waiting on you:** reply "approved" to approve both the story and the plan, optionally with an answer to Q-1. I won't write code before then. I'll also ask who does the final verification, you or me, once the build is reviewed.
```

**Note:** the story and the plan are two files under `docs/burhan/work/slugify/`. The agent stopped here; no code was written before your "approved".

## 3. You approve. The agent builds, reviews and verifies

```text
you    approved. Q-1: whitespace-only splitting is enough. You do the final verification.
```

The agent wrote the test first, ran it and saw it fail (`ERR_MODULE_NOT_FOUND`: the function did not exist yet), wrote the function, ran `npm test`, asked the `burhan-reviewer` subagent for a review in a fresh context, and verified. Its final message:

```text
`npm test` passes: tests 6, pass 6, fail 0, exit 0. This is the latest run, and no code has changed since the earlier passing runs.

I made the same mistake once more later with a trailing `echo =====`. The `npm test` runs before and after it were clean, as was the run just now, so the completion claim stands.

Nothing is committed. QC, via `burhan:qc slugify`, and the a/b/c commit checkpoint are still open.
```

**Note — a warning in the middle of this turn.** The agent had run `node --test src/slugify.test.js 2>&1 | tail -25; echo ======; npm test 2>&1 | tail -15`. The tests passed (6 of 6), but the shell the agent uses reads `======` as a command, so the whole line exited 1. When the agent said it was done, the end-of-turn check reported what it saw:

```text
⚠ VERIFICATION GATE: completion was claimed, but the last run of `node --test src/slugify.test.js 2>&1 | tail -25; echo ======; npm test 2>&1 | tail -15` failed (exit 1). Fix it and re-run, then show the passing output — or retract the claim.
```

The agent re-ran `npm test` (passed) and said so. The warning was right about the exit code and wrong about the code; this is why the message asks you to look at the output.

## 4. You choose how to commit

```text
you    Commit checkpoint: (a) commit now, on a new feature branch. I will run QC separately later.
```

Before the `git commit` the pre-commit hook ran the check and told the agent:

```text
Pre-commit gate — measured: PASS — `npm test` run by this hook just now.
CONTROL CHECKPOINT: have you shown the human `git status`/diff of exactly these files IN THIS CONVERSATION and received an explicit choice — (a) commit now, (b) keep going, commit later, (c) they commit manually? If not, cancel this command, show the files and ask. Also state the test output this commit rests on and that the diff was reviewed.
```

The agent's reply:

```text
I committed the work as `2d7c56b` on `feature/slugify`, which I'd already branched from `main`. It contains:
- `src/slugify.js` and `src/slugify.test.js`
- the work-item docs under `docs/burhan/work/slugify/`
- the first-use setup (`.burhan/workflow.config` and `.claude/skills/burhan-verify/SKILL.md`)

I haven't pushed the branch or opened a pull request. The commit message says QC hasn't been run.

Still open:
- **QC:** you said you'd run `burhan:qc slugify` separately. It also does the knowledge review and the close-out, so the item isn't closed yet.
- **Test-first record:** the red-first test run isn't in the evidence ledger, so the QC reviewer should look at that.
```

## 5. What was recorded, and where

In the project: the story, the plan, the review, the verification (committed under `docs/burhan/work/slugify/`), the state file `.burhan/local/PROGRESS.md` (yours, git-ignored), and the settings the agent saved in `.burhan/workflow.config`. `npx burhan-kit status` lists the item:

```text
| Item | Route | Parent | Depends on | State | Last activity |
|------|-------|--------|------------|-------|---------------|
| [slugify](slugify/) | feature / bounded | — | — | Awaiting QC | 2026-10-22 |
```

Outside the project, in `~/.local/state/burhan/evidence/` (here a temporary folder), the ledger. `npx burhan-kit evidence --item slugify` prints one line per edit and command; a few of them, shortened:

```text
2026-10-22T09:26:57Z  claude  …/… #1  cmd  exit 0  ok  npx burhan-kit setup --set check='npm test' code='\.(js|mjs)$' test='\.test\.(js|mjs)$' evidence='^npm test|node --test' …  [slugify]
2026-10-22T09:28:56Z  claude  …/… #13  edit  src/slugify.test.js  [slugify]
2026-10-22T09:28:56Z  claude  …/… #15  cmd  exit 0  ok  npm test 2>&1 | head -30  (pipeline: exit is the last command's)  [slugify]
2026-10-22T09:28:56Z  claude  …/… #16  edit  src/slugify.js  [slugify]
2026-10-22T09:28:56Z  claude  …/… #17  cmd  exit 1  failed  node --test src/slugify.test.js 2>&1 | tail -25; echo ======; npm test 2>&1 | tail -15  (pipeline: exit is the last command's)  [slugify]
2026-10-22T09:28:56Z  claude  …/… #18  cmd  exit 0  ok  npm test 2>&1 | tail -15  (pipeline: exit is the last command's)  [slugify]
```

Read it from the top: the settings saved in step 2; the test file edited; a first `npm test` run; the code edited; the passing runs. **Note:** the first `npm test` run is the red one — its output was `ERR_MODULE_NOT_FOUND`, because `src/slugify.js` did not exist yet — but the ledger records `exit 0  ok`, because the command was `npm test 2>&1 | head -30` and a pipeline's exit is the last command's. `evidence` marks such lines with `(pipeline: exit is the last command's)`. So the order of edits and runs is in the ledger; whether a piped run failed is not.

## 6. The warning that needs no luck: a "done" with no check

A separate session in the same project, with the agent allowed to edit but not to run commands:

```text
you    Small patch in src/slugify.js: also strip leading and trailing hyphens from the result. Make the edit, then your final reply must be exactly the single word: Done.
```

The end-of-turn check:

```text
⚠ VERIFICATION GATE: completion was claimed, but the last run of `npm test 2>&1 | tail -15` was blocked and never ran. Run it, show the output — or retract the claim.
```

The agent's reply:

```text
I retract "Done." The edit is made, but I haven't verified it. Both attempts to run `npm test` were blocked, so it never ran.

The change in `src/slugify.js` is `.join('-').replace(/^-+|-+$/g, '')`. I didn't write a test first, so test-first was skipped. I also haven't updated `.burhan/local/PROGRESS.md`.

To verify, I need approval to run `npm test`, or you can run it yourself. Nothing has been committed.
```

**Note:** the warning needs `WF_CODE_REGEX` and `WF_EVIDENCE_REGEX`, which the agent saved in step 2. Without them it stays silent; `npx burhan-kit doctor` says so.

## What this run does not show

QC (`/burhan:qc slugify`) and the knowledge review were not run; the item stayed at `Awaiting QC`. Codex, Windows and macOS were not recorded. One task of one function, one model, one machine: it shows the flow, not how burhan behaves on your project.
