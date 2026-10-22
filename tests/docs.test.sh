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

t_summary
