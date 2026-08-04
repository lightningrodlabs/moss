/**
 * Authorization for applet-requested zome-call signing.
 *
 * An applet iframe cannot sign its own zome calls — it has no access to lair —
 * so every call it makes is signed on demand by the host. Signing must therefore
 * be scoped to what the applet is legitimately allowed to call, otherwise a Tool
 * installed by the user inherits the user's full authority on every app whose
 * auth token the applet holds (notably the group app, whose token is handed to
 * the applet so it can read/write profiles).
 *
 * The legitimate signing surface for an applet is exactly:
 *   - any zome in one of the applet's OWN cells, and
 *   - the `profiles` zome in a group cell (the only group-app zome an applet
 *     calls directly; everything else — assets, peer status, remote signals —
 *     goes through the host bridge, which applies its own scoping).
 *
 * This decision is a pure function of already-encoded identifiers so it can be
 * table-tested without a conductor. The host resolves the allowed cell-id sets
 * from live app info and feeds them in.
 */

/** The one group-app zome an applet is permitted to have signed directly. */
export const APPLET_ALLOWED_GROUP_ZOME = 'profiles';

export interface ZomeCallSigningInput {
  /** base64-encoded CellId of the call's target cell. */
  cellIdB64: string;
  /** The zome the call targets. */
  zomeName: string;
  /** base64 CellIds belonging to the requesting applet's own installed app. */
  appletOwnCellIdsB64: ReadonlySet<string>;
  /** base64 CellIds of the group-role cells the user has installed. */
  groupCellIdsB64: ReadonlySet<string>;
}

export type ZomeCallSigningDecision =
  | { sign: true; reason: 'own-cell' | 'group-profiles' }
  | { sign: false; reason: 'unknown-cell' | 'group-zome-not-allowed' };

export function decideZomeCallSignable(input: ZomeCallSigningInput): ZomeCallSigningDecision {
  const { cellIdB64, zomeName, appletOwnCellIdsB64, groupCellIdsB64 } = input;

  // The applet's own cells: any zome is fair game — this is the applet's own DNA.
  if (appletOwnCellIdsB64.has(cellIdB64)) {
    return { sign: true, reason: 'own-cell' };
  }

  // A group cell: only the profiles zome. The group cell also hosts the group,
  // custom_views and peer_status zomes, which an applet must never drive, so the
  // check is (cell, zome)-aware — cell membership alone is not sufficient.
  if (groupCellIdsB64.has(cellIdB64)) {
    if (zomeName === APPLET_ALLOWED_GROUP_ZOME) {
      return { sign: true, reason: 'group-profiles' };
    }
    return { sign: false, reason: 'group-zome-not-allowed' };
  }

  return { sign: false, reason: 'unknown-cell' };
}
