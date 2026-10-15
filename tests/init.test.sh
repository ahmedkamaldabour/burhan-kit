#!/usr/bin/env bash
# burhan init / upgrade into throwaway git repos: dry run, apply, idempotency, preservation, bootstrap
# blocks, team layout. (Ported from the install.sh suite — same cases, same guarantees.)
. "$(dirname "$0")/lib.sh"
CLI="$T_ROOT/dist/cli.js"
[ -f "$CLI" ] || { echo "  FAIL - $CLI missing: run npm run build"; exit 1; }
repo() { local d; d="$(t_tmp)"; git -C "$d" init -q; printf '%s' "$d"; }
inst() { node "$CLI" init "$@" 2>&1; echo "rc=$?"; }
upg()  { node "$CLI" upgrade "$@" 2>&1; echo "rc=$?"; }
# hook entries as one line each: the command, and for the exec form its args after it
hooks_of() { jq -r '.. | objects | select(has("command")) | ([.command] + (.args // [])) | join(" ")' "$1" 2>/dev/null; }
tree() { (cd "$1" && find . -path ./.git -prune -o -type f -print | sort | while IFS= read -r f; do printf '%s  %s\n' "$(t_sha < "$f")" "$f"; done); }

echo "init — arguments"
R="$(repo)"
check "unknown agent -> non-zero" "$(inst "$R" --agents nope)" lacks "rc=0"
check "unknown agent -> clear message" "$(inst "$R" --agents nope)" has "Unknown agent"
check "missing target -> non-zero" "$(inst "$R/missing" --agents claude)" lacks "rc=0"
check "no --agents -> non-zero" "$(inst "$R")" lacks "rc=0"

echo "init — dry run changes nothing"
R="$(repo)"; before="$(tree "$R")"
out="$(inst "$R" --agents claude)"
check "dry run -> rc 0" "$out" has "rc=0"
check "dry run -> says so" "$out" has "DRY RUN"
check_eq "dry run -> tree unchanged" "$(tree "$R")" "$before"

echo "init — apply (claude)"
R="$(repo)"
mkdir -p "$R/.claude"
echo '{"permissions":{"allow":["Bash(ls)"]},"hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo mine"}]}]}}' > "$R/.claude/settings.json"
printf '# My project\n\nKeep this line.\n' > "$R/CLAUDE.md"
out="$(inst "$R" --agents claude --apply)"
check "apply -> rc 0" "$out" has "rc=0"
for f in WORKFLOW.md SETUP.md VERSION workflow.config phases/review.md phases/lifecycle.md hooks/node/main.mjs hooks/node/core/turn-audit.mjs hooks/node/adapters/claude/hook.mjs hooks/node/gates.txt templates/story.md commands/e2e.md; do
  check ".burhan/$f installed" "$( [ -f "$R/.burhan/$f" ] && echo yes)" has yes
done
check "the bash hooks are not part of the default install" "$( [ -e "$R/.burhan/hooks/core" ] || [ -e "$R/.burhan/hooks/adapters" ] && echo yes)" lacks yes
check ".codex/hooks.json NOT created for claude-only" "$( [ -e "$R/.codex" ] && echo yes)" lacks yes
check_eq ".burhan/SETUP.md is the kit's copy (kit-owned)" "$(t_sha < "$R/.burhan/SETUP.md")" "$(t_sha < "$T_KIT/SETUP.md")"
echo "edited" > "$R/.burhan/SETUP.md"; upg "$R" --apply >/dev/null
check_eq "upgrade refreshes .burhan/SETUP.md" "$(t_sha < "$R/.burhan/SETUP.md")" "$(t_sha < "$T_KIT/SETUP.md")"
check "doctor compares SETUP.md with the kit too" "$(echo x > "$R/.burhan/SETUP.md"; node "$CLI" doctor "$R")" has ".burhan/SETUP.md"
upg "$R" --apply >/dev/null
check_eq "VERSION recorded" "$(cat "$R/.burhan/VERSION")" "$(jq -r .version "$T_ROOT/package.json")"
S="$R/.claude/settings.json"
check_eq "existing permission kept" "$(jq -c .permissions "$S")" '{"allow":["Bash(ls)"]}'
check "existing Stop hook kept" "$(jq -r '.. | .command? // empty' "$S")" has "echo mine"
check "turn-audit wired (exec form: node + args)" "$(hooks_of "$S")" has 'node ${CLAUDE_PROJECT_DIR}/.burhan/hooks/node/main.mjs claude hook turn-audit'
check "no absolute home paths" "$(cat "$S")" lacks "$HOME/"
check "Claude commands installed" "$( [ -f "$R/.claude/commands/burhan/e2e.md" ] && [ -f "$R/.claude/commands/burhan/qc.md" ] && echo yes)" has yes
check "bootstrap block added" "$(cat "$R/CLAUDE.md")" has "<!-- burhan:start"
check "bootstrap imports WORKFLOW.md" "$(cat "$R/CLAUDE.md")" has "@.burhan/WORKFLOW.md"
check "content outside block preserved" "$(cat "$R/CLAUDE.md")" has "Keep this line."

echo "init — idempotent re-run"
echo 'WF_CHECK_CMD="my own check"' >> "$R/.burhan/workflow.config"
inst "$R" --agents claude --apply >/dev/null   # a config change legitimately refreshes generated files (verify skill)
snap="$(tree "$R")"
inst "$R" --agents claude --apply >/dev/null
check_eq "re-run -> byte-identical tree" "$(tree "$R")" "$snap"
check_eq "no duplicate hook entries" "$(hooks_of "$S" | grep -c 'hook turn-audit')" "1"
check "user config not overwritten" "$(cat "$R/.burhan/workflow.config")" has "my own check"

echo "init — bootstrap block refresh keeps outside content"
R2="$(repo)"; printf 'top\n' > "$R2/CLAUDE.md"
inst "$R2" --agents claude --apply >/dev/null
printf 'bottom\n' >> "$R2/CLAUDE.md"
python3 - "$R2/CLAUDE.md" <<'PY'
import sys,re; p=sys.argv[1]; s=open(p).read()
s=re.sub(r'(<!-- burhan:start -->\n<!-- burhan:metadata[^\n]*-->\n).*?(<!-- burhan:end -->)', r'\1STALE BODY\n\2', s, flags=re.S)
open(p,'w').write(s)
PY
inst "$R2" --agents claude --apply >/dev/null
c="$(cat "$R2/CLAUDE.md")"
check "stale block body replaced" "$c" lacks "STALE BODY"
check "text above block kept" "$c" has "top"
check "text below block kept" "$c" has "bottom"
check_eq "exactly one block" "$(grep -c 'burhan:start' "$R2/CLAUDE.md")" "1"

echo "init — --no-bootstrap and absent files"
R3="$(repo)"
inst "$R3" --agents claude --apply --no-bootstrap >/dev/null
check "--no-bootstrap -> no CLAUDE.md created" "$( [ -e "$R3/CLAUDE.md" ] && echo yes)" lacks yes
R4="$(repo)"
inst "$R4" --agents claude --apply >/dev/null
check "absent CLAUDE.md -> created with block" "$(cat "$R4/CLAUDE.md" 2>/dev/null)" has "burhan:end"
check "absent settings.json -> created" "$(hooks_of "$R4/.claude/settings.json")" has "session-gates"

echo "init — user-edited command is not clobbered"
R5="$(repo)"; mkdir -p "$R5/.claude/commands/burhan"; echo "my own feat-e2e" > "$R5/.claude/commands/burhan/e2e.md"
out="$(inst "$R5" --agents claude --apply)"
check_eq "foreign command file kept" "$(cat "$R5/.claude/commands/burhan/e2e.md")" "my own feat-e2e"
check "warns about it" "$out" has "skipped"
echo "init — data safety"
R="$(repo)"; printf '%s\n' '# Mine' '<!-- burhan:start -->' 'IMPORTANT USER CONTENT' > "$R/CLAUDE.md"
before="$(tree "$R")"
out="$(inst "$R" --agents claude --apply)"
check "begin marker without end -> refuses (non-zero)" "$out" lacks "rc=0"
check "begin marker without end -> user content kept" "$(cat "$R/CLAUDE.md")" has "IMPORTANT USER CONTENT"
check_eq "begin marker without end -> nothing written at all" "$(tree "$R")" "$before"

R="$(repo)"; inst "$R" --agents claude --apply >/dev/null
printf 'USER LINE AFTER\n' >> "$R/CLAUDE.md"; t_sedi "s/\$/$(printf '\r')/" "$R/CLAUDE.md"  # a literal CR: BSD sed has no \r
inst "$R" --agents claude --apply >/dev/null
check "CRLF file -> user line kept" "$(cat "$R/CLAUDE.md")" has "USER LINE AFTER"
check_eq "CRLF file -> still exactly one block" "$(grep -c 'burhan:start' "$R/CLAUDE.md")" "1"
check_eq "CRLF file -> line endings stay CRLF" "$(grep -c $'\r$' "$R/CLAUDE.md")" "$(wc -l < "$R/CLAUDE.md" | tr -d ' ')"

R="$(repo)"; mkdir -p "$R/.burhan"; cp -R "$T_ROOT/kit" "$T_ROOT/dist" "$T_ROOT/package.json" "$R/.burhan/"
out="$(cd "$R" && node .burhan/dist/cli.js init . --agents claude --apply 2>&1; echo "rc=$?")"
check "kit inside target/.burhan -> refuses" "$out" lacks "rc=0"
check "kit inside target/.burhan -> kit intact" "$( [ -f "$R/.burhan/kit/templates/story.md" ] && [ -f "$R/.burhan/kit/hooks/core/lib.sh" ] && echo yes)" has yes

R="$(repo)"
out="$(t_timeout 5 node "$CLI" init "$R" --agents 2>&1; echo "rc=$?")"
check "--agents as last argument -> no hang, non-zero" "$out" lacks "rc=124"
check "--agents as last argument -> error" "$out" lacks "rc=0"

for shape in '{"hooks":[]}' '{"hooks":"x"}' '{"hooks":{"Stop":{"hooks":[]}}}' '{"hooks":{"PreToolUse":[null]}}' '{"hooks":{"Stop":[{"hooks":[{"command":5}]}]}}'; do
  R="$(repo)"; mkdir -p "$R/.claude"; echo "$shape" > "$R/.claude/settings.json"; before="$(tree "$R")"
  out="$(inst "$R" --agents claude --apply)"
  check "unexpected hooks shape $shape -> non-zero" "$out" lacks "rc=0"
  check_eq "unexpected hooks shape $shape -> nothing written" "$(tree "$R")" "$before"
done

R="$(repo)"; printf 'shared\n' > "$R/AGENTS.md"; ln -s AGENTS.md "$R/CLAUDE.md"
inst "$R" --agents claude --apply >/dev/null; inst "$R" --agents claude --apply >/dev/null
check "symlinked CLAUDE.md stays a symlink" "$( [ -L "$R/CLAUDE.md" ] && echo yes)" has yes
check_eq "symlink target has exactly one block" "$(grep -c 'burhan:start' "$R/AGENTS.md")" "1"

R="$(repo)"; mkdir -p "$R/.claude"; echo '{"env":{"TOKEN":"x"}}' > "$R/.claude/settings.json"; chmod 600 "$R/.claude/settings.json"
inst "$R" --agents claude --apply >/dev/null
check_eq "file mode of settings.json preserved" "$(t_mode "$R/.claude/settings.json")" "600"

R="$(repo)"; printf 'ro\n' > "$R/CLAUDE.md"; chmod 444 "$R/CLAUDE.md"
out="$(inst "$R" --agents claude --apply)"
check "read-only CLAUDE.md -> non-zero, not silent" "$out" lacks "rc=0"
check_eq "read-only CLAUDE.md -> untouched" "$(cat "$R/CLAUDE.md")" "ro"

echo "init — refreshes exact commands from an installed .burhan snippet"
R="$(repo)"; mkdir -p "$R/.claude" "$R/.burhan/hooks/adapters/claude"
echo '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"bash \"${CLAUDE_PROJECT_DIR:-.}/.burhan/hooks/adapters/claude/hook.sh\" turn-audit --previous","timeout":3}]}]}}' > "$R/.claude/settings.json"
cp "$R/.claude/settings.json" "$R/.burhan/hooks/adapters/claude/settings.snippet.json"
inst "$R" --agents claude --apply >/dev/null
check "previous exact owned command removed" "$(cat "$R/.claude/settings.json")" lacks "--previous"
check_eq "exactly one turn-audit entry" "$(hooks_of "$R/.claude/settings.json" | grep -c 'turn-audit')" "1"
printf 'WF_CHECK_TIMEOUT=200\n' >> "$R/.burhan/workflow.config"
inst "$R" --agents claude --apply >/dev/null
check_eq "pre-commit hook timeout follows WF_CHECK_TIMEOUT + 10" "$(jq '.hooks.PreToolUse[0].hooks[0].timeout' "$R/.claude/settings.json")" "210"

echo "init — edits inside the block are backed up, not silently lost"
R="$(repo)"; inst "$R" --agents claude --apply >/dev/null
t_sedi 's/^At the start of every session/MY EDIT INSIDE. At the start of every session/' "$R/CLAUDE.md"
out="$(inst "$R" --agents claude --apply)"
check "warns about edits inside the block" "$out" has "edited inside"
check "backup keeps the edit" "$(cat "$R"/CLAUDE.md.burhan-backup 2>/dev/null)" has "MY EDIT INSIDE"
echo "init — codex"
R="$(repo)"; printf '# agents\nmine\n' > "$R/AGENTS.md"
out="$(inst "$R" --agents claude,codex --apply)"
check "claude,codex -> rc 0" "$out" has "rc=0"
check "codex adapter installed (inside the Node hooks)" "$( [ -f "$R/.burhan/hooks/node/adapters/codex/hook.mjs" ] && echo yes)" has yes
check "codex hooks wired (the node -e launcher)" "$(hooks_of "$R/.codex/hooks.json")" has 'codex hook turn-audit'
check "codex launcher is one string in the shell-safe subset" "$(hooks_of "$R/.codex/hooks.json" | grep -c '[$%^&|<>!`]')" has 0
check "AGENTS.md block tells Codex to read WORKFLOW.md" "$(cat "$R/AGENTS.md")" has "Read \`.burhan/WORKFLOW.md\`"
check "AGENTS.md own content kept" "$(cat "$R/AGENTS.md")" has "mine"
check "codex trust note printed" "$out" has "trust"
check "...with the step to take (Review hooks)" "$out" has "Review hooks"
snap="$(tree "$R")"; inst "$R" --agents claude,codex --apply >/dev/null
check_eq "claude,codex re-run idempotent" "$(tree "$R")" "$snap"
R="$(repo)"; inst "$R" --agents codex --apply >/dev/null
check "codex only -> no .claude dir" "$( [ -e "$R/.claude" ] && echo yes)" lacks yes
echo "init — regressions (2)"
R="$(repo)"; inst "$R" --agents claude,codex --apply >/dev/null
check "bindings.md created at install (QC1)" "$(cat "$R/.burhan/bindings.md" 2>/dev/null)" has "Project bindings"
echo "| **Branching rule** | MY-OWN-BINDING |" >> "$R/.burhan/bindings.md"
inst "$R" --agents claude,codex --apply >/dev/null
check "re-install keeps the user's bindings (QC1)" "$(cat "$R/.burhan/bindings.md")" has "MY-OWN-BINDING"
check "bootstrap points at bindings.md" "$(cat "$R/CLAUDE.md")" has ".burhan/bindings.md"
check "codex bootstrap explains \$ARGUMENTS (QC7)" "$(cat "$R/AGENTS.md")" has '$ARGUMENTS'
check "Claude bootstrap imports bindings.md" "$(cat "$R/CLAUDE.md")" has "@.burhan/bindings.md"
check "installer wording no longer claims hooks are inert (QC8)" "$(inst "$(repo)" --agents claude --apply)" lacks "inert"
echo "init — team layout"
R="$(repo)"; inst "$R" --agents claude --apply >/dev/null
check_eq ".burhan/.gitignore ignores the private folders" "$(cat "$R/.burhan/.gitignore")" "$(printf '/local/\n/work/\n/discovery/')"
check "config template defaults the state file to local/" "$(cat "$R/.burhan/workflow.config")" has '.burhan/local/PROGRESS.md'
check "command installed under the burhan namespace" "$( [ -f "$R/.claude/commands/burhan/e2e.md" ] && [ -f "$R/.claude/commands/burhan/qc.md" ] && echo yes)" has yes
printf 'build/\n' > "$R/.burhan/.gitignore"; inst "$R" --agents claude --apply >/dev/null
check_eq "existing .gitignore kept, private rules appended" "$(cat "$R/.burhan/.gitignore")" "$(printf 'build/\n/local/\n/work/\n/discovery/')"
R="$(repo)"; inst "$R" --agents claude --apply >/dev/null
printf 'WF_STATE_FILE="docs/PROGRESS.md"\n' >> "$R/.burhan/workflow.config"
check "a shared WF_STATE_FILE gets a note" "$(upg "$R")" has "WF_STATE_FILE"
printf 'WF_X=$(evil)\n' >> "$R/.burhan/workflow.config"
check "a non-literal config line is reported" "$(upg "$R")" has "workflow.config:"

echo "upgrade"
R="$(repo)"
check "upgrade before init -> refuses, points at init" "$(upg "$R")" has "burhan init"
check "upgrade before init -> non-zero" "$(upg "$R")" lacks "rc=0"
inst "$R" --agents claude,codex --apply >/dev/null; snap="$(tree "$R")"
out="$(upg "$R" --apply)"
check "upgrade detects the installed agents (rc 0)" "$out" has "rc=0"
check "upgrade detects the installed agents (codex kept)" "$out" has "hooks → codex"
check_eq "upgrade of an up-to-date project changes nothing" "$(tree "$R")" "$snap"
echo "0.0.9" > "$R/.burhan/VERSION"
check "upgrade names the versions" "$(upg "$R")" has "0.0.9 → $(jq -r .version "$T_ROOT/package.json")"
check "init on an installed project says it refreshes" "$(inst "$R" --agents claude)" has "already installed"
echo "install regressions (2)"
R="$(repo)"; inst "$R" --agents claude --apply >/dev/null
chmod 444 "$R/.claude/commands/burhan/e2e.md"; touch "$R/.burhan/templates/STALE"; before="$(tree "$R")"
out="$(upg "$R" --apply)"
check "unwritable command file -> refuses before writing (non-zero)" "$out" lacks "rc=0"
check_eq "unwritable command file -> nothing changed at all" "$(tree "$R")" "$before"
chmod 644 "$R/.claude/commands/burhan/e2e.md"
R="$(repo)"; mkdir -p "$R/.codex"; chmod 555 "$R/.codex"; before="$(tree "$R")"
out="$(inst "$R" --agents codex)"
check "dry run with an unwritable path still shows the whole plan (an agent sandbox)" "$out" has "hooks → codex"
check "...and names what would block --apply" "$out" has "BLOCKED"
check "...and exits non-zero" "$out" lacks "rc=0"
check_eq "...and changes nothing" "$(tree "$R")" "$before"
out="$(inst "$R" --agents codex --apply)"
check "--apply with an unwritable path still refuses before writing" "$out" lacks "rc=0"
check_eq "...nothing changed" "$(tree "$R")" "$before"
chmod 755 "$R/.codex"
R="$(repo)"; mkdir "$R/CLAUDE.md"; out="$(inst "$R" --agents claude --apply)"
check "CLAUDE.md is a directory -> clear error" "$out" has "not a regular file"
check "CLAUDE.md is a directory -> no stack trace" "$out" lacks "at "
check_eq "CLAUDE.md is a directory -> nothing written" "$( [ -e "$R/.burhan" ] && echo yes)" ""
R="$(repo)"; out="$(inst "$R" --agents claude,claude)"
check_eq "--agents claude,claude -> claude once" "$(printf '%s\n' "$out" | grep -c 'hooks → claude')" "1"
R="$(repo)"; inst "$R" --agents claude,codex --apply >/dev/null
echo "// stale" >> "$R/.burhan/hooks/node/adapters/claude/hook.mjs"
upg "$R" --agents codex --apply >/dev/null
check_eq "upgrade --agents codex also refreshes the Node hooks of the installed claude adapter" "$(t_sha < "$R/.burhan/hooks/node/adapters/claude/hook.mjs")" "$(t_sha < "$T_ROOT/dist/hooks/adapters/claude/hook.mjs")"
R="$(repo)"; inst "$R" --agents claude --apply >/dev/null; chmod 444 "$R/.burhan/bindings.md"
check "read-only bindings.md (never written once present) does not block upgrade" "$(upg "$R" --apply)" has "rc=0"
echo "reviewer subagent and verify skill"
R="$(repo)"; out="$(inst "$R" --agents claude --apply)"
A="$R/.claude/agents/burhan-reviewer.md"
check "reviewer subagent generated" "$(cat "$A" 2>/dev/null)" has "name: burhan-reviewer"
check "reviewer subagent is managed" "$(cat "$A" 2>/dev/null)" has "<!-- managed by burhan"
check "no model line when WF_MODEL_CLAUDE_REVIEWER is empty" "$(cat "$A" 2>/dev/null)" lacks "model:"
check "no verify skill while WF_CHECK_CMD is empty" "$( [ -e "$R/.claude/skills/burhan-verify/SKILL.md" ] && echo yes)" lacks yes
check "says why the verify skill was skipped" "$out" has "WF_CHECK_CMD is not set in the team"
printf '%s\n' 'WF_CHECK_CMD="tool check --fast"' 'WF_MODEL_CLAUDE_REVIEWER=opus' >> "$R/.burhan/workflow.config"
upg "$R" --apply >/dev/null
check "verify skill generated from WF_CHECK_CMD" "$(cat "$R/.claude/skills/burhan-verify/SKILL.md" 2>/dev/null)" has "tool check --fast"
check "verify skill is named burhan-verify" "$(cat "$R/.claude/skills/burhan-verify/SKILL.md" 2>/dev/null)" has "name: burhan-verify"
check "model line from WF_MODEL_CLAUDE_REVIEWER" "$(cat "$A")" has "model: opus"
snap="$(tree "$R")"; upg "$R" --apply >/dev/null
check_eq "re-run with the new files is idempotent" "$(tree "$R")" "$snap"
mkdir -p "$R/.burhan/local"; printf 'WF_MODEL_CLAUDE_REVIEWER=haiku\n' > "$R/.burhan/local/workflow.config"; upg "$R" --apply >/dev/null
check "a local override does not change the committed agent file" "$(cat "$A")" has "model: opus"
R="$(repo)"; mkdir -p "$R/.claude/skills/burhan-verify" "$R/.claude/agents"
echo "my verify" > "$R/.claude/skills/burhan-verify/SKILL.md"; echo "my reviewer" > "$R/.claude/agents/burhan-reviewer.md"
printf 'WF_CHECK_CMD="x"\n' > "$(mkdir -p "$R/.burhan" && echo "$R/.burhan/workflow.config")"
out="$(inst "$R" --agents claude --apply)"
check_eq "a user's own verify skill is kept" "$(cat "$R/.claude/skills/burhan-verify/SKILL.md")" "my verify"
check_eq "a user's own burhan-reviewer is kept" "$(cat "$R/.claude/agents/burhan-reviewer.md")" "my reviewer"
R="$(repo)"; printf 'WF_MODEL_CLAUDE_REVIEWER="a b"\n' > "$(mkdir -p "$R/.burhan" && echo "$R/.burhan/workflow.config")"
out="$(inst "$R" --agents claude --apply)"
check "an invalid model value is reported" "$out" has "WF_MODEL_CLAUDE_REVIEWER"
check "an invalid model value is not written" "$(cat "$R/.claude/agents/burhan-reviewer.md")" lacks "model:"
R="$(repo)"; printf '%s\n' 'WF_MODEL_CLAUDE_REVIEWER=-' 'WF_MODEL_CLAUDE_BUILDER=:' > "$(mkdir -p "$R/.burhan" && echo "$R/.burhan/workflow.config")"
out="$(inst "$R" --agents claude --apply)"
check "a model of only punctuation is no model (it would be broken YAML)" "$(cat "$R/.claude/agents/burhan-reviewer.md")" lacks "model:"
check "an invalid role key is reported as invalid, not as unset" "$out" lacks "WF_MODEL_CLAUDE_BUILDER is not set"
R="$(repo)"; printf '%s\n' 'WF_MODEL_CLAUDE_REVIEWER=true' > "$(mkdir -p "$R/.burhan" && echo "$R/.burhan/workflow.config")"
inst "$R" --agents claude --apply >/dev/null
check "a YAML keyword is no model name (model: true is a boolean)" "$(cat "$R/.claude/agents/burhan-reviewer.md")" lacks "model:"
R="$(repo)"; pipe_err="$(node "$CLI" init "$R" --agents claude --apply 2>"$T_TMP_ROOT/epipe.err" | head -n 1 >/dev/null; cat "$T_TMP_ROOT/epipe.err")"
check "output piped into head: no EPIPE crash" "$pipe_err" lacks "EPIPE"
check "...and the install still completed" "$(node "$CLI" doctor "$R")" has "0 fail"
echo "install regressions"
R="$(repo)"; inst "$R" --agents claude --apply >/dev/null
printf 'WF_CHECK_CMD="first-check"\n' >> "$R/.burhan/workflow.config"; upg "$R" --apply >/dev/null
check "verify skill present while WF_CHECK_CMD is set" "$(cat "$R/.claude/skills/burhan-verify/SKILL.md")" has "first-check"
t_sedi 's/^WF_CHECK_CMD="first-check"$/WF_CHECK_CMD=""/' "$R/.burhan/workflow.config"
out="$(upg "$R" --apply)"
check "emptied WF_CHECK_CMD -> stale managed verify skill removed" "$( [ -e "$R/.claude/skills/burhan-verify/SKILL.md" ] && echo stale)" lacks stale
check "says it was removed" "$out" has "removed"
R="$(repo)"; mkdir -p "$R/.claude/agents"; echo "mine" > "$R/.claude/agents/burhan-reviewer.md"; chmod 444 "$R/.claude/agents/burhan-reviewer.md"
out="$(inst "$R" --agents claude --apply)"
check "a read-only user-owned reviewer file is skipped, not a blocker" "$out" has "rc=0"
check_eq "the user's file is untouched" "$(cat "$R/.claude/agents/burhan-reviewer.md")" "mine"
echo "role agents per phase (thin)"
R="$(repo)"; inst "$R" --agents claude --apply >/dev/null
check "no role agents unless their model key is set" "$(ls "$R/.claude/agents")" lacks "burhan-builder"
printf '%s\n' 'WF_MODEL_CLAUDE_PLANNER=opus' 'WF_MODEL_CLAUDE_BUILDER=haiku' 'WF_MODEL_CLAUDE_EXPLORER=haiku' >> "$R/.burhan/workflow.config"
upg "$R" --apply >/dev/null
check "planner generated with its model" "$(cat "$R/.claude/agents/burhan-planner.md" 2>/dev/null)" has "model: opus"
check "builder generated with its model" "$(cat "$R/.claude/agents/burhan-builder.md" 2>/dev/null)" has "model: haiku"
check "explorer generated with its model" "$(cat "$R/.claude/agents/burhan-explorer.md" 2>/dev/null)" has "model: haiku"
check "role agents are managed" "$(cat "$R/.claude/agents/burhan-builder.md" 2>/dev/null)" has "<!-- managed by burhan"
snap="$(tree "$R")"; upg "$R" --apply >/dev/null
check_eq "idempotent with role agents" "$(tree "$R")" "$snap"
t_sedi 's/^WF_MODEL_CLAUDE_BUILDER=haiku$/WF_MODEL_CLAUDE_BUILDER=""/' "$R/.burhan/workflow.config"; upg "$R" --apply >/dev/null
check "an emptied key removes our managed role agent" "$( [ -e "$R/.claude/agents/burhan-builder.md" ] && echo left)" lacks left
check "...and leaves the others" "$( [ -e "$R/.claude/agents/burhan-planner.md" ] && echo kept)" has kept
echo "mine" > "$R/.claude/agents/burhan-explorer.md"; t_sedi 's/^WF_MODEL_CLAUDE_EXPLORER=haiku$/WF_MODEL_CLAUDE_EXPLORER=""/' "$R/.burhan/workflow.config"; upg "$R" --apply >/dev/null
check_eq "a user's own file with a role name is never removed" "$(cat "$R/.claude/agents/burhan-explorer.md")" "mine"
echo "init — the bash runtime (WF_HOOK_RUNTIME=bash, the rollback) and the move between runtimes"
R="$(repo)"; mkdir -p "$R/.burhan"; printf 'WF_HOOK_RUNTIME=bash\n' > "$R/.burhan/workflow.config"
check "bash runtime init -> rc 0" "$(inst "$R" --agents claude,codex --apply)" has "rc=0"
check "bash runtime installs hooks/core and the adapters" "$( [ -f "$R/.burhan/hooks/core/turn-audit.sh" ] && [ -f "$R/.burhan/hooks/adapters/codex/hook.sh" ] && echo yes)" has yes
check "bash runtime has no Node hooks" "$( [ -e "$R/.burhan/hooks/node" ] && echo yes)" lacks yes
check "bash runtime: Claude commands are bash" "$(hooks_of "$R/.claude/settings.json")" has 'hook.sh" turn-audit'
t_sedi 's/^WF_HOOK_RUNTIME=bash$/WF_HOOK_RUNTIME=node/' "$R/.burhan/workflow.config"
out="$(upg "$R" --apply)"
check "bash -> node upgrade -> rc 0" "$out" has "rc=0"
check "bash -> node: the bash hooks are removed" "$( [ -e "$R/.burhan/hooks/core" ] || [ -e "$R/.burhan/hooks/adapters" ] && echo yes)" lacks yes
check "bash -> node: the Node hooks are installed" "$( [ -f "$R/.burhan/hooks/node/main.mjs" ] && echo yes)" has yes
check "bash -> node: no old hook entries left" "$(hooks_of "$R/.claude/settings.json" "$R/.codex/hooks.json")" lacks "hook.sh"
check "bash -> node: says Codex must be trusted again" "$out" has "Modified since last trusted"
snap="$(tree "$R")"; upg "$R" --apply >/dev/null
check_eq "node upgrade is idempotent" "$(tree "$R")" "$snap"
t_summary
