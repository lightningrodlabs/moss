import type { AppStatus } from '@holochain/client';

/**
 * Whether a group app is recorded as disabled in a groups export.
 *
 * Anything other than a running app counts: a group that is not running
 * cannot answer the zome calls the exporter makes, so its entry carries no
 * profiles or tools, and the import must not switch it on by itself.
 */
export function exportedGroupDisabled(status: AppStatus): boolean {
  return status.type !== 'enabled';
}

/**
 * Whether an imported group is to be installed without being enabled.
 *
 * Exports written before the `disabled` flag existed carry no state, but an
 * enabled group always yields at least its group profile to the exporter, so
 * an entry with neither profile came from a group that was not running.
 */
export function importGroupDisabled(entry: {
  disabled?: boolean;
  groupProfile: unknown | undefined;
  agentProfile: unknown | undefined;
}): boolean {
  if (entry.disabled !== undefined) return entry.disabled;
  return !entry.groupProfile && !entry.agentProfile;
}
