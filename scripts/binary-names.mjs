/**
 * Derives the on-disk filenames of the holochain toolchain binaries in
 * `resources/bins` from moss.config.json.
 *
 * A field-test build may run a *fork* of holochain that reports the same
 * holochain version as the stock release (see `holochainBinaryTag` in
 * moss.config.json). Naming both `holochain-v0.7.0` makes the two
 * indistinguishable on disk, so a stock binary left over in `resources/bins`
 * packages and runs as if it were the fork. Giving the fork build a filename of
 * its own makes that mix-up impossible: the file the app looks for is simply not
 * there unless the fork was fetched.
 *
 * Only `holochain` and `hc` are built from the fork. `lair-keystore` and
 * `kitsune2-bootstrap-srv` are unpatched and keep the stock holochain version in
 * their names.
 *
 * This module is pure (no fs, no electron) and is shared by the node build
 * scripts and the electron main process alike -- src/main/const.ts imports it
 * through the sibling binary-names.d.mts. Keep that declaration file in step
 * with the exports here.
 */

/**
 * The binaries that come from the fork release when `holochainBinaryTag` is set.
 */
export const FORK_TAGGED_BINARIES = ['holochain', 'hc'];

/**
 * The version string that goes into `<binary>-v<version>`.
 *
 * Without `holochainBinaryTag` this is just the holochain version -- stock
 * naming is what you get by not opting in.
 */
export function binaryVersionFor(binaryName, config) {
  if (config.holochainBinaryTag && FORK_TAGGED_BINARIES.includes(binaryName))
    return config.holochainBinaryTag;
  return config.holochain;
}

/**
 * `<binaryName>-v<version>`, plus `.exe` on Windows.
 *
 * Exposed separately from `holochainBinaryName` for the callers that carry their
 * own version override, such as `kitsune2BootstrapSrv`.
 */
export function versionedBinaryName(binaryName, version, platform = process.platform) {
  return `${binaryName}-v${version}${platform === 'win32' ? '.exe' : ''}`;
}

/**
 * The filename `binaryName` has in `resources/bins` for the given moss config.
 */
export function holochainBinaryName(binaryName, config, platform = process.platform) {
  return versionedBinaryName(binaryName, binaryVersionFor(binaryName, config), platform);
}
