/**
 * The Moss release series a version belongs to, in the form the news feed is keyed by
 * (e.g. `0.16.x`). Returns undefined for anything that is not a recognizable version,
 * so callers can report that rather than requesting a nonsense key.
 */
export function releaseSeriesFromVersion(version: string | undefined): string | undefined {
  const match = version?.match(/^(\d+)\.(\d+)\./);
  return match ? `${match[1]}.${match[2]}.x` : undefined;
}
