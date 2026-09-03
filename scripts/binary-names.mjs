/**
 * Derives the on-disk filenames of the holochain toolchain binaries in
 * `resources/bins`, and the release tag each one comes from.
 *
 * A field-test build may run a *fork* of holochain that reports the same
 * holochain version as the stock release. Naming both `holochain-v0.7.0` makes
 * the two indistinguishable on disk, so a stock binary left over in
 * `resources/bins` packages and runs as if it were the fork. Giving a fork build
 * a filename of its own makes that mix-up impossible: the file the app looks for
 * is simply not there unless the fork was fetched.
 *
 * There is exactly one statement of which binaries are forked: the
 * `binarySources` block of holochain-checksums.json, which is also what
 * repoints the fetch. A binary with an entry there is named after that entry's
 * release tag; a binary without one is named after the holochain version. So
 * `lair-keystore` and `kitsune2-bootstrap-srv` keep stock names by having no
 * entry, and cannot drift out of step with where they are fetched from.
 *
 * This module is pure (no fs, no electron) and is shared by the node build
 * scripts and the electron main process alike -- src/main/const.ts imports it
 * through the sibling binary-names.d.mts. Keep that declaration file in step
 * with the exports here.
 */

/**
 * The version a binary carries when it has no fork source: the holochain
 * version, except for `kitsune2-bootstrap-srv`, which is released on its own
 * cadence and may be pinned separately in moss.config.json.
 */
function stockVersionFor(binaryName, config) {
  if (binaryName === 'kitsune2-bootstrap-srv')
    return config.kitsune2BootstrapSrv ?? config.holochain;
  return config.holochain;
}

/**
 * The GitHub release tag `binaryName`'s assets come from.
 */
export function binaryReleaseTag(binaryName, config) {
  const forkTag = config.binarySources?.[binaryName]?.binariesTag;
  return forkTag ?? `holochain-${stockVersionFor(binaryName, config)}`;
}

/**
 * The version string that goes into `<binary>-v<version>`.
 *
 * It is the release tag with the `holochain-` prefix off, so the filename names
 * the exact release the file came from -- `holochain-v0.7.0-mdns.0` for a fork
 * build, `holochain-v0.7.0` for a stock one.
 */
export function binaryVersionFor(binaryName, config) {
  return binaryReleaseTag(binaryName, config).replace(/^holochain-/, '');
}

/**
 * The executable suffix for a platform, for the callers that build a binary
 * filename that is not `<binary>-v<version>`.
 */
export function exeSuffix(platform = process.platform) {
  return platform === 'win32' ? '.exe' : '';
}

/**
 * The filename `binaryName` has in `resources/bins`.
 */
export function holochainBinaryName(binaryName, config, platform = process.platform) {
  return `${binaryName}-v${binaryVersionFor(binaryName, config)}${exeSuffix(platform)}`;
}
