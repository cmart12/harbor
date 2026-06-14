---
name: create-release
description: "Use this skill to cut a new whim release and publish it with proper release notes. Triggers: 'create a release', 'cut a release', 'publish a new version', 'ship vX.Y.Z', 'bump the version and release', 'release notes for the release', or any request to run/repair the GitHub release for patniko/whim. Drives the full flow — version bump, tag, trigger release.yml, and attach generated notes — and can also backfill notes onto an existing release."
---

# Create a whim release

End-to-end release for `patniko/whim`: bump the version, push the tag, trigger the
signed multi-platform build (`.github/workflows/release.yml`), and **guarantee the
GitHub Release has real notes**. electron-builder publishes the release with an empty
body, so this skill writes the notes itself, *after* the workflow finishes, via
`gh release edit` (so the body can't be overwritten).

## When to use

- The user wants to ship a new version of whim.
- The user wants to (re)generate or fix release notes for a release.
- A release was published with an empty body and needs notes backfilled.

## Prerequisites (verify first, stop if any fail)

1. `gh auth status` succeeds (and `gh repo view patniko/whim` works).
2. Working tree is clean: `git status --porcelain` is empty.
3. On the default branch and up to date: `git rev-parse --abbrev-ref HEAD` is `master`,
   and `git fetch && git status -sb` shows no divergence from `origin/master`.
4. Node is available (run `node -v`) — needed for the notes helper.

If a precondition fails, report exactly what's wrong and stop; do not push anything.

## Procedure

### 1. Choose the version (auto-patch, then confirm)

- Read the current version: `node -p "require('./package.json').version"`.
- Compute the **next patch** by default (e.g. `0.0.14` → `0.0.15`).
- Show the proposed version and ask the user to confirm or override (they may pick a
  minor/major bump or an explicit version). **Do not write anything until confirmed.**
- The tag is `v<version>` (e.g. `v0.0.15`).

### 2. Stamp the version and push the tag

Only after confirmation:

```bash
npm version <version> --no-git-tag-version   # updates package.json (+ lockfile)
git add package.json package-lock.json
git commit -m "v<version>"
git tag "v<version>"
git push origin master --tags
```

> `npm version <version> --no-git-tag-version` just edits the files; we commit/tag
> explicitly to match the `vX.Y.Z` commit-message convention in `RELEASING.md`.

### 3. Generate the release notes

Run the helper for the new range and capture its output:

```bash
node .github/skills/create-release/scripts/generate-notes.js \
  --from "v<previousVersion>" --to "v<version>" > /tmp/whim-notes.md
```

(Omit `--from`/`--to` to auto-detect the latest tag and the one before it. Add
`--enrich-prs` to pull PR titles via `gh`, best-effort.)

Then **write the summary**: open `/tmp/whim-notes.md`, replace the
`<!-- Write 1–2 sentences… -->` placeholder under `## Summary` with a concise,
user-facing 1–2 sentence description of the release, and tidy any awkward entries.
Follow `.github/skills/create-release/references/notes-template.md`. Never ship the
placeholder comment.

### 4. Trigger the build workflow

```bash
gh workflow run release.yml --field tag="v<version>"
```

Wait for the run to finish (both `release-mac` and `release-win`):

```bash
gh run list --workflow=release.yml --limit 1                  # get the run id
gh run watch <run-id> --exit-status                           # blocks until complete
```

If a job fails, surface the failing logs (`gh run view <run-id> --log-failed`), fix or
advise, and re-run before continuing.

### 5. Attach the notes (after publish)

Once the workflow succeeds and the release exists:

```bash
gh release edit "v<version>" --notes-file /tmp/whim-notes.md --latest --draft=false
```

Doing this *after* the workflow ensures electron-builder can't clobber the body.

### 6. Verify

```bash
gh release view "v<version>" --json tagName,name,isDraft,body \
  --jq '{tag:.tagName, draft:.isDraft, hasNotes:(.body|length>0)}'
gh release view "v<version>"   # eyeball assets: .dmg, .zip, .exe, latest-mac.yml, latest.yml
```

Confirm `hasNotes` is `true` and the expected assets are present. Report the release URL.

## Backfilling notes on an existing release

To add/replace notes without cutting a new build (e.g. a release published with an
empty body):

```bash
node .github/skills/create-release/scripts/generate-notes.js \
  --from "v<previous>" --to "v<target>" > /tmp/whim-notes.md
# write the Summary, then:
gh release edit "v<target>" --notes-file /tmp/whim-notes.md --latest
```

## Notes & guardrails

- Never change `productName`/`appId` or add per-script `productName` overrides — see the
  warning in `RELEASING.md` (it breaks macOS auto-updates).
- Signing/notarization happens in CI via repo secrets; nothing secret is needed locally.
- Releases are cut from `master`. The notes helper is plain Node (no deps) and is safe to
  run anywhere.
- Clean up `/tmp/whim-notes.md` when done.
