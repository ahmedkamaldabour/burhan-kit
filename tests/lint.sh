#!/usr/bin/env bash
# Syntax-checks every shell script in the repo (`bash -n`; since 0.3.0 only the test suites). shellcheck is not assumed.
# Also rejects GNU-only forms in kit/ and tests/ (the hooks and suites run on macOS too):
# a negative `head` count, `sed -i` without a suffix, and `readlink -f`.
#   bash tests/lint.sh
set -u
cd "$(dirname "$0")/.." || exit 1
bad=0; n=0
while IFS= read -r f; do
  n=$((n + 1))
  bash -n "$f" || { bad=$((bad + 1)); echo "syntax error: $f"; }
done < <(find . -name '*.sh' -type f -not -path './.git/*' -not -path './node_modules/*' | sort)
# GNU-only forms (this file names them, so it is skipped)
gnu="$(grep -rnE 'head[[:space:]]+-[cn][[:space:]]*-[0-9]|sed[[:space:]]+-i[[:space:]]|readlink[[:space:]]+-f' kit tests \
  --include='*.sh' | grep -v '^tests/lint\.sh:')"
[ -n "$gnu" ] && { bad=$((bad + 1)); printf 'GNU-only (fails on macOS):\n%s\n' "$gnu"; }
echo "lint: $n scripts, $bad with errors"
[ "$bad" -eq 0 ]
