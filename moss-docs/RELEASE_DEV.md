# Moss Dev Test Release

How to cut a multi-platform test build for early real-world feedback
(primarily the ASR feature, M4 rollout phase). These builds are
intentionally invisible to the production auto-updater so installed
Moss instances won't migrate to or from them.

## Who this is for

- Cutting a build for a small tester cohort before a stable release.
- Validating platform-specific work (Windows installer, macOS notarization,
  Linux AppImage) on the full matrix without claiming the `v<version>`
  release tag.

## How to trigger

1. Go to the repo → **Actions** tab → **publish-dev** workflow.
2. Click **Run workflow**. Optionally edit the release-notes string.
3. The workflow creates a GitHub release tagged
   `v<package.json-version>-test.<run-number>` marked as *prerelease*.
4. When the matrix finishes, downloadable installers appear on that
   release page:
   - Windows: `moss-...-setup.exe`
   - macOS: `moss-...-arm64.dmg`, `moss-...-x64.dmg`
   - Linux: `moss-...-amd64.deb`, `moss-...-x86_64.AppImage`,
     `moss-...-arm64.deb`, `moss-...-arm64.AppImage`

Share the release page URL with testers.

## Why this doesn't collide with production auto-update

- The stable auto-updater (in `src/main/index.ts`) reads
  `github.com/lightningrodlabs/moss/releases/latest/download/latest*.yml`.
  GitHub's `latest` pointer resolves to the most-recent **non-prerelease**
  release. Dev test builds are flagged `prerelease: true`, so they never
  become `latest`.
- The workflow also does not upload the `latest*.yml` auto-update manifest
  files — belt-and-braces, in case prerelease flags ever get flipped.

## Caveat: version equality after the stable release ships

Test builds and the eventual stable release share the same
`package.json` version (e.g. `0.15.6`). `app.getVersion()` returns
`0.15.6` in both. When stable `v0.15.6` ships, Electron's auto-updater
compares versions semver-wise and sees equality, so testers on the dev
build will NOT auto-migrate. Communicate this to testers: when the real
build drops, they install it manually.

## Re-running

The tag includes the workflow run number, so each run produces a new
release (`-test.1`, `-test.2`, …). Delete obsolete test releases
manually from the Releases page when they're no longer useful.
