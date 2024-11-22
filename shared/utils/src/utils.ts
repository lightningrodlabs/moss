import { PartialModifiers, DistributionInfo } from '@theweave/moss-types';
import {
  ActionHash,
  decodeHashFromBase64,
  encodeHashToBase64,
  HoloHashB64,
} from '@holochain/client';
import { AppletId, AppletHash, WAL } from '@theweave/api';
import { encode, decode } from '@msgpack/msgpack';
import { fromUint8Array, toUint8Array } from 'js-base64';

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

export function toolBundleActionHashFromDistInfo(distributionInfoString: string): ActionHash {
  const distributionInfo: DistributionInfo = JSON.parse(distributionInfoString);
  if (distributionInfo.type !== 'tools-library')
    throw new Error("Cannot get AppEntry action hash from type other than 'tools-library'.");
  return decodeHashFromBase64(distributionInfo.info.originalToolActionHash);
}

export function appIdFromAppletHash(appletHash: AppletHash): string {
  return `applet#${toLowerCaseB64(encodeHashToBase64(appletHash))}`;
}

export function appIdFromAppletId(appletId: AppletId): string {
  return `applet#${toLowerCaseB64(appletId)}`;
}

export function appletHashFromAppId(installedAppId: string): AppletHash {
  return decodeHashFromBase64(toOriginalCaseB64(installedAppId.slice(7)));
}

export function appletIdFromAppId(installedAppId: string): AppletId {
  return toOriginalCaseB64(installedAppId.slice(7));
}

export function toLowerCaseB64(hashb64: HoloHashB64): string {
  return hashb64.replace(/[A-Z]/g, (match) => match.toLowerCase() + '$');
}

export function toOriginalCaseB64(input: string): HoloHashB64 {
  return input.replace(/[a-z]\$/g, (match) => match[0].toUpperCase());
}
