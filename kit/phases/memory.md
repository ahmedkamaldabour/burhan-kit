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

**Knowledge review (K).** Near close-out, propose only stable, future-facing knowledge (with
evidence) and say whether each one is new, reconfirms, supersedes or disputes an existing fact. The
human promotes or rejects each; or the plan records "Knowledge review: none". Never promote
execution noise.
