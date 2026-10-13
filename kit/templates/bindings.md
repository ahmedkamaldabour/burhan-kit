# Project bindings
The project-specific half of the working agreement (`.burhan/WORKFLOW.md` §1). Created once by
`burhan init` and **never overwritten** — upgrades keep it. Keep it consistent with
`.burhan/workflow.config`, its machine-readable twin. Mark anything not applicable with `—`.

| Binding | Value in this project | Config key |
|---|---|---|
| **Work-item source** | *(issue tracker / backlog file / conversation — name it)* | — |
| **Work-item vocabulary** | *(story / ticket / task / bug / chore)* | — |
| **Work-item docs location** | *(one folder per item)* | `WF_DOCS_DIR` |
| **Discovery location** | *(dated files for things found mid-task)* | `WF_DISCOVERY_DIR` |
| **Live state file** | *(per developer — default `.burhan/local/PROGRESS.md`, git-ignored — §5)* | `WF_STATE_FILE`, `WF_STATE_BUDGET` |
| **Work-item index** | *(generated — `<docs>/README.md`, written by the kit's status command; never hand-edited)* | — |
| **Kit command** | *(how this project runs the kit CLI, e.g. `npx burhan-kit` or `burhan`)* | — |
| **Discovery index** | *(default `<discovery>/README.md` — one line per discovery)* | — |
| **Project memory location** | *(.burhan/PROJECT.md + .burhan/context/ — phases/memory.md)* | — |
| **Fast check command** | *(non-mutating, seconds — run before every commit)* | `WF_CHECK_CMD` |
| **Test command** | | — |
| **Run / preview command** | | — |
| **Verification identity** | *(which user, role or environment proves the change works — or `—`)* | — |
| **What counts as code / tests** | *(file patterns)* | `WF_CODE_REGEX`, `WF_TEST_REGEX` |
| **Verification evidence** | *(commands whose output proves a change)* | `WF_EVIDENCE_REGEX` |
| **Sensitive paths** | *(files that affect access control or visibility)* | `WF_SENSITIVE_REGEX`, `WF_SENSITIVE_NOTE` |
| **Process skills** | *(a skills plugin, or `none` — phases/skills.md)* | `WF_SKILLS` |
| **Docs / content language** | | — |
| **Branching rule** | *(e.g. never commit to the default branch; branch first)* | — |

**Detect, don't assume.** If a binding is blank, infer it from the repo (manifests, scripts, CI
config, existing docs) and **state the inference before relying on it**. Never invent a command.
