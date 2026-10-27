import { decodeHashFromBase64 } from '@holochain/client';
import type { AppletId, IframeKind } from '@theweave/api';
import type { ToolCompatibilityId } from '@theweave/moss-types';
import { toOriginalCaseB64 } from '@theweave/utils';

function idFromOrigin(origin: string): string {
  const lowercaseB64IdWithPercent = origin.split('://')[1].split('?')[0].split('/')[0];
  const lowercaseB64Id = lowercaseB64IdWithPercent.replace(/%24/g, '$');
  return toOriginalCaseB64(lowercaseB64Id);
}

export function getAppletIdFromOrigin(origin: string): AppletId {
  return idFromOrigin(origin);
}

export function getToolCompatibilityIdFromOrigin(origin: string): ToolCompatibilityId {
  return idFromOrigin(origin);
}

/**
 * The verified identity of the frame that sent a message, derived from its
 * origin and never from what the frame claims. The claim is used only for the
 * view subtype and group, and, in applet dev mode, for localhost frames that
 * have no identifying origin.
 *
 * Returns undefined for `default-app://` frames, which have their own
 * listener. Throws for any other origin.
 */
export function getIframeKind(
  origin: string,
  claimed: IframeKind,
  isAppletDev: boolean,
): IframeKind | undefined {
  if (origin.startsWith('applet://')) {
    return {
      type: 'applet',
      appletHash: decodeHashFromBase64(getAppletIdFromOrigin(origin)),
      groupHash: claimed?.type === 'applet' ? claimed.groupHash : null,
      subType: claimed?.subType,
    };
  }
  if (origin.startsWith('cross-group://')) {
    return {
      type: 'cross-group',
      toolCompatibilityId: getToolCompatibilityIdFromOrigin(origin),
      subType: claimed?.subType,
    };
  }
  if (
    (origin.startsWith('http://127.0.0.1') || origin.startsWith('http://localhost')) &&
    isAppletDev
  ) {
    return claimed;
  }
  if (origin.startsWith('default-app://')) return undefined;
  throw new Error(`Received message from applet with invalid origin: ${origin}`);
}
