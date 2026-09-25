import { toPromise } from '@holochain-open-dev/stores';
import { encodeHashToBase64 } from '@holochain/client';
import type { AppletHash } from '@theweave/api';

import type { MossStore } from '../moss-store.js';

/**
 * Human-readable label for an applet, for UI that names a tool to the
 * user (consent dialogs, permission lists). Falls back to a short hash
 * prefix when the applet is unknown or has no custom name, so callers
 * always get something displayable.
 */
export async function resolveAppletName(
  mossStore: MossStore,
  appletHash: AppletHash,
): Promise<string> {
  try {
    const appletStore = await toPromise(mossStore.appletStores.get(appletHash)!);
    if (appletStore?.applet?.custom_name) return appletStore.applet.custom_name;
  } catch {
    // unknown applet: use the hash prefix below
  }
  return encodeHashToBase64(appletHash).slice(0, 12);
}
