import { ZomeCallNapi, ZomeCallUnsignedNapi } from '@lightningrodlabs/we-rust-utils';

declare global {
  interface Window {
    electronAPI: {
      signZomeCall: (zomeCall: ZomeCallUnsignedNapi) => Promise<ZomeCallNapi>;
    };
  }
}

window.electronAPI = {
  signZomeCall: async (zomeCall: ZomeCallUnsignedNapi) => {
    return postMessage({
      type: 'sign-zome-call',
      payload: zomeCall,
    });
  },
};

type HappToParentRequest = {
  type: 'sign-zome-call';
  payload: ZomeCallUnsignedNapi;
};

async function postMessage(request: HappToParentRequest): Promise<any> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();

    // eslint-disable-next-line no-restricted-globals
    top!.postMessage(request, '*', [channel.port2]);

    channel.port1.onmessage = (m) => {
      if (m.data.type === 'success') {
        resolve(m.data.result);
      } else if (m.data.type === 'error') {
        reject(m.data.error);
      }
    };
  });
}
