import { CallZomeRequest, CallZomeRequestSigned } from '@holochain/client';

declare global {
  interface Window {
    __HC_ZOME_CALL_SIGNER__: {
      signZomeCall: (zomeCall: CallZomeRequest) => Promise<CallZomeRequestSigned>;
    };
  }
}

window.__HC_ZOME_CALL_SIGNER__ = {
  signZomeCall: async (zomeCall: CallZomeRequest) => {
    return postMessage({
      type: 'sign-zome-call',
      payload: zomeCall,
    });
  },
};

type HappToParentRequest = {
  type: 'sign-zome-call';
  payload: CallZomeRequest;
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
