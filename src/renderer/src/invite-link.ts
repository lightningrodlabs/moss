import { DnaModifiers } from '@holochain/client';
import { decode } from '@msgpack/msgpack';
import { GroupDnaProperties } from '@theweave/group-client';
import { PartialModifiers, WEAVE_URL_PREFIX, WEAVE_WEB_PREFIX } from '@theweave/moss-types';
import { inviteCodeFromPartialModifiers } from '@theweave/utils';

/**
 * The join-relevant part of a group's DNA modifiers: what an invite has to carry for
 * someone else to end up in the same network.
 */
export function partialModifiersFromDnaModifiers(modifiers: DnaModifiers): PartialModifiers {
  const groupDnaProperties = decode(modifiers.properties) as GroupDnaProperties;
  return {
    networkSeed: modifiers.network_seed,
    progenitor: groupDnaProperties.progenitor,
  };
}

/**
 * The invite link to share. It routes through a web page so that a recipient without
 * Moss installed lands somewhere that can explain what to do.
 */
export function modifiersToInviteUrl(modifiers: DnaModifiers): string {
  const { networkSeed, progenitor } = partialModifiersFromDnaModifiers(modifiers);
  return `${WEAVE_WEB_PREFIX}${WEAVE_URL_PREFIX}invite/${networkSeed}&progenitor=${progenitor}`;
}

/**
 * A paste-only alternative to the invite link, for channels that mangle or strip links.
 */
export function modifiersToInviteCode(modifiers: DnaModifiers): string {
  return inviteCodeFromPartialModifiers(partialModifiersFromDnaModifiers(modifiers));
}
