#!/usr/bin/env bash
# After a file write/edit: a phase-specific nudge. Worded differently from the session-start and
# pre-commit gates on purpose — identical text everywhere trains the reader to skip all of it.
# Silent for files that match none of the configured patterns.
. "$(dirname "$0")/lib.sh"
wf_init

f="$(wf_get .file)"
[ -n "$f" ] || wf_emit
f="$(wf_rel "$f")"

if ! wf_match "$WF_TEST_REGEX" "$f" && wf_match "$WF_CODE_REGEX" "$f"; then
  wf_say "Code changed — was the failing test written FIRST? If not, test-first was skipped: say so. Then run only the affected test file and the fast check."
fi
if wf_match "$WF_SENSITIVE_REGEX" "$f" && [ -n "$WF_SENSITIVE_NOTE" ]; then
  wf_say "$WF_SENSITIVE_NOTE"
fi
wf_emit
