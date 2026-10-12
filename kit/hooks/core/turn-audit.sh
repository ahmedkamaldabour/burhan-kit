#!/usr/bin/env bash
# End of turn: the only whole-turn retro-check. Independent checks, one message — same moment,
# one read of the turn (phases/enforcement.md "consolidate"). The adapter guarantees `turn` covers ONLY the
# current turn, and that "written" means a real write tool call — never a mention in text. Files the
# turn's shell commands wrote via redirection / tee are added too (shell-writes.awk; a heuristic).
#
#   A  unverified completion   code written + completion claimed + no evidence command
#   B  state not recorded      a work-item file written, the state file not
#   C  forbidden command       a command matching WF_FORBIDDEN_REGEX ran
#   D  state over budget       the state file is longer than WF_STATE_BUDGET lines
#   E  contradictory status    a written item file says pending (status Draft/Planned) and done
#                              (✅ Reviewed/Completed, a ✅ sub-unit heading, or a Completed/Resolved/QC PASS status)
#   F  skill not used          (WF_SKILLS on) the phase's skill was not invoked this turn
#   G  read-only violated      the state file marks the work read-only and code was written
#   H  QC provenance           a QC file written this turn has no filled "Performed by", or was
#                              written in the same turn as code (not independent — WORKFLOW §2 · 8)
. "$(dirname "$0")/lib.sh"
wf_init

# A reentrant Stop (the agent continued after a finding) is not re-audited — but its steps are recorded.
if [ "$(wf_get .reentrant)" = "true" ]; then wf_evidence_record; wf_emit; fi

written="$({ wf_written; wf_shell_writes; } | awk 'NF && !seen[$0]++')"
created="$(wf_created)"
cmds="$(wf_list .turn.shell_commands)"
skills_used="$(wf_list .turn.skills_used)"
text="$(wf_get .turn.assistant_text)"
state_path="$WF_PROJECT/$WF_STATE_FILE"

any() { printf '%s\n' "$2" | grep -qE -- "$1"; }          # any line of $2 matches $1
code_written=0
[ -n "$WF_CODE_REGEX" ] && [ -n "$written" ] && any "$WF_CODE_REGEX" "$written" && code_written=1
used() { printf '%s\n' "$skills_used" | grep -qE -- "$1"; }
docs_re="^$(wf_re_escape "$WF_DOCS_DIR")/[^/]+/"

# ---- A ---------------------------------------------------------------------------------------
CLAIM='(^|[^[:alnum:]_])(done|fixed|passing|passes|complete|completed|works now)([^[:alnum:]_]|$)|✅|(^|[[:space:][:punct:]])(خلص|خلصت|اتصلح)([[:space:][:punct:]]|$)'
# Negated claims ("not done yet", "isn't passing", "مش خلص") are not claims.
claim_text="$(printf '%s' "$text" | tr '[:upper:]' '[:lower:]' \
  | sed -E "s/(not|n't|no longer)[[:space:]]+(yet[[:space:]]+)?(fully[[:space:]]+)?(done|fixed|passing|passes|complete|completed)/ /g; s/(to be|yet to be|still to be|before it is|until it is)[[:space:]]+(done|fixed|complete|completed)/ /g; s/(once|when|after|until|none of) (that|this|it|these|those)( is| are)? (done|fixed|complete|completed)/ /g; s/(not quite|almost|nearly) (done|fixed|complete|completed)/ /g; s/(is|are) (it|this|that|they) (done|fixed|complete|completed)[?]/ /g; s/مش (خلص|خلصت|اتصلح)/ /g")"
# Ordered steps (evidence ledger). One jq pass flattens them; paths go through the SAME normaliser
# (wf_rel_stream) and both patterns through the SAME matcher (grep -E) as every other check, so this
# check and "code was written" can never disagree. Adapters that cannot order the turn
# send no steps — then only "did an evidence command run at all" can be checked.
sub_cmds=""; sub_written=""
stmp="$(mktemp -d 2>/dev/null)"
if [ -n "$stmp" ]; then
  printf '%s' "$WF_EVENT" | jq -r '(.turn.steps // [])[]
    | [ (.seq // 0), (.kind // ""), (.status // "unknown"), (.exit // ""), (.file // ""), (.cmd // ""), (.by // "") ]
    | map(tostring | gsub("[\t\n\r]"; " ")) | join("\t")' > "$stmp/steps" 2>/dev/null
  awk -F'\t' '$2 == "edit" { print $1 }' "$stmp/steps" > "$stmp/eseq"
  awk -F'\t' '$2 == "edit" { print $5 }' "$stmp/steps" | wf_rel_stream > "$stmp/efile"
  awk -F'\t' '$2 == "cmd"' "$stmp/steps" > "$stmp/cmds"
  cut -f6 "$stmp/cmds" > "$stmp/ccmd"
  # What subagents did this turn (steps with "by"): their edited files for B and H, their commands for
  # C — one line per command line, newlines kept, like the main agent's.
  sub_written="$(awk -F'\t' '$2 == "edit" && $7 != "" { print $5 }' "$stmp/steps" | wf_rel_stream)"
  sub_cmds="$(printf '%s' "$WF_EVENT" | jq -r '(.turn.steps // [])[] | select(.kind == "cmd" and (.by // "") != "")
    | .by as $b | (.cmd // "" | split("\n")[]) | [$b, .] | map(gsub("[\t\r]"; " ")) | join("\t")' 2>/dev/null)"
fi
# Code edited by a subagent this turn (a delegated build) is in the steps, not in "written". It counts
# for A and G — "done" after a delegated build still needs evidence after that edit, and read-only work
# stays read-only — but not for F/H, which judge the main agent's own skills and files.
code_in_turn="$code_written"
[ "$code_in_turn" = 0 ] && [ -n "$WF_CODE_REGEX" ] && [ -n "$stmp" ] && [ -s "$stmp/efile" ] \
  && grep -qE -- "$WF_CODE_REGEX" "$stmp/efile" 2>/dev/null && code_in_turn=1
if [ "$code_in_turn" = 1 ] && printf '%s' "$claim_text" | grep -qE -- "$CLAIM"; then
  if [ -z "$WF_EVIDENCE_REGEX" ]; then
    wf_say "⚠ VERIFICATION GATE: code changed and completion was claimed, but no evidence pattern configured (WF_EVIDENCE_REGEX), so this turn's verification cannot be checked. Show the command output that proves the claim, or retract it."
  elif [ -n "$stmp" ] && [ -s "$stmp/steps" ]; then
    # last code edit: its seq and its (normalised) file
    ln="$(grep -nE -- "$WF_CODE_REGEX" "$stmp/efile" 2>/dev/null | tail -n 1 | cut -d: -f1)"
    last_edit=0; last_file=""
    [ -n "$ln" ] && { last_edit="$(sed -n "${ln}p" "$stmp/eseq")"; last_file="$(sed -n "${ln}p" "$stmp/efile")"; }
    # every evidence run, in order: seq <TAB> status <TAB> exit <TAB> cmd
    grep -nE -- "$WF_EVIDENCE_REGEX" "$stmp/ccmd" 2>/dev/null | cut -d: -f1 > "$stmp/evl"
    # Every agent's runs count — a failure from a builder, a reviewer or any subagent is a failure, and
    # a subagent's pass is evidence. Only a SUBAGENT's run with no result is dropped — blocked,
    # background, or still running (unknown) — and the subagent reports back to the main agent
    # (never hide a real failure, never credit a run that has not finished).
    awk 'NR == FNR { want[$1] = 1; next } want[FNR]' "$stmp/evl" "$stmp/cmds" | cut -f1,3,4,6,7 \
      | awk -F'\t' '!($5 != "" && ($2 == "blocked" || $2 == "background" || $2 == "unknown"))' > "$stmp/ev"
    if [ ! -s "$stmp/ev" ]; then
      wf_say "⚠ VERIFICATION GATE: code changed and completion was claimed, but no verification command ran this turn. Run the checks now and show the real output, or explicitly retract the claim."
    elif ! awk -F'\t' -v le="${last_edit:-0}" '$1 + 0 > le + 0 { f = 1 } END { exit !f }' "$stmp/ev"; then
      early="$(tail -n 1 "$stmp/ev" | cut -f4)"
      wf_say "⚠ VERIFICATION GATE: completion was claimed, but the evidence (\`$early\`) ran before the last code edit (\`$last_file\`), so it does not prove the final code. Re-run it now and show the output."
    else
      # After the last edit, every distinct evidence command must have its LAST run passing: a later
      # pass of the same command supersedes a failure; a different command passing does not. A blocked
      # or background run never produced a result, so it does not undo an earlier result of the SAME
      # command; a command that never produced one is reported. Fields are joined with \037, not a tab: an empty exit must not
      # shift the command.
      bad="$(awk -F'\t' -v le="${last_edit:-0}" '$1 + 0 > le + 0 {
            c = $4
            if (!(c in seen)) { seen[c] = 1; order[++n] = c }
            if ($2 == "blocked" || $2 == "background") { if (!(c in st)) { nst[c] = $2; nex[c] = $3 } }
            else { st[c] = $2; ex[c] = $3 }
          }
          END {
            for (i = 1; i <= n; i++) { c = order[i]; if ((c in st) && st[c] == "failed") { printf "failed\037%s\037%s\n", ex[c], c; exit } }
            for (i = 1; i <= n; i++) { c = order[i]; if (!(c in st) && (c in nst)) { printf "%s\037%s\037%s\n", nst[c], nex[c], c; exit } }
          }' "$stmp/ev")"
      if [ -n "$bad" ]; then
        IFS=$'\037' read -r b_status b_exit b_cmd <<< "$bad"
        case "$b_status" in
          failed)     wf_say "⚠ VERIFICATION GATE: completion was claimed, but the last run of \`$b_cmd\` failed${b_exit:+ (exit $b_exit)}. Fix it and re-run, then show the passing output — or retract the claim." ;;
          blocked)    wf_say "⚠ VERIFICATION GATE: completion was claimed, but the last run of \`$b_cmd\` was blocked and never ran. Run it, show the output — or retract the claim." ;;
          background) wf_say "⚠ VERIFICATION GATE: completion was claimed, but the last run of \`$b_cmd\` was in the background — its result is unknown. Run it in the foreground and show the output." ;;
        esac
      fi
    fi
  elif ! any "$WF_EVIDENCE_REGEX" "$cmds"; then
    wf_say "⚠ VERIFICATION GATE: code changed and completion was claimed, but no verification command ran this turn. Run the checks now and show the real output, or explicitly retract the claim."
  fi
fi
[ -n "$stmp" ] && rm -rf "$stmp"

# ---- B ---------------------------------------------------------------------------------------
# A story or plan written by a subagent (a planner) counts too; the state file is the main agent's job.
if { any "$docs_re" "$written" || { [ -n "$sub_written" ] && any "$docs_re" "$sub_written"; }; } \
   && ! printf '%s\n%s\n' "$written" "$sub_written" | grep -qxF -- "$WF_STATE_FILE"; then
  wf_say "⚠ STATE-TRANSITION GATE: a work-item file changed this turn but \`$WF_STATE_FILE\` was not updated. Write every transition before the turn ends (WORKFLOW §5): edit the existing line in place — no new paragraph, no copied detail (link the file)."
fi

# ---- C ---------------------------------------------------------------------------------------
if [ -n "$WF_FORBIDDEN_REGEX" ]; then
  # The main agent's commands, then a subagent's (a delegated build runs most commands).
  hit="$(printf '%s\n' "$cmds" | grep -E -- "$WF_FORBIDDEN_REGEX" | head -n 1)"; who=""
  if [ -z "$hit" ] && [ -n "$sub_cmds" ]; then
    # One grep over every subagent command line, then the subagent of the first hit (for speed).
    n="$(printf '%s\n' "$sub_cmds" | cut -f2- | grep -nE -- "$WF_FORBIDDEN_REGEX" | head -n 1 | cut -d: -f1)"
    if [ -n "$n" ]; then
      line="$(printf '%s\n' "$sub_cmds" | sed -n "${n}p")"
      who=" (run by the \`${line%%$'\t'*}\` subagent)"; hit="${line#*$'\t'}"
    fi
  fi
  if [ -n "$hit" ]; then
    reason="$WF_FORBIDDEN_REASON"
    [ -n "$reason" ] || reason="It is on the project forbidden list (WORKFLOW §1)."
    wf_say "🛑 FORBIDDEN COMMAND: \`$(printf '%s' "$hit" | cut -c1-160)\` ran this turn$who. $reason Say so plainly and do not run it again."
  fi
fi

# ---- D ---------------------------------------------------------------------------------------
if [ -f "$state_path" ]; then
  lines="$(awk 'END { print NR }' "$state_path")"
  if [ -n "$lines" ] && [ "$lines" -gt "$WF_STATE_BUDGET" ]; then
    wf_say "⚠ STATE-SIZE GATE: \`$WF_STATE_FILE\` is $lines lines (budget: $WF_STATE_BUDGET). It is a snapshot, not a journal (WORKFLOW §5): close out items no longer in flight, keep one-line pointers, delete resolved lines."
  fi
fi

# ---- E ---------------------------------------------------------------------------------------
disc_re="^$(wf_re_escape "$WF_DISCOVERY_DIR")/[0-9]{4}-[0-9]{2}-[0-9]{2}-[^/]+\.md$"
stale=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ "${f##*/}" = README.md ] && continue
  printf '%s' "$f" | grep -qE -- "$docs_re|$disc_re" || continue
  [ -f "$WF_PROJECT/$f" ] || continue
  # Ignore fenced code blocks, and ladder lines ("Draft → Approved → …", 2+ arrows) — vocabulary, not state.
  states="$(awk '/^[[:space:]]*```/ { f = !f; next } !f' "$WF_PROJECT/$f" | grep -v '→.*→')"
  if printf '%s\n' "$states" | grep -qiE '(^|[^a-z])status:\**[[:space:]]*\**[[:space:]]*(draft|planned)\b' \
     && printf '%s\n' "$states" | grep -qiE '✅[[:space:]]*(reviewed|completed)|^#+ .*sub-unit.*✅|(status|verdict):\**[[:space:]]*\**[[:space:]]*(completed|resolved|qc pass)\b'; then
    stale="${stale:+$stale, }\`$f\`"
  fi
done <<< "$written"
[ -n "$stale" ] && wf_say "⚠ STALE-STATUS GATE: $stale says both pending (status Draft/Planned) and done (✅ Reviewed/Completed, or a Completed/Resolved/QC PASS status). Fix the status line that was never revisited."

# ---- F ---------------------------------------------------------------------------------------
if wf_skills_on; then
  if any "${docs_re}.*-story\.md$" "$created" && ! used brainstorming; then
    wf_say "⚠ SKILL GATE (story): a story was CREATED this turn without superpowers:brainstorming. Invoke it now if it was skipped, or say when it ran."
  fi
  if any "${docs_re}.*-implementation-plan\.md$" "$created" && ! used writing-plans; then
    wf_say "⚠ SKILL GATE (plan): a plan was CREATED this turn without superpowers:writing-plans."
  fi
  # A declared patch needs evidence, not the TDD skill. Declared = the routing line "patch — <reason>"
  # at the start of a line, AND no routed item in flight unless its Route is patch, AND nothing written
  # matches WF_SENSITIVE_REGEX (WORKFLOW §3: no doubt, nothing sensitive). A mention is not a route.
  is_patch=0
  if printf '%s\n' "$text" | grep -qiE '^[[:space:]>*_-]*patch\**[[:space:]]*(—|–)'; then
    is_patch=1
    # A routed item in flight must itself be change, bug or refactor / patch (wf_item_route: exact value).
    if [ -n "$(wf_item_now)" ]; then case "$(wf_item_route)" in "change / patch"|"bug / patch"|"refactor / patch") ;; *) is_patch=0 ;; esac; fi
    [ -n "$WF_SENSITIVE_REGEX" ] && any "$WF_SENSITIVE_REGEX" "$written" && is_patch=0
  fi
  if [ "$code_written" = 1 ] && [ "$is_patch" = 0 ] && ! used 'test-driven-development|systematic-debugging'; then
    wf_say "⚠ SKILL GATE (code): code was written this turn without superpowers:test-driven-development or superpowers:systematic-debugging. Confirm the skill was used, or invoke it before continuing."
  fi
  reviews="$(printf '%s\n' "$written" | grep -E '/reviews/[^/]+\.md$' | grep -vE -- '-(qc|verification)(-r[0-9]+)?\.md$')"
  if [ -n "$reviews" ] && ! used requesting-code-review; then
    wf_say "⚠ SKILL GATE: a review file was written this turn without superpowers:requesting-code-review."
  fi
fi

# ---- G ---------------------------------------------------------------------------------------
# Read-only when marked exactly yes — or on a read-only route unless marked exactly no (fail safe).
read_only=0
if [ "$code_in_turn" = 1 ]; then
  ro="$(wf_item_field Read-only)"
  case "$(wf_item_route)" in "investigation / "*|"bug / spike") [ "$ro" != no ] && read_only=1 ;; *) [ "$ro" = yes ] && read_only=1 ;; esac
fi
if [ "$read_only" = 1 ]; then
  wf_say "🛑 READ-ONLY GATE: the work in flight is marked read-only (investigation / bug + spike) but code was written this turn. Revert it or open a new routed item to implement the finding (WORKFLOW §3)."
fi

# ---- H ---------------------------------------------------------------------------------------
# Provenance: every QC file written this turn, by the main agent or a subagent (the reviewer is the
# normal QC path). Independence: only a QC the main agent wrote next to its own code.
qcs_main="$(printf '%s\n' "$written" | grep -E -- "${docs_re}reviews/[^/]+-qc(-r[0-9]+)?\.md$")"
qcs="$(printf '%s\n%s\n' "$qcs_main" "$sub_written" | grep -E -- "${docs_re}reviews/[^/]+-qc(-r[0-9]+)?\.md$" | awk '!seen[$0]++')"
if [ -n "$qcs" ]; then
  noprov=""
  while IFS= read -r f; do
    [ -f "$WF_PROJECT/$f" ] || continue
    by="$(grep -m1 -E '\*\*Performed by:\*\*' "$WF_PROJECT/$f" | sed -E 's/.*\*\*Performed by:\*\*[[:space:]]*//')"
    by="$(printf '%s' "$by" | tr -d '*\r' | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
    # The fixed form, read exactly like burhan stats (src/lib/facts.ts PERFORMED): "<agent> · <model> ·
    # <context>", the context exactly one of the four. Anything else is missing.
    if ! printf '%s\n' "$by" | grep -qxE "$WF_PERFORMED_RE"; then
      noprov="${noprov:+$noprov, }\`$f\`"
    fi
  done <<< "$qcs"
  [ -n "$noprov" ] && wf_say "⚠ QC PROVENANCE: $noprov does not say who performed the QC. Fill **Performed by** (agent · model · context: fresh subagent / other agent / human / same session); same session must also be listed under Limitations (WORKFLOW §2 · 8)."
  # Already declared as same-session (the remedy this message suggests) -> nothing more to say.
  [ "$code_written" = 1 ] && [ -n "$qcs_main" ] && ! printf '%s\n' "$qcs_main" | while IFS= read -r f; do grep -m1 -E '\*\*Performed by:\*\*' "$WF_PROJECT/$f" 2>/dev/null | tr -d '*\r' | grep -qE ' · same session[[:space:]]*$' && echo y; done | grep -q y \
    && wf_say "⚠ QC INDEPENDENCE: a QC report was written in the same turn as code, so it is not independent. Re-run QC in a fresh context (Claude Code: the burhan-reviewer subagent), or record 'same session' as a limitation."
fi

# ---- Evidence ledger ------------------------------------------------------------------------
wf_evidence_record

wf_emit
