export const COPYRIGHT_HOLDER = 'Harris-Braun Enterprises, LLC';
export const COPYRIGHT_START_YEAR = 2021;
export const HOLOCHAIN_URL = 'https://www.holochain.org';
export const CAL_URL = 'https://github.com/holochain/cryptographic-autonomy-license';

export function copyrightYears(start: number, end: number): string {
  return start >= end ? `${end}` : `${start}–${end}`;
}

/** Shape of third-party-notices.json, written by scripts/generate-third-party-notices.mjs. */
export type PackageNotice = {
  name: string;
  version: string;
  license: string;
  url?: string;
  text?: string;
};

export type BinaryNotice = {
  name: string;
  license: string;
  copyright: string;
  url: string;
};

export type ThirdPartyNotices = {
  binaries: BinaryNotice[];
  packages: PackageNotice[];
};

const isString = (v: unknown): v is string => typeof v === 'string';
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Validates the fetched notices file; undefined when it is missing or malformed. */
export function parseNotices(raw: unknown): ThirdPartyNotices | undefined {
  if (!isObject(raw) || !Array.isArray(raw.binaries) || !Array.isArray(raw.packages)) {
    return undefined;
  }
  const binariesOk = raw.binaries.every(
    (b) => isObject(b) && isString(b.name) && isString(b.license) && isString(b.url),
  );
  const packagesOk = raw.packages.every(
    (p) => isObject(p) && isString(p.name) && isString(p.version) && isString(p.license),
  );
  return binariesOk && packagesOk ? (raw as ThirdPartyNotices) : undefined;
}
