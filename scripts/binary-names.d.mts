/**
 * Types for binary-names.mjs, so the electron main process can import the same
 * module the build scripts use. Keep in step with the exports over there.
 */

/** The subset of moss.config.json that determines binary filenames. */
export type BinaryNameConfig = {
  holochain: string;
  holochainBinaryTag?: string;
};

export declare const FORK_TAGGED_BINARIES: string[];

export declare function binaryVersionFor(binaryName: string, config: BinaryNameConfig): string;

export declare function versionedBinaryName(
  binaryName: string,
  version: string,
  platform?: string,
): string;

export declare function holochainBinaryName(
  binaryName: string,
  config: BinaryNameConfig,
  platform?: string,
): string;
