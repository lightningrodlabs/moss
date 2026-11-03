/**
 * The documentation versions the site serves. The first entry is the current
 * line and lives at the site root; every other entry is a frozen copy under
 * its own base path (see moss-docs/RELEASE.md, "Freezing the docs for a version").
 */
export type DocsVersion = {
  label: string;
  base: string;
  current: boolean;
};

export const versions: DocsVersion[] = [
  { label: '0.16', base: '/', current: true },
  { label: '0.15', base: '/0.15/', current: false },
];

export function versionForPath(path: string): DocsVersion {
  return (
    versions.find((v) => !v.current && path.startsWith(v.base)) ?? versions.find((v) => v.current)!
  );
}

/** The same page under another version's base path. */
export function pathInVersion(path: string, target: DocsVersion): string {
  const from = versionForPath(path);
  const rest = path.slice(from.base.length);
  return target.base + rest;
}
