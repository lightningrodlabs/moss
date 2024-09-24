import { PartialModifiers } from './types';
import { decodeHashFromBase64 } from '@holochain/client';

export function invitePropsToPartialModifiers(props: string): PartialModifiers {
  const [networkSeed, progenitorString] = props.split('&progenitor=');
  if (!progenitorString) throw new Error('Invite string does not contain progenitor.');
  let progenitor;
  if (progenitorString === 'null') {
    progenitor = null;
  } else {
    try {
      const rawKey = decodeHashFromBase64(progenitorString);
      if (rawKey.length !== 39) {
        throw new Error(`Progenitor key is not a valid agent key. Got ${progenitorString}`);
      }
    } catch (e) {
      throw new Error(`Progenitor key is not a valid agent key. Got ${progenitorString}`);
    }
    if (!progenitorString.startsWith('uhCAk')) {
      throw new Error(`Progenitor key is not a valid agent key. Got ${progenitorString}`);
    }
    progenitor = progenitorString;
  }
  return {
    networkSeed,
    progenitor,
  };
}

export function partialModifiersFromInviteLink(inviteLink: string): PartialModifiers {
  try {
    const split = inviteLink.trim().split('://');
    const split2 = inviteLink.startsWith('https')
      ? split[2].split('/') // link contains the web prefix, i.e. https://theweave.social/wal/weave-0.13://invite/aljsfkajsf
      : split[1].split('/'); // link does not contain the web prefix, i.e. weave-0.13://invite/aljsfkajsf
    if (split2[0] === 'invite') {
      return invitePropsToPartialModifiers(split2[1]);
    } else {
      throw new Error('Invalid invite link: Invite link is of the wrong format');
    }
  } catch (e) {
    throw new Error('Invalid invite link: Failed to parse invite link.');
  }
}
