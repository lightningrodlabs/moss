import { DnaHashB64, encodeHashToBase64, HoloHashB64 } from '@holochain/client';
import { AppletId, AppletToParentMessage, AppletToParentRequest, IframeKind, ToolCompatibilityId } from './types';
import { decode } from '@msgpack/msgpack';
import { toUint8Array } from 'js-base64';


/** A postMessage function used in applet dev mode by initializeHotReload() */
export async function postMessage<T>(request: AppletToParentRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();

    // In hot-reloading mode the applet UI is served on localhost and Moss
    // appends the encoded iframe kind to the localhost URL so that we can
    // read it here
    const encodedIframeKind = window.location.href.split('#')[1];
    const iframeKind = decode(toUint8Array(encodedIframeKind)) as IframeKind;
    assertIframeKind(iframeKind);

    const message: AppletToParentMessage = {
      request,
      source: iframeKind,
    };

    // eslint-disable-next-line no-restricted-globals
    top!.postMessage(message, '*', [channel.port2]);

    channel.port1.onmessage = (m) => {
      if (m.data.type === 'success') {
        resolve(m.data.result);
      } else if (m.data.type === 'error') {
        reject(m.data.error);
      }
    };
  });
}


/** */
export function assertIframeKind(iframeKind: any): asserts iframeKind is IframeKind {
  if (!iframeKind || typeof iframeKind !== 'object') {
    throw new Error('Invalid iframe kind: not an object.');
  }
  if (iframeKind.type === 'applet') {
    if (!iframeKind.appletHash || !iframeKind.groupHash || typeof iframeKind.subType !== 'string') {
      throw new Error('Invalid iframe kind: missing applet fields.');
    }
  } else if (iframeKind.type === 'cross-group') {
    if (typeof iframeKind.toolCompatibilityId !== 'string' || typeof iframeKind.subType !== 'string') {
      throw new Error('Invalid iframe kind: missing cross-group fields.');
    }
  } else {
    throw new Error(`Invalid iframe kind type: ${iframeKind.type}`);
  }
}


export function intoOrigin(iframeKind: IframeKind): string {
  switch (iframeKind.type) {
    case 'applet':
      return `applet://${toLowerCaseB64(encodeHashToBase64(iframeKind.appletHash))}.${toLowerCaseB64(encodeHashToBase64(iframeKind.groupHash))}`;
    case 'cross-group':
      return `cross-group://${toLowerCaseB64(iframeKind.toolCompatibilityId)}`;
  }
}

export function intoAppletOrigin(appletId: AppletId, groupId: DnaHashB64): string {
  return `applet://${toLowerCaseB64(appletId)}.${toLowerCaseB64(groupId)}`;
}

/** Assuming `origin` is `applet://<appletId>.<groupId>` */
export function getIdsFromAppletOrigin(origin: string): [AppletId, DnaHashB64] {
  const host = origin.split('://')[1].split('?')[0].split('/')[0];
  const dollarHost = host.replace(/%24/g, '$');
  const parts = dollarHost.split('.');
  return [toOriginalCaseB64(parts[0]), toOriginalCaseB64(parts[1])];
}

/** Assuming `origin` is `cross-group://<toolId>` */
export function getToolIdFromCrossGroupOrigin(origin: string): ToolCompatibilityId {
  const host = origin.split('://')[1].split('?')[0].split('/')[0];
  const dollarHost = host.replace(/%24/g, '$');
  return toOriginalCaseB64(dollarHost);
}


export function toLowerCaseB64(hashb64: HoloHashB64): string {
  return hashb64.replace(/[A-Z]/g, (match) => match.toLowerCase() + '$');
}

export function toOriginalCaseB64(input: string): HoloHashB64 {
  return input.replace(/[a-z]\$/g, (match) => match[0].toUpperCase());
}
