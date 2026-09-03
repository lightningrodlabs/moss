/**
 * Types for binary-names.mjs, so the electron main process can import the same
 * module the build scripts use. Declares what src/main imports; keep in step
 * with the exports over there.
 */

/**
 * What the derivation reads: the versions from moss.config.json, the per-binary
 * fork sources from holochain-checksums.json.
 */
export type BinaryNameConfig = {
  holochain: string;
  kitsune2BootstrapSrv?: string;
  binarySources?: Record<string, { binariesRepo?: string; binariesTag?: string }>;
};

export declare function holochainBinaryName(
  binaryName: string,
  config: BinaryNameConfig,
  platform?: string,
): string;
