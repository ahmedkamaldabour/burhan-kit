# Security policy

## Reporting a vulnerability

Report a vulnerability privately, through GitHub's private vulnerability reporting: open the **Security** tab of this
repository and choose **Report a vulnerability**, or go straight to
https://github.com/ahmedkamaldabour/burhan-kit/security/advisories/new. Only the maintainers of this repository see
the report.

Do not open a public issue, pull request or discussion for a vulnerability, and do not post it anywhere else before
it is fixed.

A useful report says what you found, the burhan version you used, your operating system, and the steps that show it.

## Supported versions

Fixes go to the latest published minor version only: the minor of the version on the npm dist-tag `latest`
(`npm view burhan-kit version` shows it).

| Version | Gets security fixes |
|---|---|
| The latest minor on npm (`latest`) | yes |
| An older minor | no: upgrade to the latest one |
| A prerelease, published under the npm dist-tag `next` | no |

## What is in scope

- burhan writing, changing or deleting a file outside the project it was run in, for example through a link planted
  in a repository.
- A hook, a command or a configuration value that makes burhan run a program, or read or send data, beyond what that
  setting is documented to do.
- The published npm package: what it contains and its provenance.
- This repository's workflows: the token rights of each job, the pinned actions, the release and publish steps.

Not in scope:

- A command you configured running: the fast check (`WF_CHECK_CMD`) and the command you give to `burhan verify` run
  because you set them.
- What an AI agent (Claude Code, Codex) decides to do in your project. burhan gives it instructions and reports; it
  does not sandbox it.
- A vulnerability in Node.js, npm, git or GitHub themselves. Please report those to their own projects.

## What to expect

- I aim to acknowledge a report within 7 days. There is no fixed time for a fix; I will tell you how it is going.
- A fix ships as a new version on npm. The advisory is published after the fixed version is on npm, and the
  CHANGELOG section of that version says what was fixed. You are credited in the advisory if you want to be.
