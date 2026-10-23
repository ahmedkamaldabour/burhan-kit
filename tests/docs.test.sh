#!/usr/bin/env bash
# docs/configuration.md and the kit docs keep saying what the code does. The README contract lives in tests/readme.test.sh.
. "$(dirname "$0")/lib.sh"
cd "$T_ROOT" || exit 1

check "configuration documents the conditional Codex route" "$(cat docs/configuration.md)" has 'if it is not installed yet: in Codex CLI run `/plugins`, search `superpowers`, choose Install Plugin'
check "configuration: never reads the Codex config" "$(cat docs/configuration.md)" has 'never reads `~/.codex`'

echo "project memory docs (project-scan-and-memory SU7)"
cfgdoc="$(cat docs/configuration.md)"
for phrase in '## Project memory' '`burhan inspect' '`burhan memory check' '`burhan memory status' '`burhan memory affected' \
  'npx burhan-kit memory check' 'Baseline: Approved — <name> · YYYY-MM-DD' '/burhan:onboard' '.burhan/commands/onboard.md' \
  'guidance, never a block' 'the hash covers the whole file' 'changed does not mean false' 'CRLF line endings count as LF' \
  'checks the shape of the Baseline line, not who wrote it' 'operational questions also see the reminder' \
  'more than 1,000 entries' 'never use `merge=union`' \
  'at most 5,000 entries and 1 second per turn' 'depth 12, 20,000 entries, 1,000 per folder, 10 s' \
  '`Memory status: Approved <date>` counts as Approved' 'renames list the old path too; untracked files are not included' \
  'Exempt: greenfield projects, the patch lane, read-only items' 'A fact without a hash is `unchecked`' \
  'resolve it by keeping each row' 'with the name the person gives' 'files over 64 MiB are `unchecked`' \
  'the project-memory warnings'; do
  check "configuration.md states: $phrase" "$cfgdoc" has "$phrase"
done

echo "first-use-fixes SU4: setup keys, doctor line, piped limit, ledger cleanup wording"
check "configuration: setup --set lists the three pattern keys" "$cfgdoc" has '[code=<re>] [test=<re>] [evidence=<re>]'
check "configuration: an empty value does not clear a pattern" "$cfgdoc" has 'an empty value does not clear'
check "configuration: doctor says when the code pattern is empty" "$cfgdoc" has 'WF_CODE_REGEX is empty'
check "configuration: a piped run records the last command's exit" "$cfgdoc" has "records the exit of its last command"
check "configuration: the Kit command row" "$cfgdoc" has 'Kit command'
check "enforcement: the ledger cleanup rule is the real one" "$(cat kit/phases/enforcement.md)" has 'holds only ledger files'
check "enforcement: no blanket 30-day claim" "$(cat kit/phases/enforcement.md)" lacks 'pruned after 30 days'
check "enforcement: a piped run records the last command's exit" "$(cat kit/phases/enforcement.md)" has "exit of its last command"

echo "docs-catch-up-baseline: the docs list what the hooks flag and install"
enfdoc="$(cat kit/phases/enforcement.md)"
check "enforcement: turn-audit lists the BASELINE GATE" "$enfdoc" has 'BASELINE GATE'
check "configuration: turn-audit lists the BASELINE GATE" "$cfgdoc" has 'BASELINE GATE'
check "enforcement: the baseline reminder is outside the router's two lines" "$enfdoc" has 'separate baseline reminder'
check "configuration: the baseline reminder is outside the router's two lines" "$cfgdoc" has 'separate baseline reminder'
check "configuration: the file tree lists the onboard command" "$cfgdoc" has '{e2e,qc,onboard}.md'
check "configuration: the Claude commands bullet lists onboard" "$cfgdoc" has '`/burhan:qc`, `/burhan:onboard`'
check "configuration: a Claude Stop audits only what is new" "$cfgdoc" has 'only what is new since the previous Stop'

echo "ci-matrix-slim: the docs describe the three-job CI and what it no longer runs"
cidoc="$(cat docs/ci-and-windows.md)"
check "ci doc: one job per system on Node 24" "$cidoc" has 'one job per system, on Node 24'
check "ci doc: Node 22 is not run by CI" "$cidoc" has 'does not run Node 22'
check "ci doc: Windows with Git Bash is not run by CI" "$cidoc" has 'does not run Windows with Git Bash'
check "ci doc: no stale Windows Node 22 claim" "$cidoc" lacks 'with Node 22 and 24'
check "configuration: CI runs Node 24" "$cfgdoc" has 'CI runs Node 24'
check "configuration: no stale CI Node 22 and 24 claim" "$cfgdoc" lacks 'CI runs Node 22 and 24'

echo "v04-release: the upgrade from 0.3.0 is documented"
check "upgrading: a section for 0.3.0 installs" "$(cat docs/upgrading.md)" has '## Upgrading from 0.3.0'
check "upgrading: upgrade creates the empty state file when it is missing" "$(cat docs/upgrading.md)" has 'creates the empty state file'
check "upgrading: the hook entries are unchanged since 0.3.0" "$(cat docs/upgrading.md)" has 'byte-identical'
check "changelog: a 0.4.1 section" "$(cat CHANGELOG.md)" has '## 0.4.1 — 2026-10-23'
check "changelog: 0.4.1 says how to upgrade from 0.4.0" "$(cat CHANGELOG.md)" has '### Upgrading from 0.4.0'
check "changelog: 0.4.1 names the state file it creates" "$(cat CHANGELOG.md)" has 'creates the empty state file'
check "changelog: 0.4.1 says the first-use start was measured once" "$(cat CHANGELOG.md)" has 'measured once'
check "upgrading: a section for 0.4.0 installs" "$(cat docs/upgrading.md)" has '## Upgrading from 0.4.0'
check "roadmap: Done lists the 0.4.1 fixes" "$(cat ROADMAP.md)" has '(0.4.1)'
check "changelog: 0.4.0 says how to upgrade from 0.3.0" "$(cat CHANGELOG.md)" has '### Upgrading from 0.3.0'

echo "docs-windows-paths: a Windows path with backslashes goes in single quotes"
check "configuration: a Windows path goes in single quotes" "$cfgdoc" has 'a path with backslashes goes in single quotes'
check "configuration: the single-quoted example" "$cfgdoc" has "WF_EVIDENCE_DIR='C:\\Users\\me\\ev'"
check "configuration: a double-quoted one is refused and ignored" "$cfgdoc" has 'in double quotes the line is refused and ignored'
check "ci and windows: a Windows path goes in single quotes" "$(cat docs/ci-and-windows.md)" has 'with backslashes in single quotes'

t_summary
