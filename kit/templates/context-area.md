# <Area>
Current knowledge first; superseded facts stay below for history.
> Delete any section that does not apply — an absent section is never a violation.

## Current
| ID | Fact | Confidence (confirmed / inferred / unresolved) | Evidence | Verified (date @ commit) |
|----|------|------------|----------|-----------|
| <AREA>-<short-slug> | | | `path/to/file` sha256:<16 hex> | YYYY-MM-DD @ <commit> |

Evidence: one or more `` `path` ``, `` `path:12-40` `` or `` `path#symbol` ``, each followed by `sha256:<16 hex>` (the
first 16 hex characters of the file's SHA-256, line endings counted as LF), separated by a space; the hash is lower-case hex; or `runtime: …` / `person: <name> · YYYY-MM-DD` (not checkable).
Evidence without a hash is accepted; its freshness is `unchecked`.
Verified: `YYYY-MM-DD @ <7-char commit>`, or `YYYY-MM-DD` without Git (older files may use `YYYY-MM-DD · <commit>`). The hash covers the whole file, not the cited
lines: any edit to the file marks the fact `changed`, which does not mean false. Cite `package.json`, `CHANGELOG.md` or `ROADMAP.md` only when nothing else proves the fact: every version bump marks such a fact `changed`. A secret's value never goes into memory.
IDs: `<AREA>-<slug>` — the area in capitals, the slug in lower-case letters, digits and `-`. Replace the example row:
a row whose ID still contains `<` is a placeholder and is not read as a fact.

## Disputed
| ID | Fact | Confidence | Evidence | Conflicting evidence | Raised |
|----|------|------------|----------|----------------------|--------|

## Superseded
| ID | Fact | Confidence | Evidence | Verified | Superseded by | When |
|----|------|------------|----------|----------|---------------|------|
