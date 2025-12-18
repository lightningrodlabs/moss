import {
  AppletHash,
  WAL,
} from './types';
import { decodeHashFromBase64, DnaHash, encodeHashToBase64 } from '@holochain/client';
import { decodeContext, encodeContext, WEAVE_COMPATIBLE_PROTOCOL_VERSIONS } from './api';

/**
 * String with format `weave-0.15://{hrl | group | applet}/<hash>/<hash>`
 */
export type WeaveUrl = string;

export type WeaveLocation =
  | {
  type: 'group';
  groupHash: DnaHash;
}
  | {
  type: 'applet';
  appletHash: AppletHash;
  groupHash: DnaHash;
}
  | {
  type: 'asset';
  wal: WAL;
}
  | {
  type: 'invitation';
  // network seed and membrane proofs
  secret: string;
};

/**
 *
 * @param appletHash Hash of the applet to generate the link for
 * @param groupHash Hash of the group to generate the link for
 * @param webPrefix Whether to make the link work via web browsers. Default is true.
 * @returns
 */
export const weaveUrlFromApplet = (appletHash: AppletHash, groupHash: DnaHash, webPrefix = false) => {
  const latestVersion = WEAVE_COMPATIBLE_PROTOCOL_VERSIONS[WEAVE_COMPATIBLE_PROTOCOL_VERSIONS.length - 1];
  let url: string = '';
  if (webPrefix) {
    url = 'https://theweave.social/wal?';
  }
  url =
    url +
    `weave-${window.__WEAVE_PROTOCOL_VERSION__ || latestVersion}://applet/${encodeHashToBase64(appletHash)}/${encodeHashToBase64(groupHash)}`;
  return url;
};

export function weaveUrlFromWal(wal: WAL, webPrefix = false) {
  const latestVersion = WEAVE_COMPATIBLE_PROTOCOL_VERSIONS[WEAVE_COMPATIBLE_PROTOCOL_VERSIONS.length - 1];
  let url: string = '';
  if (webPrefix) {
    url = 'https://theweave.social/wal?';
  }
  url =
    url +
    `weave-${window.__WEAVE_PROTOCOL_VERSION__ || latestVersion}://hrl/${encodeHashToBase64(wal.hrl[0])}/${encodeHashToBase64(wal.hrl[1])}${
      wal.context ? `?context=${encodeContext(wal.context)}` : ''
    }`;
  return url;
}

/** */
export function weaveUrlToLocation(url: WeaveUrl): WeaveLocation {
  const latestVersion = WEAVE_COMPATIBLE_PROTOCOL_VERSIONS[WEAVE_COMPATIBLE_PROTOCOL_VERSIONS.length - 1];
  if (!url.startsWith(`weave-${window.__WEAVE_PROTOCOL_VERSION__ || latestVersion}://`)) {
    throw new Error(`Provided Url is not a valid WeaveUrl: ${url}`);
  }
  const split = url.split('://');
  const split2 = split[1].split('/');
  if (split2[0] === 'hrl') {
    const contextSplit = split2[2].split('?context=');
    return {
      type: 'asset',
      wal: {
        hrl: [decodeHashFromBase64(split2[1]), decodeHashFromBase64(contextSplit[0])],
        context: contextSplit[1] ? decodeContext(contextSplit[1]) : undefined,
      },
    };
  } else if (split2[0] === 'group') {
    throw new Error(
      'Needs to be implemented in Moss version newer than 0.12 by changing group to invitation',
    );
  } else if (split2[0] === 'applet') {
    return {
      type: 'applet',
      appletHash: decodeHashFromBase64(split2[1]),
      groupHash: decodeHashFromBase64(split2[2]),
    };
  }
  throw new Error(`Got We url of unknown format: ${url}`);
}

/** */
export function weaveUrlToWAL(url: WeaveUrl): WAL {
  const weaveLocation = weaveUrlToLocation(url);
  if (weaveLocation.type !== 'asset') {
    throw new Error('Passed URL is not a valid asset locator.');
  }
  return weaveLocation.wal;
}