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
- `tests/conformance.test.sh` proves the seam: the suites pass through a pass-through
  implementation and fail against a silent one.
- Switch the generated hook commands from bash to the port only when it passes every suite.
