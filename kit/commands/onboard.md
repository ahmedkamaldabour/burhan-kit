---
description: Understand this project once — scan it, write a draft of the project memory, show it, and keep it only after the person decides
argument-hint: [what you wanted to do, if anything]
---

You are running **project onboarding** ("understand this project"). The authoritative process is
`.burhan/WORKFLOW.md` and `.burhan/phases/memory.md`; formats are in `.burhan/templates/project.md`,
`.burhan/templates/context-area.md` and `.burhan/phases/files.md` (Fields: `Baseline`). Run burhan's
commands with the **kit command** from `.burhan/bindings.md` (e.g. `npx burhan-kit inspect`). Route: an
`investigation` (read-only for application code; it writes only `.burhan/PROJECT.md`, `.burhan/context/`
and `.burhan/local/`).

## 1. Where things stand
Read `.burhan/PROJECT.md` if it exists and run the kit's `memory check`.
- **An Approved baseline is not redone** (`Baseline: Approved — …` or `Waived — …`). Run `memory status`:
  if facts are changed or missing, go to **Refresh** below; otherwise tell the person the understanding
  is in place and continue their request.
- **A Draft baseline is completed**: start from its Coverage section — what was sampled or not
  inspected — instead of starting over.
- No PROJECT.md: a first onboarding.

## 2. Keep the person's request aside
If the person asked for something else (in `$ARGUMENTS`, or the message that brought you here), write it
word for word to `.burhan/local/onboard-request.md` (git-ignored).
Keep it apart: a request is a task to do, not knowledge about the project, so it never goes into
PROJECT.md or `context/`. It decides where to look closer, never what to skip: the scan still covers the
whole project.

## 3. Look before reading
Run the kit's `inspect`. It says brownfield or greenfield and names the files to open first; it reads
names only. **Greenfield** (little or no code yet): tell the person there is nothing to understand yet,
write no draft, and say that a story records `Baseline: n/a (greenfield)`; then continue any saved request (step 7 — there are no memory files to commit).

## 4. Scan the whole project
Read the code itself, not only its docs. Every topic of the checklist gets an answer, even when the answer
is "not applicable" or "not found" (say where you looked):

| Area (file under `.burhan/context/`) | Cover |
|---|---|
| Architecture (`architecture.md`) | entry points; modules and layers; routes or public interfaces; authentication and roles; shared components; operational and security risks |
| Stack (`stack.md`) | languages, frameworks, build, test and CI tooling — each with the file that shows it |
| Data (`data.md`) | where data lives, its schema, how it changes (migrations) |
| Integrations (`integrations.md`) | external services, queues, webhooks, other systems called or calling in |
| Environments (`environments.md`) | configuration and its variable **names**; how it is deployed |
| Conventions (`conventions.md`) | layout, naming, test patterns, review rules |
| Business rules (`business-rules.md`) | workflows and rules that code or tests make explicit |
| Decisions (`decisions.md`) | recorded decisions and their reasons |

Plus, in PROJECT.md: **Purpose**, **Where to look first**, **Discovery limitations**.

Every fact is one row in its area file, with confidence and evidence (format: `templates/context-area.md`).
**Secrets:** evidence is a path and a hash, never content; a fact may say which setting holds a secret,
never the secret itself, and never hash a file that holds secrets (cite its example or template file, or
name the setting). Compute each hash over the file with CRLF line endings counted as LF and keep the
first 16 hex characters (e.g. `sed 's/\r$//' <file> | sha256sum | cut -c1-16`).

## 5. Write the draft
Write `.burhan/PROJECT.md` from the template with `- **Baseline:** Draft` and its **Coverage** section:
**Inspected** (read in full), **Sampled** (read in part — which part), **Not inspected** (and why). Write
each area file. Then run the kit's `memory check` (it must report 0 fail) and `memory status` (every fact
you just wrote is `fresh`, except `runtime:` or `person:` evidence); fix what they report. A fact that is
`changed` right after you wrote it means the line endings were counted differently: hash it again as above.

## 6. Present it and stop
Show the person, in plain language and their language: what the project is and does, the main facts per
area, Coverage, Discovery limitations, and the questions you could not answer from the repository.
**Stop and wait for the person.** Only a clear yes approves; silence or a vague reply does not. They
choose one of:
- **Approve** → ask the person what name to write, and write `- **Baseline:** Approved — <that name> · YYYY-MM-DD`
  (today) exactly as they gave it; never guess it. The name has no `·` and no `<`; if theirs does, ask
  how to write it.
- **Correct** → change the draft, present it again, wait again.
- **Waive** (they decide the project needs no baseline) → ask the name the same way and write
  `- **Baseline:** Waived — <name> · YYYY-MM-DD`.

Never write Approved or Waived on your own: that decision is the person's (WORKFLOW §4-D). Until then
the draft is not memory. A Draft in the repository is not memory either, if it is committed before the
decision.

## 7. After the decision
The memory files are shared with the team, so they reach the repository through the commit checkpoint
(WORKFLOW §4-B, a / b / c) and, for a team, a pull request. Then read `.burhan/local/onboard-request.md`,
continue the saved request, so the person never has to say it twice (if it is meant for later, ask whether to start it now), and delete the file.

## Refresh
When the kit's `memory status` reports facts as changed or missing (also after a release or a large merge):
1. re-check only the facts it lists as changed or missing — changed does not mean false: the file moved
   on, the fact may still hold;
2. reconfirm or supersede each one: reconfirm = same fact, new hash and Verified; supersede = move it to
   Superseded and add the new fact under a new ID;
3. show the person the result before saving (a reconfirmation is a save too), and wait as in step 6; a refresh never changes the Baseline line;
4. then continue any saved request (step 7).
