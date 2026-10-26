# Project memory
> Part of the burhan working agreement (core: `.burhan/WORKFLOW.md`). **Read this when:** you onboard a repository, read or write project facts, or run the knowledge review.

**Work records preserve history. Project memory preserves current understanding.**

- `.burhan/PROJECT.md` (`templates/project.md`) — purpose, areas, and where to look first.
- `.burhan/context/<area>.md` (`templates/context-area.md`) — one per area: architecture, stack, data,
  integrations, environments, conventions, business rules, decisions.
- **Every fact** carries: **confidence** (`confirmed` — direct evidence · `inferred` — strong
  interpretation · `unresolved` — could not be established), **evidence** (a repository path,
  optionally with a line range or symbol, a verification run, or a human confirmation), and when it
  was **verified** (date + commit).
- **Fact IDs** are `<AREA>-<short-slug>` (e.g. `DATA-email-unique`), never sequential numbers, so
  two developers adding facts at once cannot collide. An ID is never reused.
- **State:** `current` · `superseded` (by which fact) · `disputed` (conflicting evidence nobody has
  settled). A fact that stops being true is **superseded, never rewritten** — history stays.
- **Transient runtime state is never a fact** (running processes, open ports, the current branch,
  machine-specific paths). Record the configuration that declares it instead.
- **Before work:** read `.burhan/PROJECT.md` and only the areas the item touches. If a fact's evidence file
  has changed since it was verified, treat the fact as *may be stale* and re-check it before relying
  on it. Prior chat or model memory is never evidence.

**Onboarding an existing repository** = an `investigation` item ("understand this project"): bounded
discovery of structure, stack, architecture, data, integrations, conventions, material documents
and business rules → a draft `.burhan/PROJECT.md` + `.burhan/context/` with every fact evidenced, plus the
limitations of the discovery → **the human reviews and approves** → it becomes project memory.
Never approve it yourself; an unapproved draft is not memory.

- **Baseline** (`.burhan/PROJECT.md`, exact forms: `phases/files.md` · Fields): `Draft` until the person decides. Approved
  or Waived is written only when the person says so: the agent asks the person for their name and writes it exactly as
  given, never guessed, and never writes either word on its own. A `Draft` is completed; an `Approved` baseline is not
  redone (refresh only what changed). This is a checkable form, not proof that a person wrote it.
- **The person's request stays apart:** a request is a task to do, not knowledge about the project. Keep it in
  `.burhan/local/` while onboarding, and continue it after the decision.
- **Secrets:** evidence is a path and a hash, never content; a fact may say which setting holds a secret, never the
  secret itself.
- **Coverage:** PROJECT.md lists what the agent inspected, sampled and did not inspect — in the agent's own words,
  since burhan cannot check what was read. Every topic gets an answer, even when the answer is "not applicable".
- **Freshness:** the evidence hash covers the whole file, so an edit anywhere marks the fact `changed`; `changed` does
  not mean false — re-check it, then reconfirm or supersede. A release file (`package.json`, `CHANGELOG.md`,
  `ROADMAP.md`) changes at every version bump, so cite one as evidence only when nothing else proves the fact;
  `memory status` marks a fact changed through release files alone with `(release file only)`.
- **Team:** one file per area, one fact per row. Two people adding facts to the same area can get a text conflict:
  keep both rows (different slugs never collide; the same slug added twice is caught by `burhan memory check`) and
  never use `merge=union`, which hides duplicates.

**Knowledge review (K).** Near close-out, propose only stable, future-facing knowledge (with
evidence) and say whether each one is new, reconfirms, supersedes or disputes an existing fact. The
human promotes or rejects each; or the plan records "Knowledge review: none". Never promote
execution noise.
