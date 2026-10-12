---
name: verify
description: Run this project's fast pre-commit check (burhan · WF_CHECK_CMD) and show its output. Use right before every commit.
---

Run exactly this command from the project root. Show the command and its full output:

    {{CHECK_CMD}}

- Exit status 0: report "verify: passed" with the output.
- Anything else: do not commit. Report the failure with its output, then fix it or ask.

This is the same check burhan's pre-commit hook runs (`WF_CHECK_CMD` in `.workflow/workflow.config`).
