#!/usr/bin/env bash
# The kit must not assume any language, framework, runtime, test runner or datastore.
# Such names may appear only on lines explicitly marked as examples ("e.g." or "Example:").
# Scope: everything under kit/ — the files that get copied into projects. The CLI (src/), package
# metadata and README describe the tool itself and may name its own runtime.
. "$(dirname "$0")/lib.sh"
cd "$T_ROOT" || exit 1

# POSIX word boundaries (no GNU-only \b), so the test behaves the same on BSD/macOS grep.
DENY='(^|[^[:alnum:]_])(tsc|jest|vitest|mocha|npm|npx|yarn|pnpm|php|artisan|composer|laravel|symfony|nest(js)?|react|vue|angular|svelte|next\.?js|django|flask|fastapi|rails|rspec|pytest|phpunit|eslint|prettier|mongo(db)?|mysql|postgres(ql)?|redis|controller)($|[^[:alnum:]_])'

echo "neutrality — no technology names outside labelled examples"
hits=""; scanned=0
while IFS= read -r f; do
  case "$f" in kit/*) ;; *) continue ;; esac
  [ -f "$f" ] || continue
  grep -Iq . "$f" 2>/dev/null || continue   # skip binary / empty
  scanned=$((scanned + 1))
  h="$(grep -n -i -E "$DENY" "$f" | grep -v -E 'e\.g\.|Example:' | sed "s|^|$f:|")"
  [ -n "$h" ] && hits="${hits}${h}"$'\n'
done < <(git ls-files --cached --others --exclude-standard 2>/dev/null || find kit -type f)

check "scanned at least one file ($scanned) — never a pass on an empty list" "$([ "$scanned" -gt 0 ] && echo yes)" has "yes"
if [ -z "$hits" ]; then
  check "no unlabelled technology names" "" lacks "x"
else
  check "no unlabelled technology names" "$hits" lacks ":"
  printf '%s' "$hits" | head -20 | sed 's/^/        /'
fi
t_summary
