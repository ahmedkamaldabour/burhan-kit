# Releasing

A release is one workflow, `.github/workflows/release.yml`, that starts when a `v*` tag is pushed. This page says what it does and what stays yours.

## What the workflow does

| Job | What it does | If it fails |
|---|---|---|
| `guard` | `scripts/release-guard.mjs`: the tag must be `v` + the version in `package.json`; the commit must be on `main`; that version must not be on npm yet (a registry that cannot be read counts as a refusal) | nothing else runs |
| `verify` | `npm run lint` and `npm test` on Node 22 and on Node 24 | nothing is packed |
| `pack` | `scripts/pack-smoke.mjs`: packs once, installs that tarball in an empty folder, runs `burhan --version` and requires the package version; keeps the tarball | nothing is published |
| `publish` | waits for your approval on the `npm-release` environment (only if you set that up, see below), then publishes **that same tarball** with `--provenance` | npm refuses a duplicate version |

Windows and macOS are tested by `ci.yml` on every push, including the release commit; the release job itself runs on Linux. No npm token is stored: npm trusted publishing identifies the workflow, and `--provenance` links the published version to the commit and run that built it.

## What stays yours

1. **Once, on GitHub, before anything else:** Settings → Environments → New environment `npm-release`; add yourself as a required reviewer; limit deployments to only `v*` tags. **Without the required reviewer there is no approval:** GitHub creates a missing environment on first use with no protection, and the `publish` job runs with no pause. The guard runs from the tagged commit's own copy of the workflow, so the required reviewer, this environment limit and the npm setting are the real controls, not the guard alone. The limit does not stop a `v*` tag on a side branch; the reviewer is who catches that.
2. **Once, on npmjs.com:** open the `burhan-kit` package → Settings → Trusted publisher → GitHub Actions, with owner `ahmedkamaldabour`, repository `burhan-kit`, workflow filename `release.yml` and environment `npm-release`. Under Allowed actions, tick **Allow npm publish** (the workflow runs `npm publish`); leave Allow npm dist-tag off. npm shows the new publisher as `Pending validation` until a first publish succeeds through it, and its banner gives a date by which that publish must happen: plan the first release before that date.
3. **Each release:** bump `version` in `package.json`, write the CHANGELOG section, commit on `main`, push `main` and wait for CI to be green.
4. You push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
5. Approve the `publish` job in the Actions tab when `guard`, `verify` and `pack` are green.
6. Check `npm view burhan-kit version dist-tags`, and write the GitHub Release by hand as before (the workflow does not).

A prerelease version (`1.0.0-rc.1`) is not supported yet: the publish step has no `--tag`, and npm may refuse a prerelease without one.

## Pinned actions

Every `uses:` in `ci.yml` and `release.yml` is a commit SHA with its tag in a comment, so a moved tag cannot change what runs. The pins are bumped by hand: look up a tag's commit with `git ls-remote https://github.com/<owner>/<repo> '<tag>^{}' '<tag>'` (the `^{}` line, when there is one, is the commit of an annotated tag; otherwise the plain line is), change the SHA and the comment together. A test fails on a pin that is only a tag.

## Not verified here

The workflow ran end to end for v0.6.0 (run 40498521668: the guard, lint and tests on Node 22 and 24, the pack check, and the publish with provenance; npm lists 0.6.0). It has not been run for any other tag yet, and the Windows and macOS jobs of `ci.yml` run on a push and on a pull request.
