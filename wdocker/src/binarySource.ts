/**
 * Where wdocker downloads its holochain binary from, and the name it is cached
 * under.
 *
 * wdocker must run the same conductor as the Moss build it ships with: a
 * stock conductor and a fork conductor reject each other at preflight, so a
 * mismatched wdocker node could never peer with the groups it serves. The
 * `binarySources` block in holochain-checksums.json, which the app and the
 * cli also read, decides that. This mirrors cli/binary-source.mjs; the
 * published wdocker package cannot import from the cli or scripts/.
 */

export type BinarySource = { binariesRepo?: string; binariesTag?: string };
export type HolochainChecksums = {
  version: string;
  binarySources?: Record<string, BinarySource | undefined>;
};
export type MossConfig = { holochain: string; binariesAppendix: string };

const DEFAULT_BINARIES_REPO = 'holochain/holochain';

function holochainSource(checksums: HolochainChecksums, mossConfig: MossConfig) {
  const override = checksums.binarySources?.holochain ?? {};
  return {
    repo: override.binariesRepo ?? DEFAULT_BINARIES_REPO,
    tag: override.binariesTag ?? `holochain-${mossConfig.holochain}`,
  };
}

export function holochainBinaryUrl(
  checksums: HolochainChecksums,
  mossConfig: MossConfig,
  targetEnding: string,
): string {
  const { repo, tag } = holochainSource(checksums, mossConfig);
  return `https://github.com/${repo}/releases/download/${tag}/holochain-${targetEnding}`;
}

/**
 * The cached file is named after the release it came from, so switching
 * between a stock and a fork release never reuses the other's binary.
 */
export function holochainBinaryName(
  checksums: HolochainChecksums,
  mossConfig: MossConfig,
  platform: NodeJS.Platform,
): string {
  const version = holochainSource(checksums, mossConfig).tag.replace(/^holochain-/, '');
  return `holochain-v${version}-${mossConfig.binariesAppendix}-wdocker${platform === 'win32' ? '.exe' : ''}`;
}
