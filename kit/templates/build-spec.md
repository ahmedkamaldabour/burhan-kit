# <Title> — Build spec
- **Plan:** ./<slug>-implementation-plan.md
- **Contract:** <1, written by burhan item new>
- **Verified at commit:** <`git rev-parse --short HEAD` when the code below was read>

> The executor follows this file exactly: the same files, the same code, the same order, the same commands (the plan's Executor rules). The planner read the real files and based every code block on them. One section per sub-unit of the plan, with the same number. Tables over prose; nothing repeated from the plan. No status, result or log text here.
> Delete any section that does not apply, except the ones the contract requires (`burhan item check` names a missing one).

## Not verified
What the planner could not read or run, and why. Write "None." when everything was checked.
| What | Why |
|------|-----|

## Sub-unit 1 — <name>
### Files
| Path | Create / modify | Lines (for an edit) |
|------|-----------------|---------------------|
| `<path>` | <create or modify> | <first-last, for an edit> |

### Test
The complete test code, ready to paste.
```
<the complete test code>
```

### RED
- **Command:** `<the exact command>`
- **Expected output:** <the output that shows the test failing>
- **Why it fails:** <the missing behaviour, not a typo>

### Implementation
The complete code. For a purely mechanical edit, use "### Edit" and give the exact text before and after.
```
<the complete implementation code>
```

### GREEN
- **Command:** `<the exact command>`
- **Expected output:** <the output that shows the test passing>

### Lint
- **Command:** `<the fast check, from .burhan/bindings.md>`

### Interfaces
| Produces (for the next sub-unit) | Consumes (from an earlier one) |
|----------------------------------|--------------------------------|
| <exact name and signature> | <exact name and signature, or —> |
