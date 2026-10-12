#!/usr/bin/env bash
# No internal name reaches the repository. The patterns (one ERE per line, case-insensitive; blank lines
# and # comments ignored) live in the git-ignored .internal/scrub.txt, so the names never enter git
# themselves. Without that file (CI, a fresh clone) the repository scan is skipped; the self-checks run.
. "$(dirname "$0")/lib.sh"

# scrub_scan <repo> <patterns-file> -> "path:line:text" for every hit in tracked and untracked, not
# ignored, text files (.internal/ excluded). A blank pattern line would match everything: dropped.
scrub_scan() {
  local repo="$1" pats f
  pats="$(mktemp)"; grep -vE '^[[:space:]]*(#|$)' "$2" > "$pats"
  if [ -s "$pats" ]; then
    git -C "$repo" ls-files --cached --others --exclude-standard 2>/dev/null | while IFS= read -r f; do
      case "$f" in .internal/*) continue ;; esac
      [ -f "$repo/$f" ] || continue
      grep -n -I -i -E -f "$pats" -- "$repo/$f" 2>/dev/null | sed "s|^|$f:|"
    done
  fi
  rm -f "$pats"
}

echo "scrub — self-checks (temp repository)"
R="$(t_tmp)"; git -C "$R" init -q
mkdir -p "$R/src"; printf 'clean text\n' > "$R/src/a.txt"; printf 'mentions SecretName here\n' > "$R/src/b.txt"
printf 'ignored/\n' > "$R/.gitignore"; mkdir -p "$R/ignored"; printf 'SecretName\n' > "$R/ignored/c.txt"
git -C "$R" add src/a.txt .gitignore
PAT="$(t_tmp)/scrub.txt"; printf '# a comment\n\nsecretname\n' > "$PAT"
out="$(scrub_scan "$R" "$PAT")"
check "a planted name is found (case-insensitive, untracked file too)" "$out" has "src/b.txt:1:"
check "a git-ignored file is not scanned" "$out" lacks "ignored/c.txt"
check "a clean file is not reported" "$out" lacks "src/a.txt"
check_eq "comments and blank lines are not patterns" "$(printf 'x\n' > "$R/src/b.txt"; scrub_scan "$R" "$PAT")" ""

echo "scrub — this repository"
S="$T_ROOT/.internal/scrub.txt"
if [ -f "$S" ]; then
  hits="$(scrub_scan "$T_ROOT" "$S")"
  check "no internal names (patterns: .internal/scrub.txt)" "$hits" lacks ":"
  [ -n "$hits" ] && printf '%s\n' "$hits" | head -20 | sed 's/^/        /'
else
  echo "  skip - no .internal/scrub.txt (git-ignored; the owner's list of internal names)"
fi
t_summary
