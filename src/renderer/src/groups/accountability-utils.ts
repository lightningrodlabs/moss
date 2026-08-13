import { encodeHashToBase64 } from '@holochain/client';
import type { ActionHash, AgentPubKey } from '@holochain/client';
import type { Accountability } from '@theweave/group-client';

/**
 * Single authority for privilege decisions in the renderer, derived from a
 * group's `Accountability` list (the group zome filters expired steward
 * claims before returning it).
 *
 * This module is the intended integration point for the role/privilege
 * model in `@theweave/api` (`MossPrivilege`, `MossRole`,
 * `MossAccountability`): when gating moves to declared privileges, the
 * evaluation lands here, behind these signatures. Three gaps currently
 * keep that model from expressing the rules below:
 * - `canDelegateSteward` grants MakeSteward only to stewards without an
 *   expiry, while `MossRole.Steward` carries MakeSteward unconditionally —
 *   the role map needs mandate-aware evaluation over the accountability.
 * - `canArchive` includes a resource-ownership rule (the agent who added
 *   the tool may archive it), which a role→privilege map cannot express.
 * - Steward writes must attach their claim's `permission_hash` to zome
 *   calls; the privilege model has no credential carriage.
 */

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
