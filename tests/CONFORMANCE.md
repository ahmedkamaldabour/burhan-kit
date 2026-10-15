# Hook conformance — running the suites against another implementation

The hook suites are black-box: a component receives JSON on stdin (plus arguments) and its stdout
is checked. Every call goes through `tests/impl.sh`, so a port is verified by the same cases:

    WF_IMPL_CORE="node dist/hooks/core.js" bash tests/run.sh
    WF_IMPL_CLAUDE="node dist/hooks/claude.js" WF_IMPL_CODEX="node dist/hooks/codex.js" bash tests/run.sh

- Core: `<prefix> <check>` with a normalized event on stdin; prints `{"message": "…"}` or nothing.
- Adapters: `<prefix> normalize|emit|hook|… [args]`, same inputs and outputs as the bash scripts.
- Environment knobs the suites set are part of the contract: `WF_CONFIG`, `WF_TIMEOUT_BIN`,
  `WF_CODEX_LEDGER_DIR`, `XDG_STATE_HOME`, `CLAUDE_PROJECT_DIR`.
- `tests/core/lib.test.sh` is bash-internal and skips itself when `WF_IMPL_CORE` is set.
- The Node port's entry takes the part first: `WF_IMPL_CORE="node dist/hooks/main.mjs core"`,
  `WF_IMPL_CLAUDE="node dist/hooks/main.mjs claude"`, `WF_IMPL_CODEX="node dist/hooks/main.mjs codex"`.
- `tests/conformance.test.sh` proves the seam: the suites pass through a pass-through
  implementation and fail against a silent one.
- Switch the generated hook commands from bash to the port only when it passes every suite.
- `tests/node-port.test.sh` runs the suites already ported to Node (`post-edit-reminder`, `pre-commit-check`,
  `session-gates`, `prompt-router`, `turn-audit`, and the `claude` adapter) inside `npm test`.
- Config fixtures in the suites are literal lines (`KEY='text'`, `KEY="text"` without `$` `` ` `` `\`,
  `KEY=word`): the Node hooks read only those, as the CLI does; the bash kit also sources other lines.
- Regexes: the Node hooks read POSIX ERE as GNU grep -E does (measured, `test/hooks/ere.test.ts`), on an
  engine with linear time and a work budget, so no pattern can hang a hook. They refuse back-references
  (`\1`) and patterns over 2,000 states (e.g. `.{30000}`): the check that uses one stays silent.
- Truncation (`cut -c`) counts characters, as on macOS and with uutils coreutils. GNU `cut -c` counts
  bytes, so on GNU systems the bash kit may cut a multi-byte character the port keeps whole.

## Bash-only cases

A case only the bash kit can meet is marked `t_bash_only <WF_IMPL_VAR> <reason> && check …` (`tests/lib.sh`):
under a port it prints `skip - bash-only: <reason>` and counts neither as a pass nor a failure. Keep
this list short; every entry needs a reason.

| Suite | Case | Why bash-only |
|---|---|---|
| `core/pre-commit-check` | no timeout utility (`WF_TIMEOUT_BIN=none`) | the bash kit relies on `timeout(1)`; a port has its own timeout, so the case cannot arise |
