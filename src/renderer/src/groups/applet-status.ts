import type { AppInfo } from '@holochain/client';
import type { AppletHash } from '@theweave/api';
import { appIdFromAppletHash, isAppDisabled, isAppRunning } from '@theweave/utils';

export interface AppletStatusPartition {
  installed: AppletHash[];
  running: AppletHash[];
  disabled: AppletHash[];
}

/** Partitions the applets this agent has joined in the group DNA by their
 * conductor install status. `installed` is a superset of `running` ∪
 * `disabled`: an app awaiting membrane proofs is installed but neither. */
export function partitionAppletsByStatus(
  myApplets: AppletHash[],
  installedApps: AppInfo[],
): AppletStatusPartition {
  const appsById = new Map(installedApps.map((app) => [app.installed_app_id, app]));
  const partition: AppletStatusPartition = { installed: [], running: [], disabled: [] };
  for (const applet of myApplets) {
    const app = appsById.get(appIdFromAppletHash(applet));
    if (!app) continue;
    partition.installed.push(applet);
    if (isAppRunning(app)) partition.running.push(applet);
    else if (isAppDisabled(app)) partition.disabled.push(applet);
  }
  return partition;
}
