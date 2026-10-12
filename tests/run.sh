#!/usr/bin/env bash
# Runs every tests/**/*.test.sh sequentially. Non-zero exit if any file fails.
#   bash tests/run.sh
set -u
cd "$(dirname "$0")/.." || exit 1
files=0; failed=0
while IFS= read -r f; do
  files=$((files + 1))
  echo "# $f"
  bash "$f" || { failed=$((failed + 1)); echo "  ^ FAILED: $f"; }
done < <(find tests -name '*.test.sh' -type f | sort)
echo
echo "test files: $files  failed files: $failed"
[ "$failed" -eq 0 ]
