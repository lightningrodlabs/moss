import { encodeHashToBase64 } from '@holochain/client';
import type { ActionHash, AgentPubKey } from '@holochain/client';
import type { Accountability } from '@theweave/group-client';

/** A group member may manage tools and group settings if they are the
 * progenitor or hold any (unexpired) steward claim. The zome filters
 * expired claims, so presence in the list is sufficient. */
export function amIPrivileged(accountabilities: Accountability[]): boolean {
  return accountabilities.some((a) => a.type === 'Steward' || a.type === 'Progenitor');
}

/** The steward permission hash to attach to writes that require one.
 * Progenitors act without a claim, so this is legitimately undefined
 * for them. */
export function myStewardPermissionHash(
  accountabilities: Accountability[],
): ActionHash | undefined {
  for (const a of accountabilities) {
    if (a.type === 'Steward') return a.content.permission_hash;
  }
  return undefined;
}

/** Archiving a tool is reserved to the progenitor and to the agent who
 * originally added the tool. */
export function canArchive(
  accountabilities: Accountability[],
  addedBy: AgentPubKey | undefined,
  myPubKey: AgentPubKey,
): boolean {
  if (addedBy && encodeHashToBase64(addedBy) === encodeHashToBase64(myPubKey)) return true;
  return accountabilities.some((a) => a.type === 'Progenitor');
}

/** Creating steward permissions is reserved to the progenitor and to
 * stewards whose own claim has no expiry. */
export function canDelegateSteward(accountabilities: Accountability[]): boolean {
  return accountabilities.some(
    (a) => a.type === 'Progenitor' || (a.type === 'Steward' && !a.content.permission.expiry),
  );
}
