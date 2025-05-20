import { HoloHashB64 } from '@holochain/client';
import { AppletToParentMessage, AppletToParentRequest, IframeKind } from './types';
import { decode } from '@msgpack/msgpack';
import { toUint8Array } from 'js-base64';

/**
 * A postMessage function used in applet dev mode by initializeHotReload()
 *
 * @param request
 * @returns
 */
export async function postMessage<T>(request: AppletToParentRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();

    // In hot-reloading mode the applet UI is served on localhost and Moss
    // appends the encoded iframe kind to the localhost URL so that we can
    // read it here
    const encodedIframeKind = window.location.href.split('#')[1];
    const iframeKind = decode(toUint8Array(encodedIframeKind)) as IframeKind;

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

export function toOriginalCaseB64(input: string): HoloHashB64 {
  return input.replace(/[a-z]\$/g, (match) => match[0].toUpperCase());
}
