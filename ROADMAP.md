# Roadmap

Plans are not promises. Each item is built test-first and lands only with its tests.

## Planned: model tiers per agent

Each role (planner, builder, reviewer, explorer) runs on a fitting model. The tiers are set once per
agent during setup, and a story overrides them only when it needs to. Nothing changes in behaviour
until you choose.

- **Config:**
  - `WF_TIER_<AGENT>_<STRONG|STANDARD|CHEAP>=<model>`, with an optional
    `WF_TIER_<AGENT>_<TIER>_EFFORT=<low|medium|high>`.
  - `WF_ROLE_<PLANNER|BUILDER|REVIEWER|EXPLORER>=<tier>`.
  - Optional: `WF_ROLE_<ROLE>_<SCOPE>=<tier>`, and `WF_ROLE_REVIEWER_SHORT=<tier>`. An empty value
    means the reviewer's tier, so a short review is never downgraded automatically.
  - The existing `WF_MODEL_<AGENT>_<ROLE>` keys keep working as explicit models.
- **Precedence** (highest first):
  1. the story
  2. `WF_ROLE_<ROLE>_<SCOPE>`
  3. `WF_ROLE_REVIEWER_SHORT` (short reviews only)
  4. `WF_MODEL_<AGENT>_<ROLE>`
  5. `WF_ROLE_<ROLE>`
  6. the session model

  A tier that is not defined goes to the next stronger tier, then to the session model. burhan never
  falls back to a weaker model without saying so.
- **Story field:** `- **Models:** <role>=<value>, <role>=<value>`, where each value is
  `strong|standard|cheap|<agent>:<model>`.
- **`burhan model <role> --item <slug> [--size short|full] [--agent claude|codex] [--json]`:** a
  deterministic answer naming the model, the effort, the tier and where the decision came from.
- **Agents:**
  - Claude Code: the default comes from the agent's frontmatter. The Agent tool's `model` parameter
    overrides it.
  - Codex: `codex exec -m <model> [-c model_reasoning_effort=<x>]`, run in the foreground.
  - burhan never writes `~/.codex/config.toml`.
- **`kit/models.json`:**
  - A catalog of aliases, the latest model IDs and retired → replacement, updated with each release.
    It uses no network and no keys.
  - Setup in a terminal shows a selection list. Without a terminal, use `burhan models --json` and
    `burhan config set KEY=value [--local]`.
- **doctor:** a warning for a pinned model when a newer one exists, an error (with the replacement)
  for a retired model, and a suggestion to upgrade when the catalog is old. It never changes a pin.
- **Records:**
  - `Performed by` keeps its form, with the actual model.
  - A new `Tier` field: `strong|standard|cheap|explicit`.
  - `stats` reports findings and escaped defects per tier and per model.

## Done

- **Hooks without bash (0.3.0).** The hooks run on Node only, with no bash or `jq`, and CI runs them on Windows
  too; the README says what is and is not verified there.

## Candidates

- **Codex exit codes.** Codex reports a finished command with no exit code, so the main agent's
  `unknown` result counts as passing evidence. The fix is to read the exit codes from Codex's session
  record.
- **Content hashes in the ledger.** The ledger cannot tell whether an edited file was later reverted.
  Recording a hash with each edit would let it.
- **Ordered shell writes.** The main agent's shell writes (`>`, `>>`, `tee`) carry no position in the
  turn. A shell write after the evidence run therefore does not reopen the "done" check.
- **Evidence across item close.** Closing an item in the same turn tags that turn's last runs with no
  item. `burhan evidence --session` still shows them.
- **CI hardening.** Pin GitHub Actions by commit SHA.
- **A plugin route.** A commands-and-skills-only plugin that points at `npx burhan-kit init`, if users
  ask for discovery through a plugin marketplace.

## Known heuristics

These are by design, and listed so nobody mistakes them for guarantees:

- **The prompt router.** Its mode and "plan only" hints come from matching phrases, so it can miss
  or misfire on some wordings. It only suggests. The mode the hooks act on is the exact `Mode` field.
- **`Accepted by`.** The field checks its form (`<name> · YYYY-MM-DD`), not who the name belongs to.
  The working agreement forbids the agent from writing it.
- **Codex trust in `burhan doctor`.** The doctor reads only the table names under `[hooks.state."…"]`
  in `~/.codex/config.toml`. The key form was observed on Linux with Codex CLI 0.150.1; macOS and
  Windows are not verified. It cannot see a hook that is `Modified since last trusted` or disabled, so
  it can say `present` for a hook Codex will not run — the `Trusted` line in Codex's `/hooks` is what
  counts. In Codex, the missing `⚑ WORKFLOW GATES` line is a hint, not proof, that the hooks are off.
- **The `burhan-verify` skill.** Claude Code calls it at the model's discretion. The pre-commit hook runs
  `WF_CHECK_CMD` on every `git commit` regardless.
- **Hook-file formatting.** Setup writes `.claude/settings.json` and `.codex/hooks.json` back as
  indented JSON, and `uninstall` does the same when it removes burhan's entries. Your settings and
  hooks are kept, but a compact file's original layout is not restored.
