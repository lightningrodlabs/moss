import { HoloHashB64, decodeHashFromBase64 } from '@holochain/client';
import { AppletToParentMessage, AppletToParentRequest } from './types';

export async function postMessage<T>(request: AppletToParentRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();

    const lowercaseB64IdWithPercent = window.location.href.split('#')[1];
    const lowercaseB64Id = lowercaseB64IdWithPercent.replace(/%24/g, '$');
    const appletId = toOriginalCaseB64(lowercaseB64Id);

    const message: AppletToParentMessage = {
      request,
      appletId,
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
