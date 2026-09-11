/**
 * Where each binary the CLI fetches on install is downloaded from.
 *
 * Defaults to the stock holochain release for the configured version. A
 * `binarySources` block in holochain-checksums.json can point a binary at
 * another release: the hello/PoK field-test build points `holochain` (and `hc`)
 * at a fork release, while lair-keystore and kitsune2-bootstrap-srv stay on the
 * stock release by having no entry. This mirrors binarySourceFor in
 * scripts/fetch-fns.mjs, which the app build uses; the published cli package
 * cannot import from the repository's scripts/.
 */
const DEFAULT_BINARIES_REPO = 'holochain/holochain';

export function binarySourceFor(checksums, binaryName, version) {
  const override = checksums.binarySources?.[binaryName] ?? {};
  return {
    repo: override.binariesRepo ?? DEFAULT_BINARIES_REPO,
    tag: override.binariesTag ?? `holochain-${version}`,
  };
}

export function binaryUrlFor(checksums, binaryName, version, targetEnding) {
  const { repo, tag } = binarySourceFor(checksums, binaryName, version);
  return `https://github.com/${repo}/releases/download/${tag}/${binaryName}-${targetEnding}`;
}
