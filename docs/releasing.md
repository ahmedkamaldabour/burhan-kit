# Releasing

A release is one workflow, `.github/workflows/release.yml`, that starts when a `v*` tag is pushed. This page says what it does and what stays yours.

## What the workflow does

| Job | What it does | If it fails |
|---|---|---|
| `guard` | `scripts/release-guard.mjs`: the tag must be `v` + the version in `package.json`; that version must be `X.Y.Z` or `X.Y.Z-<prerelease>` (no build metadata, no leading `v`, no leading zeros); `CHANGELOG.md` must have a section for it that is not empty; the commit must be on `main`; that version must not be on npm yet (a registry that cannot be read counts as a refusal) | nothing else runs |
| `verify` | `npm run lint` and `npm test` on Node 22 and on Node 24 | nothing is packed |
| `pack` | `scripts/pack-smoke.mjs`: packs once, installs that tarball in an empty folder, runs `burhan --version` and requires the package version; keeps the tarball | nothing is published |
| `publish` | waits for your approval on the `npm-release` environment (only if you set that up, see below); reads the version inside **that same tarball** and takes its dist-tag from it with `scripts/release-dist-tag.mjs` (`next` for a prerelease, `latest` otherwise), checks the pair again just before publishing, then publishes the tarball with `--provenance` and `--tag`. The dist-tag script refuses a tarball holding `package/package.json` twice or a tar header whose size is not an octal number | a wrong pair or a refused tarball stops the job before `npm publish`; npm refuses a duplicate version |
| `github-release` | after the publish, `scripts/github-release.mjs` writes the GitHub Release for the tag: title `burhan-kit <version>`, body = the version's CHANGELOG section and an install line, published at once, marked prerelease for a prerelease | npm already has the version: see step 6 |

Windows and macOS are tested by `ci.yml` on every push, including the release commit; the release job itself runs on Linux. No npm token is stored: npm trusted publishing identifies the workflow, and `--provenance` links the published version to the commit and run that built it.

## Token rights

Both workflows give the workflow token nothing at the top (`permissions: {}`), and each job names the rights it needs. `test/workflow-permissions.test.ts` holds the same table and fails on a workflow file, a job or a right that is not in it.

| Workflow · job | Rights | Why |
|---|---|---|
| `ci` · `test`, `windows` | `contents: read` | check out the repository |
| `release` · `guard`, `verify`, `pack` | `contents: read` | check out the repository |
| `release` · `publish` | `contents: read`, `id-token: write` | check out the release scripts; `id-token: write` is how npm trusted publishing and `--provenance` identify the run |
| `release` · `github-release` | `contents: write` | create the GitHub Release; the only write right on the repository in either workflow |

## What stays yours

1. **Once, on GitHub, before anything else:** Settings → Environments → New environment `npm-release`; add yourself as a required reviewer; limit deployments to only `v*` tags. **Without the required reviewer there is no approval:** GitHub creates a missing environment on first use with no protection, and the `publish` job runs with no pause. The guard runs from the tagged commit's own copy of the workflow, so the required reviewer, this environment limit and the npm setting are the real controls, not the guard alone. The limit does not stop a `v*` tag on a side branch; the reviewer is who catches that.
2. **Once, on npmjs.com:** open the `burhan-kit` package → Settings → Trusted publisher → GitHub Actions, with owner `ahmedkamaldabour`, repository `burhan-kit`, workflow filename `release.yml` and environment `npm-release`. Under Allowed actions, tick **Allow npm publish** (the workflow runs `npm publish`); leave Allow npm dist-tag off. npm shows the new publisher as `Pending validation` until a first publish succeeds through it, and its banner gives a date by which that publish must happen: plan the first release before that date.
3. **Each release:** bump `version` in `package.json`, write the CHANGELOG section (`## X.Y.Z — YYYY-MM-DD`; the guard refuses a release without it, and `node scripts/release-notes.mjs --version X.Y.Z` shows the Release body it will give), commit on `main`, push `main` and wait for CI to be green.
4. You push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
5. Approve the `publish` job in the Actions tab when `guard`, `verify` and `pack` are green.
6. Check `npm view burhan-kit version dist-tags`. The `github-release` job writes the GitHub Release once the publish succeeded; a Release that already exists for the tag is never changed (the job fails instead). If that job fails, fix the cause and use "Re-run failed jobs" in the Actions tab, or write the Release by hand.

## Prereleases

A version with a prerelease part, such as `1.0.0-rc.1`, is released the same way: set it in `package.json`, give it its own CHANGELOG section (`## 1.0.0-rc.1 — YYYY-MM-DD`), and push the tag `v1.0.0-rc.1`. It goes to the npm dist-tag `next`, so `npx burhan-kit@next` or `npx burhan-kit@1.0.0-rc.1` installs it, and `latest` (what `npx burhan-kit` installs) is left as it is. Its GitHub Release is marked prerelease. The rule that picks the dist-tag is `scripts/release-rules.mjs`; nobody types a dist-tag in the workflow.

To give everyone the final version, release the plain version (`1.0.0`), which goes to `latest`. Moving `latest` onto a version that is already published is a manual step on your own machine (`npm dist-tag add burhan-kit@<version> latest`): the trusted publisher has Allow npm dist-tag off, so the workflow cannot do it.

## Pinned actions

Every `uses:` in `ci.yml` and `release.yml` is a commit SHA with its tag in a comment, so a moved tag cannot change what runs. Dependabot proposes the pin updates (`.github/dependabot.yml`): once a month, one pull request for all the actions, and only for versions that have been out for 7 days. You review it (the new SHA and its comment) and merge it when CI is green; a test fails on a pin that is only a tag, or whose comment is not `# vN`, `# vN.N` or `# vN.N.N`. To bump a pin yourself, look up a tag's commit with `git ls-remote https://github.com/<owner>/<repo> '<tag>^{}' '<tag>'` (the `^{}` line, when there is one, is the commit of an annotated tag; otherwise the plain line is), change the SHA and the comment together.

## Not verified here

The workflow ran end to end for v0.6.0, v0.7.0 and v0.7.1 (runs 40498521668, 40781954749 and 40898804293: the guard, lint and tests on Node 22 and 24, the pack check, and the publish with provenance). The version and CHANGELOG checks of the guard, the dist-tag check and the checkout in `publish`, the `github-release` job and the per-job token rights came after those runs and have not run in a real release yet: the first tag after them is their first run. No prerelease has been published. The Windows and macOS jobs of `ci.yml` run on a push and on a pull request.
