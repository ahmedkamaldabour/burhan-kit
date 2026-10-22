# burhan — scripts, CI and Windows

[README](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/README.md) · [Configuration](https://github.com/ahmedkamaldabour/burhan-kit/blob/main/docs/configuration.md)

## Scripts and CI

For automation rather than first-time setup:

```bash
npx burhan-kit@latest init --agents claude,codex
npx burhan-kit upgrade --apply
npx burhan-kit doctor
```

- `init` and `upgrade` show their plan before writing unless you add `--apply`. `doctor` is read-only and exits 1 only on a `fail`; a `warn` does not fail it.
- To fail a build on malformed or conflicting project memory, add `npx burhan-kit memory check` (exit 1 on a fail).
- A dry run that meets a path an agent's sandbox protects (Codex protects `.codex/`) still prints the whole plan, marks the path `BLOCKED` and exits 1; run `init`/`upgrade --apply` yourself, outside the sandbox.

## Requirements

- Node 22 or newer on the `PATH` the agent starts with. Nothing else: no bash, `jq`, sha256 tool or `timeout`.
- Claude Code 2.1.139 or newer (the hooks use its exec form).
- Codex runs project hooks only after you trust them.

## Windows

The hooks run on Node, without bash or `jq`. The project's CI runs the Node test suite on `windows-latest` with Node 22 and 24 without bash or `jq` on the `PATH`, and with Node 24 with Git Bash present.

**Not verified yet:** Windows with PowerShell only (no Git Bash), and a real Claude Code or Codex session on Windows. The repository's own shell test suites and `npm run lint` run on Linux and macOS only, not on Windows.

## Other systems

CI also runs the full suite on Ubuntu 24.04 (Node 22 and 24) and macOS (Node 24). A real agent session on macOS was not run.
